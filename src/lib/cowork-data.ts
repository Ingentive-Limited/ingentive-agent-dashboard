/**
 * Cowork data reader.
 *
 * Cowork sessions are the "live agent" sessions spawned by the Claude
 * Desktop app (the Cowork experience). Each session is recorded under:
 *
 *   <app-data-dir>/local-agent-mode-sessions/<account>/<workspace>/local_<uuid>.json
 *
 * That file is the session manifest (title, cwd, model, timestamps, etc.).
 * The sibling directory `<...>/local_<uuid>/` contains the actual transcript
 * at `audit.jsonl`, which follows the same Claude Code JSONL shape (user /
 * assistant messages with token-usage records on assistant turns), plus a
 * couple of audit fields we ignore.
 *
 * Unlike Claude Code, Cowork sessions are not OS processes — they're driven
 * by the Desktop app — so liveness has to come from `lastActivityAt` rather
 * than a PID check. They also can't be resumed via CLI, so the "open in
 * terminal" action is a no-op for Cowork sessions.
 */

import fs from "fs";
import path from "path";
import os from "os";
import type {
  ClaudeSession,
  SessionStatus,
  TokenUsage,
  TokenDataPoint,
  CostEstimate,
  ProjectSummary,
  ProjectDetail,
  ProjectSession,
  ScheduledTask,
  DashboardOverview,
  SessionHistory,
  ConversationMessage,
  SearchResult,
  DailyTokenUsage,
  ProjectStats,
  InstalledPlugin,
  ProviderStatus,
} from "./types";
import {
  emptyTokenUsage,
  addTokens,
  readLastLines,
  projectNameFromPath,
  calculateCost,
  isWithinDir,
  formatLocalDate,
} from "./utils-server";

// Cowork runs on Anthropic models — use the same Sonnet 4 pricing as Claude.
const COWORK_PRICING = {
  input: 3.0 / 1_000_000,
  output: 15.0 / 1_000_000,
  cacheWrite: 3.75 / 1_000_000,
  cacheRead: 0.30 / 1_000_000,
};

function calculateCoworkCost(tokens: TokenUsage): CostEstimate {
  return calculateCost(tokens, COWORK_PRICING);
}

const IS_WIN = process.platform === "win32";

/** Platform-specific Claude Desktop app data directory. */
function getAppDataDir(): string {
  if (IS_WIN) {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
      "Claude"
    );
  }
  if (process.platform === "linux") {
    return path.join(
      process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
      "Claude"
    );
  }
  return path.join(os.homedir(), "Library", "Application Support", "Claude");
}

const COWORK_ROOT = path.join(getAppDataDir(), "local-agent-mode-sessions");

/** Shape of the `local_<uuid>.json` manifest written by the Desktop app. */
interface CoworkManifest {
  sessionId: string;
  processName?: string;
  cliSessionId?: string;
  cwd?: string;
  userSelectedFolders?: string[];
  createdAt?: number;
  lastActivityAt?: number;
  model?: string;
  isArchived?: boolean;
  title?: string;
  initialMessage?: string;
  hostLoopMode?: boolean;
  slashCommands?: string[];
}

interface DiscoveredManifest {
  manifest: CoworkManifest;
  /** Full path to the `local_<uuid>.json` file. */
  manifestPath: string;
  /** Workspace UUID (the parent directory between account and the manifest). */
  workspaceId: string;
  /** Account UUID (the directory under local-agent-mode-sessions). */
  accountId: string;
}

function coworkRootExists(): boolean {
  return fs.existsSync(COWORK_ROOT);
}

// Module-level cache for the manifest discovery walk. The dashboard polls
// /api/overview and /api/tokens/daily every 5 seconds; without this cache,
// every poll re-walks the entire local-agent-mode-sessions tree and re-parses
// every manifest JSON. A 5s TTL keeps the UI responsive while still picking up
// new sessions within one polling cycle.
let manifestsCache: DiscoveredManifest[] | null = null;
let manifestsCacheAt = 0;
const MANIFESTS_TTL_MS = 5_000;

