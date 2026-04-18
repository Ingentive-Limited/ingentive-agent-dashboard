import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";
import Database from "better-sqlite3";
import type {
  ClaudeSession,
  SessionStatus,
  TokenUsage,
  TokenDataPoint,
  CostEstimate,
  ProjectSummary,
  ProjectDetail,
  ProjectSession,
  SubagentMeta,
  ScheduledTask,
  DashboardOverview,
  SessionHistory,
  ConversationMessage,
  SearchResult,
  DailyTokenUsage,
  ProjectStats,
  InstalledPlugin,
  SystemStatus,
  ProviderStatus,
} from "./types";
import {
  emptyTokenUsage,
  addTokens,
  readLastLines,
  projectNameFromPath,
  calculateCost,
  isWithinDir,
} from "./utils-server";

// OpenAI pricing per million tokens (GPT-5.3-codex as default)
const CODEX_PRICING = {
  input: 2.0 / 1_000_000,
  output: 8.0 / 1_000_000,
  cacheWrite: 0,
  cacheRead: 0,
  reasoning: 8.0 / 1_000_000,
};

function calculateCodexCost(tokens: TokenUsage): CostEstimate {
  const base = calculateCost(tokens, CODEX_PRICING);
  // Add reasoning token cost if present
  const reasoningCost = (tokens.reasoning_tokens || 0) * (CODEX_PRICING.reasoning || 0);
  return {
    ...base,
    totalCost: base.totalCost + reasoningCost,
  };
}

const CODEX_DIR = path.join(os.homedir(), ".codex");
const STATE_DB_PATH = path.join(CODEX_DIR, "state_5.sqlite");

// Thread row from the SQLite database
interface ThreadRow {
  id: string;
  rollout_path: string;
  created_at: number;
  updated_at: number;
  source: string;
  model_provider: string;
  cwd: string;
  title: string;
  tokens_used: number;
  archived: number;
  cli_version: string;
  first_user_message: string;
  model: string | null;
  reasoning_effort: string | null;
}

interface SpawnEdgeRow {
  parent_thread_id: string;
  child_thread_id: string;
  status: string;
}

function codexDirExists(): boolean {
  return fs.existsSync(STATE_DB_PATH);
}

function openDb(): Database.Database | null {
  if (!codexDirExists()) return null;
  try {
    return new Database(STATE_DB_PATH, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }
}

/**
 * Determine session status by reading the last few lines of the Codex JSONL
 * rollout file. This mirrors how Claude detects "awaiting_input" from JSONL.
 *
 * Exported for testing; callers outside this module should use `threadToSession`.
 */
export function getStatusFromRollout(rolloutPath: string | null): {
  status: SessionStatus;
  lastMessage?: string;
} {
  if (!rolloutPath) return { status: "idle" };

  const fullPath = path.isAbsolute(rolloutPath)
    ? rolloutPath
    : path.join(CODEX_DIR, rolloutPath);

  if (!fs.existsSync(fullPath)) return { status: "idle" };

  try {
    // Read last ~4KB to find the final entries
    const stat = fs.statSync(fullPath);
    const readSize = Math.min(stat.size, 4096);
    const buf = Buffer.alloc(readSize);
    const fd = fs.openSync(fullPath, "r");
    fs.readSync(fd, buf, 0, readSize, Math.max(0, stat.size - readSize));
    fs.closeSync(fd);

    const tail = buf.toString("utf-8");
    const lines = tail.split("\n").filter((l) => l.trim());
    if (lines.length === 0) return { status: "idle" };

    // Walk backwards to find the last meaningful entry.
    // Skip token_count / reasoning / other metadata entries.
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        const entryType = entry.type as string | undefined;
        const payload = entry.payload || entry;
        const payloadType = payload.type as string | undefined;

        // Skip non-conversation metadata (token counts, reasoning, etc.)
        if (
          payloadType === "token_count" ||
          payloadType === "reasoning" ||
          payloadType === "rate_limit"
        ) {
          continue;
        }

        // User message → agent is processing it
        if (
          (entryType === "event_msg" && payloadType === "user_message") ||
          entryType === "user" ||
          payloadType === "user"
        ) {
          return { status: "processing" };
        }

        // Function call requesting user input → agent is waiting for user
        // Codex emits: { type: "response_item", payload: { type: "function_call", name: "request_user_input", arguments: "..." } }
        if (
          payloadType === "function_call" ||
          payloadType === "tool_call"
        ) {
          const fnName = payload.name as string | undefined;
          if (
            fnName === "request_user_input" ||
            fnName === "ask_user" ||
            fnName === "user_confirmation"
          ) {
            // Extract question text from the function arguments
            let questionText: string | undefined;
            try {
              const args = typeof payload.arguments === "string"
                ? JSON.parse(payload.arguments)
                : payload.arguments;
              if (args?.questions?.[0]?.question) {
                questionText = String(args.questions[0].question).slice(0, 200);
              } else if (args?.question) {
                questionText = String(args.question).slice(0, 200);
              } else if (args?.message) {
                questionText = String(args.message).slice(0, 200);
              }
            } catch { /* ignore parse errors */ }
            return {
              status: "needs_attention",
              lastMessage: questionText,
            };
          }
          // Other function calls → tool execution in progress
          return { status: "running" };
        }

        // Input-required / ask-user events
        if (
          payloadType === "input_required" ||
          payloadType === "ask_user" ||
          payloadType === "user_confirmation" ||
          entryType === "input_required"
        ) {
          const text =
            typeof payload.content === "string"
              ? payload.content.slice(0, 200)
              : undefined;
          return { status: "needs_attention", lastMessage: text };
        }

        // Function call output → tool just returned, agent is working
        if (entryType === "function_call_output") {
          return { status: "running" };
        }

        // Assistant message → agent finished its turn, waiting for user
        if (
          entryType === "assistant" ||
          (entryType === "response_item" && payloadType === "message") ||
          (entryType === "event_msg" && payloadType === "agent_message")
        ) {
          // Extract the actual text content
          let text: string | undefined;
          if (Array.isArray(payload.content)) {
            const textBlock = payload.content.find(
              (c: Record<string, unknown>) =>
                c.type === "output_text" || c.type === "text"
            );
            if (textBlock) {
              text = String(textBlock.text || "").slice(0, 200);
            }
          } else if (typeof payload.content === "string") {
            text = payload.content.slice(0, 200);
          } else if (typeof payload.message === "string") {
            text = payload.message.slice(0, 200);
          } else if (typeof payload.text === "string") {
            text = payload.text.slice(0, 200);
          }
          return { status: "awaiting_input", lastMessage: text || undefined };
        }
      } catch {
        // Skip malformed lines, try the next one
      }
    }
  } catch {
    // File read error — fall back to idle
  }

  return { status: "idle" };
}

function threadToSession(row: ThreadRow): ClaudeSession {
  const now = Date.now();
  const updatedAtMs = row.updated_at * 1000;
  const createdAtMs = row.created_at * 1000;
  const ageMs = now - updatedAtMs;

  let status: SessionStatus;
  let lastMessage: string | undefined = row.first_user_message || undefined;

  if (row.archived) {
    status = "dead";
  } else if (ageMs < 5_000) {
    // Very recently updated — model is likely still generating
    status = "running";
  } else {
    // Not actively generating — check the JSONL to see what the conversation
    // state actually is (awaiting user input, processing, idle, etc.)
    const rolloutStatus = getStatusFromRollout(row.rollout_path);
    status = rolloutStatus.status;
    if (rolloutStatus.lastMessage) {
      lastMessage = rolloutStatus.lastMessage;
    }
  }

  return {
    pid: 0, // Codex threads are not OS processes
    sessionId: row.id,
    cwd: row.cwd,
    startedAt: createdAtMs,
    kind: "task",
    entrypoint: row.source || "cli",
    isAlive: !row.archived,
    status,
    projectName: projectNameFromPath(row.cwd),
    lastMessage,
    provider: "codex",
    model: row.model || undefined,
  };
}