/**
 * Walk `local-agent-mode-sessions/<account>/<workspace>/local_*.json` and
 * return each parsed manifest along with its account + workspace identifiers.
 * Returns an empty list if Cowork data isn't present.
 */
async function discoverManifests(): Promise<DiscoveredManifest[]> {
  const now = Date.now();
  if (manifestsCache && now - manifestsCacheAt < MANIFESTS_TTL_MS) {
    return manifestsCache;
  }

  if (!coworkRootExists()) {
    manifestsCache = [];
    manifestsCacheAt = now;
    return manifestsCache;
  }

  const results: DiscoveredManifest[] = [];

  let accountDirs: string[];
  try {
    accountDirs = await fs.promises.readdir(COWORK_ROOT);
  } catch {
    return [];
  }

  for (const accountId of accountDirs) {
    const accountPath = path.join(COWORK_ROOT, accountId);
    // Defense-in-depth: skip non-UUID-looking directories like `skills-plugin`.
    // We only want to enumerate per-account session trees.
    if (!isWithinDir(accountPath, COWORK_ROOT)) continue;
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(accountPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    let workspaceDirs: string[];
    try {
      workspaceDirs = await fs.promises.readdir(accountPath);
    } catch {
      continue;
    }

    for (const workspaceId of workspaceDirs) {
      const workspacePath = path.join(accountPath, workspaceId);
      if (!isWithinDir(workspacePath, COWORK_ROOT)) continue;

      let entries: string[];
      try {
        entries = await fs.promises.readdir(workspacePath);
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.startsWith("local_") || !entry.endsWith(".json")) continue;
        const manifestPath = path.join(workspacePath, entry);
        if (!isWithinDir(manifestPath, COWORK_ROOT)) continue;
        try {
          const raw = await fs.promises.readFile(manifestPath, "utf-8");
          const manifest = JSON.parse(raw) as CoworkManifest;
          if (!manifest || typeof manifest.sessionId !== "string") continue;
          results.push({ manifest, manifestPath, workspaceId, accountId });
        } catch {
          // Skip malformed manifests rather than failing the whole scan.
        }
      }
    }
  }

  manifestsCache = results;
  manifestsCacheAt = now;
  return results;
}

/** Resolve the audit.jsonl transcript path for a given manifest. */
function transcriptPathFor(manifestPath: string): string {
  // local_<uuid>.json sits next to a local_<uuid>/ directory.
  const dir = manifestPath.replace(/\.json$/, "");
  return path.join(dir, "audit.jsonl");
}

/**
 * Determine session status by reading the tail of the audit JSONL.
 *
 * Cowork audit entries broadly match Claude Code's: `type: "user" | "assistant"`,
 * with assistant turns carrying `message.content` (array of blocks) and a
 * `message.stop_reason`. We use the same heuristic as Claude Code:
 *   - assistant with stop_reason=end_turn → awaiting_input
 *   - assistant with AskUserQuestion / ExitPlanMode → needs_attention
 *   - user message → processing
 *   - otherwise → idle
 *
 * Exported for unit testing.
 */
export function getStatusFromAudit(auditPath: string | null): {
  status: SessionStatus;
  lastMessage?: string;
} {
  if (!auditPath || !fs.existsSync(auditPath)) return { status: "idle" };

  try {
    // The audit file can grow large; only read the tail. 8KB is enough for
    // the last few turn entries.
    const stat = fs.statSync(auditPath);
    const readSize = Math.min(stat.size, 8192);
    const buf = Buffer.alloc(readSize);
    const fd = fs.openSync(auditPath, "r");
    fs.readSync(fd, buf, 0, readSize, Math.max(0, stat.size - readSize));
    fs.closeSync(fd);

    const tail = buf.toString("utf-8");
    const lines = tail.split("\n").filter((l) => l.trim());
    if (lines.length === 0) return { status: "idle" };

    for (let i = lines.length - 1; i >= 0; i--) {
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(lines[i]) as Record<string, unknown>;
      } catch {
        continue;
      }
      const type = entry.type as string | undefined;

      // System/init/result entries don't tell us about the conversation turn.
      if (type === "system" || type === "result") continue;

      if (type === "assistant") {
        const message = entry.message as Record<string, unknown> | undefined;
        if (!message) return { status: "running" };
        const content = message.content as Array<Record<string, unknown>> | undefined;
        const stopReason = message.stop_reason as string | undefined;

        if (Array.isArray(content)) {
          const hasAskUser = content.some(
            (c) => c.type === "tool_use" && c.name === "AskUserQuestion"
          );
          if (hasAskUser) return { status: "needs_attention" };
          const hasExitPlan = content.some(
            (c) => c.type === "tool_use" && c.name === "ExitPlanMode"
          );
          if (hasExitPlan) return { status: "needs_attention" };
        }

        if (stopReason === "end_turn") {
          let lastMessage: string | undefined;
          if (Array.isArray(content)) {
            const textBlock = content.find((c) => c.type === "text");
            if (textBlock && typeof textBlock.text === "string") {
              lastMessage = (textBlock.text as string).slice(0, 200);
            }
          }
          return { status: "awaiting_input", lastMessage };
        }

        if (stopReason === "tool_use") return { status: "running" };
        // No stop_reason set → still generating.
        return { status: "running" };
      }

      if (type === "user") {
        return { status: "processing" };
      }
    }
  } catch {
    return { status: "idle" };
  }

  return { status: "idle" };
}

/**
 * Build a ClaudeSession (the dashboard's shared session type) from a Cowork
 * manifest. Liveness uses `lastActivityAt` since there's no OS process to
 * probe — anything within 30 seconds is considered "live".
 */
function manifestToSession(item: DiscoveredManifest): ClaudeSession {
  const m = item.manifest;
  const now = Date.now();
  const lastActivity = m.lastActivityAt ?? m.createdAt ?? 0;
  const ageMs = now - lastActivity;
  const cwd = m.cwd || "";

  let status: SessionStatus;
  let lastMessage: string | undefined = m.initialMessage?.slice(0, 200);

  if (m.isArchived) {
    status = "dead";
  } else if (ageMs < 30_000) {
    status = "running";
  } else {
    const transcript = transcriptPathFor(item.manifestPath);
    const fromAudit = getStatusFromAudit(transcript);
    status = fromAudit.status;
    if (fromAudit.lastMessage) lastMessage = fromAudit.lastMessage;
  }

  // Use the human-readable `title` if present; fall back to the Cowork
  // process name (the friendly slug) so the row never shows just a UUID.
  const projectName =
    m.title?.trim() ||
    m.processName ||
    projectNameFromPath(cwd) ||
    "Cowork session";

  return {
    pid: 0,
    sessionId: m.sessionId,
    cwd,
    startedAt: m.createdAt ?? lastActivity,
    kind: "task",
    entrypoint: "cowork",
    isAlive: !m.isArchived,
    status,
    projectName,
    lastMessage,
    slug: m.processName,
    provider: "cowork",
    model: m.model,
  };
}

// Module-level cache for parsed token totals per audit file. Audit JSONL files
// grow monotonically (entries are only appended), so the token total can only
// change when the file's mtime or size changes. Keying by both mtime and size
// guards against rapid writes that land within the same millisecond, which
// would otherwise hand back stale token counts.
interface CachedTokens {
  mtimeMs: number;
  size: number;
  tokens: TokenUsage;
}
const tokensCache = new Map<string, CachedTokens>();

/**
 * Sum the `usage` fields from every assistant turn in a Cowork audit.jsonl.
 * Each assistant entry's `message.usage` has the standard Anthropic shape
 * (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`,
 * `cache_read_input_tokens`).
 */