function tokensFromRow(row: ThreadRow): TokenUsage {
  // Codex stores total tokens_used as a single number.
  // We approximate a 30/70 input/output split based on typical usage.
  const total = row.tokens_used || 0;
  const inputEstimate = Math.round(total * 0.3);
  const outputEstimate = total - inputEstimate;
  return {
    input_tokens: inputEstimate,
    output_tokens: outputEstimate,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export async function getActiveSessions(): Promise<ClaudeSession[]> {
  const db = openDb();
  if (!db) return [];
  try {
    const rows = db.prepare(
      "SELECT * FROM threads WHERE archived = 0 ORDER BY updated_at DESC"
    ).all() as ThreadRow[];
    return rows.map(threadToSession);
  } finally {
    db.close();
  }
}

// ── Projects ─────────────────────────────────────────────────────────────────

export async function getProjects(): Promise<ProjectSummary[]> {
  const db = openDb();
  if (!db) return [];
  try {
    const rows = db.prepare(`
      SELECT cwd,
             COUNT(*) as session_count,
             MAX(updated_at) as last_activity,
             SUM(tokens_used) as total_tokens
      FROM threads
      GROUP BY cwd
      ORDER BY last_activity DESC
    `).all() as Array<{
      cwd: string;
      session_count: number;
      last_activity: number;
      total_tokens: number;
    }>;

    return rows.map((row) => {
      const totalTokens: TokenUsage = {
        input_tokens: Math.round((row.total_tokens || 0) * 0.3),
        output_tokens: Math.round((row.total_tokens || 0) * 0.7),
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      };
      return {
        id: row.cwd.replace(/[\\/]/g, "-"),
        path: row.cwd,
        name: projectNameFromPath(row.cwd),
        sessionCount: row.session_count,
        lastActivity: new Date(row.last_activity * 1000).toISOString(),
        totalTokens,
        cost: calculateCodexCost(totalTokens),
      };
    });
  } finally {
    db.close();
  }
}

export async function getProjectDetail(projectId: string): Promise<ProjectDetail | null> {
  const db = openDb();
  if (!db) return null;
  try {
    // Decode project ID back to path
    const decodedPath = projectId.replace(/^-/, "/").replace(/-/g, "/");

    const rows = db.prepare(
      "SELECT * FROM threads WHERE cwd = ? ORDER BY created_at DESC"
    ).all(decodedPath) as ThreadRow[];

    if (rows.length === 0) return null;

    let totalTokens = emptyTokenUsage();
    const sessions: ProjectSession[] = [];
    const tokenTimeSeries: TokenDataPoint[] = [];
    let cumulativeInput = 0;
    let cumulativeOutput = 0;

    for (const row of rows) {
      const tokens = tokensFromRow(row);
      totalTokens = addTokens(totalTokens, tokens);
      cumulativeInput += tokens.input_tokens;
      cumulativeOutput += tokens.output_tokens;

      sessions.push({
        sessionId: row.id,
        messageCount: 0, // We'd need to parse JSONL for exact count
        totalTokens: tokens,
        firstMessage: new Date(row.created_at * 1000).toISOString(),
        lastMessage: new Date(row.updated_at * 1000).toISOString(),
      });

      tokenTimeSeries.push({
        timestamp: new Date(row.created_at * 1000).toISOString(),
        ...tokens,
        cumulative_input: cumulativeInput,
        cumulative_output: cumulativeOutput,
      });
    }

    // Get subagents from thread_spawn_edges
    const subagents: SubagentMeta[] = [];
    const threadIds = rows.map((r) => r.id);
    for (const threadId of threadIds) {
      const edges = db.prepare(
        "SELECT * FROM thread_spawn_edges WHERE parent_thread_id = ?"
      ).all(threadId) as SpawnEdgeRow[];
      for (const edge of edges) {
        subagents.push({
          agentType: "subagent",
          description: `Child thread: ${edge.child_thread_id}`,
          sessionId: edge.child_thread_id,
        });
      }
    }

    const lastActivity = Math.max(...rows.map((r) => r.updated_at));

    return {
      id: projectId,
      path: decodedPath,
      name: projectNameFromPath(decodedPath),
      sessionCount: rows.length,
      lastActivity: new Date(lastActivity * 1000).toISOString(),
      totalTokens,
      cost: calculateCodexCost(totalTokens),
      sessions,
      subagents,
      memoryFiles: [],
      tokenTimeSeries,
    };
  } finally {
    db.close();
  }
}

// ── Session History ──────────────────────────────────────────────────────────

export async function getSessionHistory(): Promise<SessionHistory[]> {
  const db = openDb();
  if (!db) return [];
  try {
    const rows = db.prepare(
      "SELECT * FROM threads ORDER BY updated_at DESC"
    ).all() as ThreadRow[];

    return rows.map((row) => {
      const tokens = tokensFromRow(row);
      return {
        sessionId: row.id,
        projectName: projectNameFromPath(row.cwd),
        cwd: row.cwd,
        startedAt: row.created_at * 1000,
        endedAt: row.archived ? new Date(row.updated_at * 1000).toISOString() : undefined,
        entrypoint: row.source || "cli",
        totalTokens: tokens,
        cost: calculateCodexCost(tokens),
        messageCount: 0,
        status: row.archived
          ? ("dead" as SessionStatus)
          : getStatusFromRollout(row.rollout_path).status,
        provider: "codex" as const,
      };
    });
  } finally {
    db.close();
  }
}

// ── Token Usage ──────────────────────────────────────────────────────────────

export async function getDailyTokenUsage(days = 30): Promise<DailyTokenUsage[]> {
  const db = openDb();
  if (!db) return [];
  try {
    const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
    const rows = db.prepare(`
      SELECT date(created_at, 'unixepoch', 'localtime') as day,
             SUM(tokens_used) as total,
             COUNT(*) as sessions
      FROM threads
      WHERE created_at >= ?
      GROUP BY day
      ORDER BY day ASC
    `).all(cutoff) as Array<{ day: string; total: number; sessions: number }>;

    // Fill missing days
    const result: DailyTokenUsage[] = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      const match = rows.find((r) => r.day === dateStr);
      const total = match?.total || 0;
      const tokens: TokenUsage = {
        input_tokens: Math.round(total * 0.3),
        output_tokens: Math.round(total * 0.7),
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      };
      result.push({
        date: dateStr,
        ...tokens,
        totalCost: calculateCodexCost(tokens).totalCost,
        sessionCount: match?.sessions || 0,
      });
    }
    return result;
  } finally {
    db.close();
  }
}

export async function getProjectStats(): Promise<ProjectStats[]> {
  const db = openDb();
  if (!db) return [];
  try {
    const rows = db.prepare(`
      SELECT cwd,
             COUNT(*) as session_count,
             MAX(updated_at) as last_activity,
             SUM(tokens_used) as total_tokens
      FROM threads
      GROUP BY cwd
      ORDER BY total_tokens DESC
    `).all() as Array<{
      cwd: string;
      session_count: number;
      last_activity: number;
      total_tokens: number;
    }>;

    return rows.map((row) => {
      const tokens: TokenUsage = {
        input_tokens: Math.round((row.total_tokens || 0) * 0.3),
        output_tokens: Math.round((row.total_tokens || 0) * 0.7),
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      };
      return {
        id: row.cwd.replace(/[\\/]/g, "-"),
        name: projectNameFromPath(row.cwd),
        totalTokens: tokens,
        cost: calculateCodexCost(tokens),
        sessionCount: row.session_count,
        lastActivity: new Date(row.last_activity * 1000).toISOString(),
        errorCount: 0,
        successCount: row.session_count,
        errorRate: 0,
      };
    });
  } finally {
    db.close();
  }
}

// ── Search ───────────────────────────────────────────────────────────────────

export async function searchAll(query: string): Promise<SearchResult[]> {
  const db = openDb();
  if (!db) return [];
  try {
    const pattern = `%${query}%`;
    const rows = db.prepare(`
      SELECT id, cwd, title, first_user_message
      FROM threads
      WHERE title LIKE ? OR first_user_message LIKE ? OR cwd LIKE ?
      ORDER BY updated_at DESC
      LIMIT 20
    `).all(pattern, pattern, pattern) as Array<{
      id: string;
      cwd: string;
      title: string;
      first_user_message: string;
    }>;

    return rows.map((row) => ({
      type: "session" as const,
      title: row.title || projectNameFromPath(row.cwd),
      subtitle: row.cwd,
      href: `/sessions?id=${row.id}`,
      snippet: row.first_user_message?.slice(0, 200),
    }));
  } finally {
    db.close();
  }
}

// ── Conversation ─────────────────────────────────────────────────────────────

export function findSessionJsonl(sessionId: string): string | null {
  // Defense-in-depth: Codex thread IDs are UUIDs, so we only accept that format.
  // This also prevents SQL-context weirdness even though we use prepared statements.
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) return null;

  const db = openDb();
  if (!db) return null;
  try {
    const row = db.prepare(
      "SELECT rollout_path FROM threads WHERE id = ?"
    ).get(sessionId) as { rollout_path: string } | undefined;
    if (!row?.rollout_path) return null;
    const fullPath = path.isAbsolute(row.rollout_path)
      ? row.rollout_path
      : path.join(CODEX_DIR, row.rollout_path);
    // Defense-in-depth: the rollout_path comes from SQLite and, while we trust
    // the Codex CLI to write it, we verify the resolved path stays inside
    // ~/.codex so a corrupted/malicious DB entry cannot escape the sandbox.
    if (!isWithinDir(fullPath, CODEX_DIR)) return null;
    return fs.existsSync(fullPath) ? fullPath : null;
  } finally {
    db.close();
  }
}