async function tokensFromAudit(auditPath: string): Promise<TokenUsage> {
  if (!fs.existsSync(auditPath)) return emptyTokenUsage();

  let stat: fs.Stats;
  try {
    stat = fs.statSync(auditPath);
  } catch {
    return emptyTokenUsage();
  }

  const cached = tokensCache.get(auditPath);
  if (
    cached &&
    cached.mtimeMs === stat.mtimeMs &&
    cached.size === stat.size
  ) {
    return cached.tokens;
  }

  let total = emptyTokenUsage();
  try {
    // Read up to ~5000 lines from the tail — enough for very long sessions
    // without paying to stream multi-MB files.
    const lines = await readLastLines(auditPath, 5000);
    for (const line of lines) {
      // Cheap string prefilter: JSON.parse on a multi-KB line costs ~10–100µs,
      // so for the typical audit file (~80% of lines are non-assistant
      // events like tool_use_block, queue-operation, etc.) the prefilter
      // gives us a 5–10× speedup on the cold scan.
      if (line.indexOf('"usage"') === -1 || line.indexOf('"input_tokens"') === -1) {
        continue;
      }
      try {
        const entry = JSON.parse(line);
        if (entry.type !== "assistant") continue;
        const usage = entry.message?.usage;
        if (!usage) continue;
        total = addTokens(total, {
          input_tokens: usage.input_tokens || 0,
          output_tokens: usage.output_tokens || 0,
          cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
          cache_read_input_tokens: usage.cache_read_input_tokens || 0,
        });
      } catch {
        // skip
      }
    }
  } catch {
    // ignore
  }

  tokensCache.set(auditPath, {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    tokens: total,
  });
  return total;
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export async function getActiveSessions(): Promise<ClaudeSession[]> {
  const manifests = await discoverManifests();
  return manifests
    .filter((m) => !m.manifest.isArchived)
    .map(manifestToSession)
    .sort((a, b) => b.startedAt - a.startedAt);
}

// ── Projects ─────────────────────────────────────────────────────────────────
//
// Cowork sessions live in workspaces, not user filesystem projects. We
// expose each workspace as a "project" so users can drill into the sessions
// they ran from a given Cowork workspace.

export async function getProjects(): Promise<ProjectSummary[]> {
  const manifests = await discoverManifests();
  if (manifests.length === 0) return [];

  // Group by workspaceId
  const byWorkspace = new Map<string, DiscoveredManifest[]>();
  for (const m of manifests) {
    const list = byWorkspace.get(m.workspaceId) ?? [];
    list.push(m);
    byWorkspace.set(m.workspaceId, list);
  }

  const summaries: ProjectSummary[] = [];
  for (const [workspaceId, items] of byWorkspace.entries()) {
    // Read tokens for each session in parallel — these are independent local
    // FS reads, and serializing them was the main cold-start bottleneck.
    const tokensPerItem = await Promise.all(
      items.map((item) => tokensFromAudit(transcriptPathFor(item.manifestPath)))
    );
    let totalTokens = emptyTokenUsage();
    let lastActivity = 0;
    for (let i = 0; i < items.length; i++) {
      totalTokens = addTokens(totalTokens, tokensPerItem[i]);
      const t =
        items[i].manifest.lastActivityAt ?? items[i].manifest.createdAt ?? 0;
      if (t > lastActivity) lastActivity = t;
    }
    // Use the most-recent session's title as the project label so users see
    // something meaningful rather than the bare workspace UUID.
    const sortedItems = [...items].sort(
      (a, b) =>
        (b.manifest.lastActivityAt ?? 0) - (a.manifest.lastActivityAt ?? 0)
    );
    const label =
      sortedItems[0]?.manifest.title?.trim() ||
      `Cowork workspace ${workspaceId.slice(0, 8)}`;

    summaries.push({
      id: `cowork-${workspaceId}`,
      path: workspaceId,
      name: label,
      sessionCount: items.length,
      lastActivity: new Date(lastActivity || Date.now()).toISOString(),
      totalTokens,
      cost: calculateCoworkCost(totalTokens),
    });
  }

  return summaries.sort(
    (a, b) =>
      new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
  );
}

export async function getProjectDetail(
  projectId: string
): Promise<ProjectDetail | null> {
  if (!projectId.startsWith("cowork-")) return null;
  const workspaceId = projectId.slice("cowork-".length);

  const manifests = await discoverManifests();
  const items = manifests.filter((m) => m.workspaceId === workspaceId);
  if (items.length === 0) return null;

  let totalTokens = emptyTokenUsage();
  const sessions: ProjectSession[] = [];
  const tokenTimeSeries: TokenDataPoint[] = [];
  let cumulativeInput = 0;
  let cumulativeOutput = 0;
  let lastActivity = 0;

  const sorted = [...items].sort(
    (a, b) => (a.manifest.createdAt ?? 0) - (b.manifest.createdAt ?? 0)
  );
  // First pass: read tokens for every session in parallel. Cumulative totals
  // depend on createdAt ordering, so we resolve them all first and then walk
  // in order in the second pass.
  const tokensPerItem = await Promise.all(
    sorted.map((item) => tokensFromAudit(transcriptPathFor(item.manifestPath)))
  );
  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    const tokens = tokensPerItem[i];
    totalTokens = addTokens(totalTokens, tokens);
    cumulativeInput += tokens.input_tokens;
    cumulativeOutput += tokens.output_tokens;

    const created = item.manifest.createdAt ?? 0;
    const updated = item.manifest.lastActivityAt ?? created;
    if (updated > lastActivity) lastActivity = updated;

    sessions.push({
      sessionId: item.manifest.sessionId,
      messageCount: 0, // would need to parse audit fully to count
      totalTokens: tokens,
      firstMessage: new Date(created || Date.now()).toISOString(),
      lastMessage: new Date(updated || Date.now()).toISOString(),
    });

    tokenTimeSeries.push({
      timestamp: new Date(created || Date.now()).toISOString(),
      ...tokens,
      cumulative_input: cumulativeInput,
      cumulative_output: cumulativeOutput,
    });
  }

  return {
    id: projectId,
    path: workspaceId,
    name:
      sorted[sorted.length - 1].manifest.title?.trim() ||
      `Cowork workspace ${workspaceId.slice(0, 8)}`,
    sessionCount: items.length,
    lastActivity: new Date(lastActivity || Date.now()).toISOString(),
    totalTokens,
    cost: calculateCoworkCost(totalTokens),
    sessions,
    subagents: [],
    memoryFiles: [],
    tokenTimeSeries,
  };
}

// ── Session History ──────────────────────────────────────────────────────────

export async function getSessionHistory(): Promise<SessionHistory[]> {
  const manifests = await discoverManifests();
  if (manifests.length === 0) return [];

  // Read all audit files in parallel — sequential awaits used to dominate
  // cold-start latency. The mtime+size cache makes subsequent calls free.
  const tokensPerItem = await Promise.all(
    manifests.map((item) => tokensFromAudit(transcriptPathFor(item.manifestPath)))
  );

  const history: SessionHistory[] = manifests.map((item, idx) => {
    const m = item.manifest;
    const tokens = tokensPerItem[idx];
    const status: SessionStatus = m.isArchived ? "dead" : "idle";
    return {
      sessionId: m.sessionId,
      projectName:
        m.title?.trim() ||
        m.processName ||
        `Cowork workspace ${item.workspaceId.slice(0, 8)}`,
      cwd: m.cwd || "",
      startedAt: m.createdAt ?? 0,
      endedAt: m.isArchived
        ? new Date(m.lastActivityAt ?? Date.now()).toISOString()
        : undefined,
      entrypoint: "cowork",
      totalTokens: tokens,
      cost: calculateCoworkCost(tokens),
      messageCount: 0,
      status,
      provider: "cowork" as const,
    };
  });

  return history.sort((a, b) => b.startedAt - a.startedAt);
}

// ── Token Usage ──────────────────────────────────────────────────────────────