export async function readConversationLines(filePath: string, n: number): Promise<string[]> {
  return readLastLines(filePath, n);
}

/**
 * Extract readable text from a Codex message content field.
 * Codex content is either a string or an array of { type, text } blocks
 * where type is "output_text" | "input_text" | etc.
 */
function extractCodexText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (block && typeof block === "object") {
        const b = block as Record<string, unknown>;
        if (typeof b.text === "string") parts.push(b.text);
      }
    }
    return parts.join("\n");
  }
  return "";
}

/**
 * Parse a Codex ISO timestamp safely. Codex writes ISO 8601 strings
 * (e.g. "2026-04-16T08:38:40.110Z"). Falls back to "now" on unparseable input.
 */
function parseCodexTimestamp(value: unknown): string {
  if (typeof value === "string") {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof value === "number") {
    // Some entries may use epoch seconds — detect by magnitude
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

export async function getConversationPreview(
  sessionId: string,
  maxMessages = 20
): Promise<ConversationMessage[]> {
  const jsonlPath = findSessionJsonl(sessionId);
  if (!jsonlPath) return [];

  try {
    // Read more lines than maxMessages because each turn produces multiple
    // entries (user_message, reasoning, response_item, token_count, etc.)
    const lastLines = await readLastLines(jsonlPath, maxMessages * 8);
    const messages: ConversationMessage[] = [];

    for (const line of lastLines) {
      try {
        const entry = JSON.parse(line);
        const entryType = entry.type as string | undefined;
        const payload = (entry.payload || entry) as Record<string, unknown>;
        const payloadType = payload.type as string | undefined;
        const timestamp = parseCodexTimestamp(entry.timestamp);

        // User message: { type: "event_msg", payload: { type: "user_message", message: "..." } }
        if (entryType === "event_msg" && payloadType === "user_message") {
          const text =
            typeof payload.message === "string"
              ? payload.message
              : extractCodexText(payload.content);
          if (text.trim()) {
            messages.push({
              role: "user",
              text: text.slice(0, 500),
              timestamp,
            });
          }
          continue;
        }

        // Assistant message: { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "..." }] } }
        if (
          entryType === "response_item" &&
          payloadType === "message" &&
          payload.role === "assistant"
        ) {
          const text = extractCodexText(payload.content);
          if (text.trim()) {
            messages.push({
              role: "assistant",
              text: text.slice(0, 500),
              timestamp,
            });
          }
          continue;
        }

        // Tool call requesting user input — surface the question
        if (
          entryType === "response_item" &&
          payloadType === "function_call"
        ) {
          const fnName = payload.name as string | undefined;
          if (
            fnName === "request_user_input" ||
            fnName === "ask_user"
          ) {
            try {
              const args =
                typeof payload.arguments === "string"
                  ? JSON.parse(payload.arguments)
                  : payload.arguments;
              const questions = args?.questions;
              let text = "";
              if (Array.isArray(questions)) {
                text = questions
                  .map((q: Record<string, unknown>) => q.question)
                  .filter((q) => typeof q === "string")
                  .join("\n");
              } else if (typeof args?.question === "string") {
                text = args.question;
              } else if (typeof args?.message === "string") {
                text = args.message;
              }
              if (text.trim()) {
                messages.push({
                  role: "assistant",
                  text: text.slice(0, 500),
                  timestamp,
                });
              }
            } catch {
              // ignore parse errors
            }
          }
          // Skip other function calls (internal tool use) from the preview
        }

        // Skip everything else (reasoning, token_count, session_meta,
        // developer/system messages, function_call_output, etc.)
      } catch {
        // Skip malformed lines
      }
    }

    return messages.slice(-maxMessages);
  } catch {
    return [];
  }
}

export async function getSessionErrors(sessionId: string): Promise<string[]> {
  const jsonlPath = findSessionJsonl(sessionId);
  if (!jsonlPath) return [];

  try {
    const lastLines = await readLastLines(jsonlPath, 200);
    const errors: string[] = [];

    for (const line of lastLines) {
      try {
        const entry = JSON.parse(line);
        const payload = entry.payload || entry;
        if (payload.type === "error" || payload.is_error || payload.error) {
          const msg = payload.error || payload.message || payload.text || JSON.stringify(payload);
          errors.push(String(msg).slice(0, 300));
        }
      } catch { /* skip */ }
    }

    return errors;
  } catch {
    return [];
  }
}

// ── Overview ─────────────────────────────────────────────────────────────────

export async function getOverview(): Promise<DashboardOverview> {
  const [sessions, projects, tasks] = await Promise.all([
    getActiveSessions(),
    getProjects(),
    getScheduledTasks(),
  ]);

  const aliveSessions = sessions.filter((s) => s.isAlive);
  const awaitingInput = aliveSessions.filter(
    (s) => s.status === "awaiting_input" || s.status === "needs_attention"
  ).length;

  let totalTokensToday = emptyTokenUsage();
  let totalTokensMonth = emptyTokenUsage();

  // Aggregate from daily token data
  const dailyData = await getDailyTokenUsage(30);
  const today = new Date().toISOString().split("T")[0];
  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStartStr = monthStart.toISOString().split("T")[0];

  for (const day of dailyData) {
    const dayTokens: TokenUsage = {
      input_tokens: day.input_tokens,
      output_tokens: day.output_tokens,
      cache_creation_input_tokens: day.cache_creation_input_tokens,
      cache_read_input_tokens: day.cache_read_input_tokens,
    };
    if (day.date === today) {
      totalTokensToday = addTokens(totalTokensToday, dayTokens);
    }
    if (day.date >= monthStartStr) {
      totalTokensMonth = addTokens(totalTokensMonth, dayTokens);
    }
  }

  // Recent token time series from last 3 projects
  const tokenTimeSeries: TokenDataPoint[] = [];
  const recentProjects = projects.slice(0, 3);
  for (const proj of recentProjects) {
    const detail = await getProjectDetail(proj.id);
    if (detail) {
      tokenTimeSeries.push(...detail.tokenTimeSeries);
    }
  }

  const activeProjectCount = projects.filter((p) => {
    const lastAct = new Date(p.lastActivity).getTime();
    return Date.now() - lastAct < 86400_000;
  }).length;

  return {
    activeSessions: aliveSessions.length,
    awaitingInput,
    totalTokensToday,
    totalTokensMonth,
    totalCost: calculateCodexCost(totalTokensMonth),
    activeProjects: activeProjectCount,
    scheduledTasks: tasks.length,
    recentSessions: aliveSessions.slice(0, 5),
    tokenTimeSeries: tokenTimeSeries.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    ),
  };
}

// ── Scheduled Tasks (not supported by Codex) ─────────────────────────────────

export async function getScheduledTasks(): Promise<ScheduledTask[]> {
  return [];
}

// ── Plugins / Skills ─────────────────────────────────────────────────────────

export async function getInstalledPlugins(): Promise<InstalledPlugin[]> {
  const skillsDir = path.join(CODEX_DIR, "skills");
  if (!fs.existsSync(skillsDir)) return [];

  try {
    const entries = await fs.promises.readdir(skillsDir, { withFileTypes: true });
    const plugins: InstalledPlugin[] = [];

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        const name = entry.name.replace(/\.md$/, "");
        const stat = await fs.promises.stat(path.join(skillsDir, entry.name));
        plugins.push({
          name,
          marketplace: "codex-skills",
          scope: "user",
          version: "local",
          installedAt: stat.birthtime.toISOString(),
          lastUpdated: stat.mtime.toISOString(),
        });
      }
    }

    return plugins.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

// ── System Status ────────────────────────────────────────────────────────────

export async function getCodexProviderStatus(): Promise<ProviderStatus> {
  let cliVersion = "unknown";
  try {
    cliVersion = execFileSync("codex", ["--version"], {
      timeout: 3000,
      encoding: "utf-8",
    }).trim();
  } catch {
    // CLI not installed or not in PATH
  }

  let apiStatus: "operational" | "degraded" | "unknown" = "unknown";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch("https://status.openai.com/api/v2/status.json", {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const json = await res.json();
      const indicator = json?.status?.indicator;
      apiStatus = indicator === "none" ? "operational" : "degraded";
    }
  } catch {
    // Network error or timeout
  }

  return { cliVersion, apiStatus };
}

export async function getSystemStatus(): Promise<SystemStatus> {
  const [codex, sessions] = await Promise.all([
    getCodexProviderStatus(),
    getActiveSessions(),
  ]);
  return {
    codex,
    activeSessions: sessions.filter((s) => s.isAlive).length,
  };
}