export async function getDailyTokenUsage(days = 30): Promise<DailyTokenUsage[]> {
  const manifests = await discoverManifests();
  if (manifests.length === 0) return fillEmptyDays(days);

  // Aggregate tokens by calendar day of session creation.
  const byDay = new Map<string, TokenUsage>();
  const sessionsByDay = new Map<string, number>();

  // Only sessions created within the requested window can contribute to the
  // result; pre-filter so we don't pay the audit-read cost for every manifest
  // ever recorded.
  const cutoff = Date.now() - days * 86_400_000;
  const relevant = manifests.filter((item) => {
    const created = item.manifest.createdAt ?? 0;
    return created > 0 && created >= cutoff;
  });

  // Read all audit files in parallel — these are independent FS reads and
  // sequential awaits were the dominant cold-start cost.
  const tokensPerItem = await Promise.all(
    relevant.map((item) => tokensFromAudit(transcriptPathFor(item.manifestPath)))
  );

  for (let i = 0; i < relevant.length; i++) {
    const created = relevant[i].manifest.createdAt ?? 0;
    const dateStr = formatLocalDate(new Date(created));
    const tokens = tokensPerItem[i];
    byDay.set(dateStr, addTokens(byDay.get(dateStr) ?? emptyTokenUsage(), tokens));
    sessionsByDay.set(dateStr, (sessionsByDay.get(dateStr) ?? 0) + 1);
  }

  const result: DailyTokenUsage[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = formatLocalDate(d);
    const tokens = byDay.get(dateStr) ?? emptyTokenUsage();
    result.push({
      date: dateStr,
      ...tokens,
      totalCost: calculateCoworkCost(tokens).totalCost,
      sessionCount: sessionsByDay.get(dateStr) ?? 0,
    });
  }
  return result;
}

function fillEmptyDays(days: number): DailyTokenUsage[] {
  const result: DailyTokenUsage[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    result.push({
      date: formatLocalDate(d),
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      totalCost: 0,
      sessionCount: 0,
    });
  }
  return result;
}

export async function getProjectStats(): Promise<ProjectStats[]> {
  const projects = await getProjects();
  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    totalTokens: p.totalTokens,
    cost: p.cost,
    sessionCount: p.sessionCount,
    lastActivity: p.lastActivity,
    errorCount: 0,
    successCount: p.sessionCount,
    errorRate: 0,
  }));
}

// ── Search ───────────────────────────────────────────────────────────────────

export async function searchAll(query: string): Promise<SearchResult[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const manifests = await discoverManifests();
  const results: SearchResult[] = [];
  for (const item of manifests) {
    const m = item.manifest;
    const haystack = [
      m.title ?? "",
      m.processName ?? "",
      m.initialMessage ?? "",
      m.cwd ?? "",
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(q)) continue;
    results.push({
      type: "session",
      title: m.title?.trim() || m.processName || "Cowork session",
      subtitle: m.cwd || `Cowork workspace ${item.workspaceId.slice(0, 8)}`,
      href: `/sessions?id=${m.sessionId}`,
      snippet: m.initialMessage?.slice(0, 200),
    });
    if (results.length >= 20) break;
  }
  return results;
}

// ── Conversation ─────────────────────────────────────────────────────────────

/**
 * Resolve the audit.jsonl path for a Cowork session, with defense-in-depth
 * path validation so a malformed sessionId can't be used to escape the
 * Cowork root directory.
 */
export async function findSessionJsonl(sessionId: string): Promise<string | null> {
  // Cowork session IDs are UUIDs — strict allowlist.
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) return null;
  const manifests = await discoverManifests();
  const match = manifests.find((m) => m.manifest.sessionId === sessionId);
  if (!match) return null;
  const transcript = transcriptPathFor(match.manifestPath);
  if (!isWithinDir(transcript, COWORK_ROOT)) return null;
  return fs.existsSync(transcript) ? transcript : null;
}

/**
 * Synchronous variant used by API routes that already validate the sessionId.
 * Returns null if the transcript can't be found in the time available.
 */
export function findSessionJsonlSync(sessionId: string): string | null {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) return null;
  if (!coworkRootExists()) return null;

  // Cheap sync scan: walk the directory tree until we find a manifest with
  // matching sessionId. We accept the O(n) cost because Cowork session counts
  // are typically small (tens, not thousands).
  try {
    const accounts = fs.readdirSync(COWORK_ROOT);
    for (const account of accounts) {
      const accountPath = path.join(COWORK_ROOT, account);
      if (!fs.statSync(accountPath).isDirectory()) continue;
      const workspaces = fs.readdirSync(accountPath);
      for (const ws of workspaces) {
        const wsPath = path.join(accountPath, ws);
        if (!fs.statSync(wsPath).isDirectory()) continue;
        const entries = fs.readdirSync(wsPath);
        for (const entry of entries) {
          if (!entry.startsWith("local_") || !entry.endsWith(".json")) continue;
          const manifestPath = path.join(wsPath, entry);
          try {
            const raw = fs.readFileSync(manifestPath, "utf-8");
            const m = JSON.parse(raw) as CoworkManifest;
            if (m.sessionId === sessionId) {
              const transcript = transcriptPathFor(manifestPath);
              if (!isWithinDir(transcript, COWORK_ROOT)) return null;
              return fs.existsSync(transcript) ? transcript : null;
            }
          } catch {
            // skip malformed manifests
          }
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

export async function readConversationLines(filePath: string, n: number): Promise<string[]> {
  return readLastLines(filePath, n);
}

export async function getConversationPreview(
  sessionId: string,
  maxMessages = 20
): Promise<ConversationMessage[]> {
  const transcript = await findSessionJsonl(sessionId);
  if (!transcript) return [];

  try {
    // Read ~5x maxMessages worth of lines: Cowork transcripts include user
    // messages, assistant turns, system events, and tool results — only some
    // of those become preview messages.
    const lines = await readLastLines(transcript, maxMessages * 5);
    const messages: ConversationMessage[] = [];

    for (const line of lines) {
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }

      const type = entry.type as string | undefined;
      const ts =
        (entry.timestamp as string | undefined) ||
        (entry._audit_timestamp as string | undefined) ||
        new Date().toISOString();

      if (type === "user") {
        const msg = (entry.message as Record<string, unknown> | undefined)
          ?.content;
        if (typeof msg === "string" && msg.trim()) {
          messages.push({
            role: "user",
            text: msg.slice(0, 500),
            timestamp: ts,
          });
        } else if (Array.isArray(msg)) {
          // Tool results show up as user messages with array content — skip
          // those, they're not part of the human-facing conversation.
          const textBlock = msg.find(
            (c: Record<string, unknown>) => c.type === "text"
          );
          if (textBlock && typeof textBlock.text === "string") {
            messages.push({
              role: "user",
              text: textBlock.text.slice(0, 500),
              timestamp: ts,
            });
          }
        }
      } else if (type === "assistant") {
        const content = (entry.message as Record<string, unknown> | undefined)
          ?.content;
        if (Array.isArray(content)) {
          const textBlocks = content
            .filter((c: Record<string, unknown>) => c.type === "text")
            .map((c: Record<string, unknown>) => String(c.text ?? ""))
            .filter((t: string) => t.trim());
          if (textBlocks.length > 0) {
            messages.push({
              role: "assistant",
              text: textBlocks.join("\n").slice(0, 500),
              timestamp: ts,
            });
          }
        }
      }
    }

    return messages.slice(-maxMessages);
  } catch {
    return [];
  }
}

export async function getSessionErrors(sessionId: string): Promise<string[]> {
  const transcript = await findSessionJsonl(sessionId);
  if (!transcript) return [];

  try {
    const lines = await readLastLines(transcript, 300);
    const errors: string[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        // Cowork audit entries flag errors via `is_error` on tool_result blocks
        // or `type: "result"` entries with `is_error: true`.
        if (entry.is_error || entry.error) {
          const msg =
            entry.error ||
            entry.message ||
            entry.result ||
            JSON.stringify(entry);
          errors.push(String(msg).slice(0, 300));
          continue;
        }
        const content = entry.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block?.is_error || block?.type === "tool_result_error") {
              const text =
                typeof block.content === "string"
                  ? block.content
                  : JSON.stringify(block.content);
              errors.push(text.slice(0, 300));
            }
          }
        }
      } catch {
        // skip
      }
    }
    return errors;
  } catch {
    return [];
  }
}

// ── Overview ─────────────────────────────────────────────────────────────────

export async function getOverview(): Promise<DashboardOverview> {
  const [sessions, projects] = await Promise.all([
    getActiveSessions(),
    getProjects(),
  ]);

  const aliveSessions = sessions.filter((s) => s.isAlive);
  const awaitingInput = aliveSessions.filter(
    (s) => s.status === "awaiting_input" || s.status === "needs_attention"
  ).length;

  let totalTokensToday = emptyTokenUsage();
  let totalTokensMonth = emptyTokenUsage();

  const daily = await getDailyTokenUsage(30);
  const todayStr = formatLocalDate(new Date());
  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStartStr = formatLocalDate(monthStart);

  for (const day of daily) {
    const dayTokens: TokenUsage = {
      input_tokens: day.input_tokens,
      output_tokens: day.output_tokens,
      cache_creation_input_tokens: day.cache_creation_input_tokens,
      cache_read_input_tokens: day.cache_read_input_tokens,
    };
    if (day.date === todayStr) {
      totalTokensToday = addTokens(totalTokensToday, dayTokens);
    }
    if (day.date >= monthStartStr) {
      totalTokensMonth = addTokens(totalTokensMonth, dayTokens);
    }
  }

  // Per-session token time series for the most recent projects. Fetch the
  // top-3 project details in parallel rather than sequentially.
  const tokenTimeSeries: TokenDataPoint[] = [];
  const recentProjects = projects.slice(0, 3);
  const recentDetails = await Promise.all(
    recentProjects.map((proj) => getProjectDetail(proj.id))
  );
  for (const detail of recentDetails) {
    if (detail) tokenTimeSeries.push(...detail.tokenTimeSeries);
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
    totalCost: calculateCoworkCost(totalTokensMonth),
    activeProjects: activeProjectCount,
    scheduledTasks: 0,
    recentSessions: aliveSessions.slice(0, 5),
    tokenTimeSeries: tokenTimeSeries.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    ),
  };
}

// ── Subagents / Scheduled Tasks / Plugins ────────────────────────────────────

// Cowork sessions can spawn child sessions via the Task tool but those are
// recorded inside the audit JSONL rather than as separate manifests; we don't
// surface them in v1.
export async function getScheduledTasks(): Promise<ScheduledTask[]> {
  // Cowork inherits Claude's scheduled-tasks system, which is already covered
  // by claude-data.ts. We don't double-count here.
  return [];
}

export async function getInstalledPlugins(): Promise<InstalledPlugin[]> {
  // Cowork plugins live alongside Claude plugins (~/.claude/plugins/...);
  // claude-data already enumerates them.
  return [];
}

// ── System Status ────────────────────────────────────────────────────────────

export async function getCoworkProviderStatus(): Promise<ProviderStatus> {
  // Cowork doesn't have its own CLI version — surface "n/a" rather than a
  // misleading "unknown" so the UI can render an appropriate label.
  const cliVersion = coworkRootExists() ? "via Claude Desktop" : "not installed";

  // Reuse Anthropic status (Cowork runs on Claude models).
  let apiStatus: "operational" | "degraded" | "unknown" = "unknown";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch("https://status.anthropic.com/api/v2/status.json", {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const json = await res.json();
      const indicator = json?.status?.indicator;
      apiStatus = indicator === "none" ? "operational" : "degraded";
    }
  } catch {
    // network error or timeout
  }

  return { cliVersion, apiStatus };
}

// Note: there's no provider-scoped `getSystemStatus()` for Cowork. The Cowork
// experience runs on the same Anthropic API as Claude Code, so health is
// represented by the Claude row in the system status bar. Callers that want
// just Cowork's CLI version + API health can use `getCoworkProviderStatus()`.
//
// Background cache warm-up lives in `startup-warmup.ts` to keep it consistent
// across all three providers — see that file for details.
