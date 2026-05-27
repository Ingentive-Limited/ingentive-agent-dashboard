import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline";
import { execFileSync } from "child_process";
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
  isPidAlive,
  isWithinDir,
  readLastLines,
  readIncrementalLines,
  cronToHuman,
  projectNameFromPath,
  calculateCost,
} from "./utils-server";
import { pricingForModel } from "./pricing";

/**
 * Compute cost for a Claude Code session using the model-aware pricing table.
 * Falls back to Sonnet 4 rates when the model isn't known (older JSONLs or
 * empty files), matching the previously hardcoded behaviour.
 */
function calculateClaudeCost(
  tokens: TokenUsage,
  model?: string | null
): CostEstimate {
  return calculateCost(tokens, pricingForModel(model, "claude"));
}

const IS_WIN = process.platform === "win32";
const CLAUDE_DIR = path.join(os.homedir(), ".claude");

// ── Per-file JSONL caches ────────────────────────────────────────────────────
//
// JSONL transcript files grow monotonically (entries are only appended), so
// any derived value can be cached and invalidated when the file's mtime or
// size changes. We key by both mtime and size together because rapid writes
// can land within the same millisecond (mtime collision) but the size will
// still differ. The same pattern is used in cowork-data.ts (tokensFromAudit).
//
// The dashboard polls /api/overview, /api/tokens/daily, and /api/history
// every few seconds; without these caches every poll fully re-parses every
// JSONL file in the projects tree.

interface TokenTimelineEntry {
  timestamp: string;
  usage: TokenUsage;
}

interface CachedTimeline {
  mtimeMs: number;
  size: number;
  /** Parsed assistant-turn usage entries from the tail of the file (last ~100 lines). */
  entries: TokenTimelineEntry[];
  /** Last `model` seen on an assistant turn in the scanned tail (or null). */
  model: string | null;
}

interface CachedHistory {
  mtimeMs: number;
  size: number;
  totalTokens: TokenUsage;
  messageCount: number;
  firstTimestamp: string;
  lastTimestamp: string;
  /** Last `model` seen on an assistant turn in the scanned tail (or null). */
  model: string | null;
}

interface CachedDailyTokens {
  mtimeMs: number;
  size: number;
  /** Tokens contributed by this file, bucketed by local date key (YYYY-MM-DD). */
  byDate: Map<string, TokenUsage>;
  /** Session ID derived from the filename — included so dailyMap can dedupe sessions per day. */
  sessionId: string;
  /** Last `model` seen on an assistant turn (or null) — used for per-file cost pricing. */
  model: string | null;
}

const timelineCache = new Map<string, CachedTimeline>();
const historyCache = new Map<string, CachedHistory>();
const dailyTokensCache = new Map<string, CachedDailyTokens>();

/**
 * Read the tail of a JSONL transcript and return parsed assistant usage
 * entries (timestamp + usage). Cached per file by mtime+size.
 *
 * `lineCount` controls how many trailing lines we scan; results are cached
 * keyed by file path alone — a caller that wants more lines than a previous
 * caller will still get the cached (shorter) tail rather than rereading.
 * In practice both `getProjects` and `getOverview` read the last 100 lines,
 * so this is fine; if that ever changes we can include `lineCount` in the
 * cache key.
 */
async function readTokenTimeline(
  filePath: string,
  lineCount = 100
): Promise<{ entries: TokenTimelineEntry[]; model: string | null }> {
  const cached = timelineCache.get(filePath);
  const cachedSize = cached?.size ?? 0;
  const cachedMtimeMs = cached?.mtimeMs ?? 0;

  let inc;
  try {
    inc = await readIncrementalLines(filePath, cachedSize, cachedMtimeMs);
  } catch {
    return cached
      ? { entries: cached.entries, model: cached.model }
      : { entries: [], model: null };
  }

  if (
    cached &&
    !inc.fullReparse &&
    inc.newLines.length === 0 &&
    inc.currentSize === cachedSize &&
    inc.currentMtimeMs === cachedMtimeMs
  ) {
    return { entries: cached.entries, model: cached.model };
  }

  // Helper: parse JSONL lines into timeline entries.
  const parse = (
    lines: string[]
  ): { entries: TokenTimelineEntry[]; model: string | null } => {
    const out: TokenTimelineEntry[] = [];
    let model: string | null = null;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type !== "assistant" || !entry.message?.usage || !entry.timestamp) continue;
        const u = entry.message.usage;
        out.push({
          timestamp: entry.timestamp,
          usage: {
            input_tokens: u.input_tokens || 0,
            output_tokens: u.output_tokens || 0,
            cache_creation_input_tokens: u.cache_creation_input_tokens || 0,
            cache_read_input_tokens: u.cache_read_input_tokens || 0,
          },
        });
        const m = entry.message?.model;
        if (typeof m === "string" && m.trim()) model = m;
      } catch {
        // skip
      }
    }
    return { entries: out, model };
  };

  let entries: TokenTimelineEntry[];
  let lastModel: string | null;
  if (inc.fullReparse || !cached) {
    try {
      const lines = await readLastLines(filePath, lineCount);
      const parsed = parse(lines);
      entries = parsed.entries;
      lastModel = parsed.model;
    } catch {
      entries = [];
      lastModel = null;
    }
  } else {
    const parsed = parse(inc.newLines);
    // Append the new entries to the cached tail; keep the bounded tail length
    // so the cache doesn't grow without limit on long-running sessions.
    const combined = cached.entries.concat(parsed.entries);
    entries = combined.length > lineCount ? combined.slice(-lineCount) : combined;
    lastModel = parsed.model ?? cached.model;
  }

  timelineCache.set(filePath, {
    mtimeMs: inc.currentMtimeMs,
    size: inc.currentSize,
    entries,
    model: lastModel,
  });
  return { entries, model: lastModel };
}

/**
 * Get the Claude Desktop app data directory (platform-specific).
 * macOS:   ~/Library/Application Support/Claude/
 * Windows: %APPDATA%/Claude/
 * Linux:   ~/.config/Claude/
 */
function getClaudeAppDataDir(): string {
  if (IS_WIN) {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Claude");
  }
  if (process.platform === "linux") {
    return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "Claude");
  }
  // macOS
  return path.join(os.homedir(), "Library", "Application Support", "Claude");
}


// Build a mapping of encoded project dir names to real paths from session cwds
let projectPathCache: Map<string, string> | null = null;
let projectPathCacheTime: number | null = null;

async function buildProjectPathCache(): Promise<Map<string, string>> {
  // Cache for 30s to avoid re-reading on every request
  if (projectPathCache && projectPathCacheTime && Date.now() - projectPathCacheTime < 30000) {
    return projectPathCache;
  }
  const cache = new Map<string, string>();

  // Read all session files in parallel to get real cwds. Sequential awaits
  // here were a noticeable cold-start cost on machines with hundreds of
  // historic sessions.
  const sessionsDir = path.join(CLAUDE_DIR, "sessions");
  if (fs.existsSync(sessionsDir)) {
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".json"));
    const sessionCwds = await Promise.all(
      files.map(async (file) => {
        try {
          const content = await fs.promises.readFile(
            path.join(sessionsDir, file),
            "utf-8"
          );
          const data = JSON.parse(content);
          if (typeof data.cwd === "string" && data.cwd) {
            return data.cwd as string;
          }
        } catch {
          // skip
        }
        return null;
      })
    );
    for (const cwd of sessionCwds) {
      if (!cwd) continue;
      // Encode path: replace both / and \ with -
      const encoded = cwd.replace(/[\\/]/g, "-");
      cache.set(encoded, cwd);
    }
  }

  // Also scan JSONL files for session cwds. Read every directory's first
  // JSONL line in parallel rather than awaiting one at a time.
  const projectsDir = path.join(CLAUDE_DIR, "projects");
  if (fs.existsSync(projectsDir)) {
    const dirs = fs.readdirSync(projectsDir).filter((d) => !cache.has(d));
    const dirCwds = await Promise.all(
      dirs.map(async (dir) => {
        const projectPath = path.join(projectsDir, dir);
        try {
          const jsonlFiles = (await fs.promises.readdir(projectPath)).filter((f) =>
            f.endsWith(".jsonl")
          );
          if (jsonlFiles.length === 0) return null;
          const content = await fs.promises.readFile(
            path.join(projectPath, jsonlFiles[0]),
            "utf-8"
          );
          const firstLine = content.split("\n").find((l) => l.includes('"cwd"'));
          if (!firstLine) return null;
          const entry = JSON.parse(firstLine);
          return typeof entry.cwd === "string" && entry.cwd
            ? ({ dir, cwd: entry.cwd as string })
            : null;
        } catch {
          return null;
        }
      })
    );
    for (const result of dirCwds) {
      if (result) cache.set(result.dir, result.cwd);
    }
  }

  projectPathCache = cache;
  projectPathCacheTime = Date.now();
  return cache;
}

function decodeProjectPath(dirName: string): string {
  // Fallback: replace leading - with / (or \ on Windows) and remaining - with separator
  const sep = path.sep;
  if (IS_WIN) {
    // Windows encoded paths start with -C- or similar (C:\...)
    return dirName.replace(/-/g, sep);
  }
  return dirName.replace(/^-/, "/").replace(/-/g, "/");
}


// Determine session status from the last JSONL entry
function getSessionStatus(lastEntry: Record<string, unknown>): {
  status: SessionStatus;
  lastMessage?: string;
  slug?: string;
} {
  const type = lastEntry.type as string;
  const slug = lastEntry.slug as string | undefined;

  if (type === "assistant") {
    const message = lastEntry.message as Record<string, unknown> | undefined;
    if (message) {
      const content = message.content as Array<Record<string, unknown>>;
      const stopReason = message.stop_reason as string;

      // Check if this is an AskUserQuestion tool call
      if (Array.isArray(content)) {
        const hasAskUser = content.some(
          (c) => c.type === "tool_use" && c.name === "AskUserQuestion"
        );
        if (hasAskUser) {
          return { status: "needs_attention", slug };
        }

        // Check for ExitPlanMode (also needs user input)
        const hasExitPlan = content.some(
          (c) => c.type === "tool_use" && c.name === "ExitPlanMode"
        );
        if (hasExitPlan) {
          return { status: "needs_attention", slug };
        }
      }

      if (stopReason === "end_turn") {
        // Get the last text content for display
        let lastMsg: string | undefined;
        if (Array.isArray(content)) {
          const textBlock = content.find((c) => c.type === "text");
          if (textBlock) {
            lastMsg = (textBlock.text as string).slice(0, 200);
          }
        }
        return { status: "awaiting_input", lastMessage: lastMsg, slug };
      }

      if (stopReason === "tool_use") {
        return { status: "running", slug };
      }
    }
    return { status: "running", slug };
  }

  if (type === "user") {
    return { status: "processing", slug };
  }

  return { status: "idle", slug };
}

/** Validate that a resolved path stays within an expected base directory. */

/**
 * Read the last N lines of a JSONL conversation file.
 * Exported for use by the conversation API route to avoid full-file streaming.
 */
export async function readConversationLines(filePath: string, n: number): Promise<string[]> {
  return readLastLines(filePath, n);
}

// Get the session's JSONL file path by matching sessionId to project files
export function findSessionJsonl(sessionId: string): string | null {
  // Defense-in-depth: validate sessionId format even though callers should too
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) return null;

  const projectsDir = path.join(CLAUDE_DIR, "projects");
  if (!fs.existsSync(projectsDir)) return null;

  const projects = fs.readdirSync(projectsDir);
  for (const proj of projects) {
    const jsonlPath = path.join(projectsDir, proj, `${sessionId}.jsonl`);
    // Verify resolved path is within CLAUDE_DIR
    if (!isWithinDir(jsonlPath, CLAUDE_DIR)) continue;
    if (fs.existsSync(jsonlPath)) {
      return jsonlPath;
    }
  }
  return null;
}

export async function getActiveSessions(): Promise<ClaudeSession[]> {
  const sessionsDir = path.join(CLAUDE_DIR, "sessions");
  if (!fs.existsSync(sessionsDir)) return [];

  const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".json"));
  const sessions: ClaudeSession[] = [];

  for (const file of files) {
    try {
      const content = await fs.promises.readFile(
        path.join(sessionsDir, file),
        "utf-8"
      );
      const data = JSON.parse(content);
      const isAlive = isPidAlive(data.pid);

      let status: SessionStatus = isAlive ? "idle" : "dead";
      let lastMessage: string | undefined;
      let slug: string | undefined;

      if (isAlive) {
        const jsonlPath = findSessionJsonl(data.sessionId);
        if (jsonlPath) {
          try {
            const lastLines = await readLastLines(jsonlPath, 1);
            if (lastLines.length > 0) {
              const lastEntry = JSON.parse(lastLines[0]);
              const statusInfo = getSessionStatus(lastEntry);
              status = statusInfo.status;
              lastMessage = statusInfo.lastMessage;
              slug = statusInfo.slug;
            }
          } catch {
            // JSONL parsing failed, keep idle status
          }
        }
      }

      sessions.push({
        pid: data.pid,
        sessionId: data.sessionId,
        cwd: data.cwd,
        startedAt: data.startedAt,
        kind: data.kind,
        entrypoint: data.entrypoint,
        isAlive,
        status,
        projectName: projectNameFromPath(data.cwd),
        lastMessage,
        slug,
        provider: "claude",
      });
    } catch {
      // Skip invalid session files
    }
  }

  return sessions.sort((a, b) => b.startedAt - a.startedAt);
}

export async function getProjects(): Promise<ProjectSummary[]> {
  const projectsDir = path.join(CLAUDE_DIR, "projects");
  if (!fs.existsSync(projectsDir)) return [];

  const allEntries = await fs.promises.readdir(projectsDir, { withFileTypes: true });
  const dirs = allEntries.filter((d) => d.isDirectory()).map((d) => d.name);

  const projects: ProjectSummary[] = [];

  // Build a cwd-to-project mapping from sessions and JSONL files
  const pathCache = await buildProjectPathCache();

  for (const dir of dirs) {
    const projectPath = path.join(projectsDir, dir);
    const projEntries = await fs.promises.readdir(projectPath);
    const jsonlFiles = projEntries.filter((f) => f.endsWith(".jsonl"));

    let lastActivity = "";
    let totalTokens = emptyTokenUsage();

    // Quick scan: get last activity from file mtime
    const fileStats = await Promise.all(
      jsonlFiles.map(async (f) => {
        const stat = await fs.promises.stat(path.join(projectPath, f));
        return { name: f, mtime: stat.mtime };
      })
    );
    for (const { mtime } of fileStats) {
      const iso = mtime.toISOString();
      if (!lastActivity || iso > lastActivity) {
        lastActivity = iso;
      }
    }

    // Light token scan: read last 100 lines of most recent jsonl. Uses the
    // shared timeline cache so getOverview can reuse the same parsed entries.
    let projectModel: string | null = null;
    if (fileStats.length > 0) {
      const sortedFiles = fileStats
        .map((f) => ({ name: f.name, mtime: f.mtime.getTime() }))
        .sort((a, b) => b.mtime - a.mtime);

      const { entries, model } = await readTokenTimeline(
        path.join(projectPath, sortedFiles[0].name),
        100
      );
      projectModel = model;
      for (const e of entries) {
        totalTokens = addTokens(totalTokens, e.usage);
      }
    }

    const realPath = pathCache.get(dir) || decodeProjectPath(dir);

    projects.push({
      id: dir,
      path: realPath,
      name: projectNameFromPath(realPath),
      sessionCount: jsonlFiles.length,
      lastActivity,
      totalTokens,
      cost: calculateClaudeCost(totalTokens, projectModel),
      provider: "claude",
    });
  }

  return projects.sort(
    (a, b) =>
      new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
  );
}

export async function getProjectDetail(
  projectId: string
): Promise<ProjectDetail | null> {
  // Defense-in-depth: validate projectId format
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) return null;

  const projectPath = path.join(CLAUDE_DIR, "projects", projectId);
  // Verify resolved path stays within CLAUDE_DIR/projects
  if (!isWithinDir(projectPath, path.join(CLAUDE_DIR, "projects"))) return null;
  if (!fs.existsSync(projectPath)) return null;

  const jsonlFiles = fs.readdirSync(projectPath).filter((f) =>
    f.endsWith(".jsonl")
  );

  const projectSessions: ProjectSession[] = [];
  let totalTokens = emptyTokenUsage();
  let lastActivity = "";
  const tokenTimeSeries: TokenDataPoint[] = [];
  let cumulativeInput = 0;
  let cumulativeOutput = 0;
  // Per-session cost is summed so the project total reflects mixed-model use.
  let projectCost: CostEstimate = {
    inputCost: 0,
    outputCost: 0,
    cacheWriteCost: 0,
    cacheReadCost: 0,
    totalCost: 0,
  };

  for (const jsonl of jsonlFiles) {
    const sessionId = jsonl.replace(".jsonl", "");
    const filePath = path.join(projectPath, jsonl);
    let messageCount = 0;
    let sessionTokens = emptyTokenUsage();
    let firstMessage = "";
    let lastMessage = "";
    let sessionModel: string | null = null;

    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: fileStream });

    for await (const line of rl) {
      try {
        const entry = JSON.parse(line);
        if (entry.timestamp) {
          if (!firstMessage) firstMessage = entry.timestamp;
          lastMessage = entry.timestamp;
          if (!lastActivity || entry.timestamp > lastActivity) {
            lastActivity = entry.timestamp;
          }
        }

        if (entry.type === "assistant" && entry.message?.usage) {
          messageCount++;
          const u = entry.message.usage;
          const usage: TokenUsage = {
            input_tokens: u.input_tokens || 0,
            output_tokens: u.output_tokens || 0,
            cache_creation_input_tokens: u.cache_creation_input_tokens || 0,
            cache_read_input_tokens: u.cache_read_input_tokens || 0,
          };
          sessionTokens = addTokens(sessionTokens, usage);
          cumulativeInput += usage.input_tokens;
          cumulativeOutput += usage.output_tokens;
          const m = entry.message?.model;
          if (typeof m === "string" && m.trim()) sessionModel = m;

          tokenTimeSeries.push({
            timestamp: entry.timestamp,
            ...usage,
            cumulative_input: cumulativeInput,
            cumulative_output: cumulativeOutput,
            provider: "claude",
          });
        }
      } catch {
        // skip invalid lines
      }
    }

    totalTokens = addTokens(totalTokens, sessionTokens);
    const sessionCost = calculateClaudeCost(sessionTokens, sessionModel);
    projectCost = {
      inputCost: projectCost.inputCost + sessionCost.inputCost,
      outputCost: projectCost.outputCost + sessionCost.outputCost,
      cacheWriteCost: projectCost.cacheWriteCost + sessionCost.cacheWriteCost,
      cacheReadCost: projectCost.cacheReadCost + sessionCost.cacheReadCost,
      totalCost: projectCost.totalCost + sessionCost.totalCost,
    };
    projectSessions.push({
      sessionId,
      messageCount,
      totalTokens: sessionTokens,
      firstMessage,
      lastMessage,
    });
  }

  // Get subagents
  const subagents: SubagentMeta[] = [];
  for (const jsonl of jsonlFiles) {
    const sessionId = jsonl.replace(".jsonl", "");
    const subagentsDir = path.join(projectPath, sessionId, "subagents");
    if (fs.existsSync(subagentsDir)) {
      const metaFiles = fs
        .readdirSync(subagentsDir)
        .filter((f) => f.endsWith(".meta.json"));
      for (const meta of metaFiles) {
        try {
          const content = await fs.promises.readFile(
            path.join(subagentsDir, meta),
            "utf-8"
          );
          const data = JSON.parse(content);
          subagents.push({
            agentType: data.agentType || "unknown",
            description: data.description || "",
            sessionId,
          });
        } catch {
          // skip invalid meta files
        }
      }
    }
  }

  // Get memory files
  const memoryDir = path.join(projectPath, "memory");
  let memoryFiles: string[] = [];
  if (fs.existsSync(memoryDir)) {
    memoryFiles = fs
      .readdirSync(memoryDir)
      .filter((f) => f.endsWith(".md"));
  }

  const pathCache = await buildProjectPathCache();
  const realPath = pathCache.get(projectId) || decodeProjectPath(projectId);

  return {
    id: projectId,
    path: realPath,
    name: projectNameFromPath(realPath),
    sessionCount: jsonlFiles.length,
    lastActivity,
    totalTokens,
    cost: projectCost,
    sessions: projectSessions,
    subagents,
    memoryFiles,
    tokenTimeSeries: tokenTimeSeries.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    ),
  };
}


export async function getScheduledTasks(): Promise<ScheduledTask[]> {
  const tasks: ScheduledTask[] = [];
  const seenIds = new Set<string>();

  // 1. Check Claude Desktop local-agent-mode-sessions for scheduled-tasks.json
  const claudeAppSupport = path.join(
    getClaudeAppDataDir(),
    "local-agent-mode-sessions"
  );
  if (fs.existsSync(claudeAppSupport)) {
    // Walk through session dirs to find scheduled-tasks.json files
    try {
      const topDirs = fs.readdirSync(claudeAppSupport);
      for (const topDir of topDirs) {
        const topPath = path.join(claudeAppSupport, topDir);
        if (!fs.statSync(topPath).isDirectory()) continue;
        const subDirs = fs.readdirSync(topPath);
        for (const subDir of subDirs) {
          const stFile = path.join(topPath, subDir, "scheduled-tasks.json");
          if (!fs.existsSync(stFile)) continue;
          try {
            const content = await fs.promises.readFile(stFile, "utf-8");
            const data = JSON.parse(content);
            const stTasks = data.scheduledTasks || [];
            for (const t of stTasks) {
              const id = t.id || t.taskId;
              if (!id || seenIds.has(id)) continue;
              seenIds.add(id);
              // Derive project from userSelectedFolders
              let project: string | undefined;
              if (Array.isArray(t.userSelectedFolders) && t.userSelectedFolders.length > 0) {
                project = projectNameFromPath(t.userSelectedFolders[0]);
              }
              // Try to read SKILL.md for a better description
              let description = id.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
              if (t.filePath && isWithinDir(t.filePath, CLAUDE_DIR) && fs.existsSync(t.filePath)) {
                try {
                  const skillContent = await fs.promises.readFile(t.filePath, "utf-8");
                  const descMatch = skillContent.match(/description:\s*(.+)/);
                  if (descMatch) description = descMatch[1].trim();
                } catch {
                  // use default description
                }
              }
              tasks.push({
                taskId: id,
                description,
                schedule: t.cronExpression ? cronToHuman(t.cronExpression) : "",
                enabled: t.enabled !== false,
                project,
                lastRunAt: t.lastRunAt,
              });
            }
          } catch {
            // skip invalid file
          }
        }
      }
    } catch {
      // skip on error
    }
  }

  // 2. Check ~/.claude/scheduled-tasks/ directory (MCP scheduled-tasks tool)
  const tasksDir = path.join(CLAUDE_DIR, "scheduled-tasks");
  if (fs.existsSync(tasksDir)) {
    const taskDirs = fs.readdirSync(tasksDir).filter((d) => {
      return fs.statSync(path.join(tasksDir, d)).isDirectory();
    });

    for (const taskId of taskDirs) {
      const skillPath = path.join(tasksDir, taskId, "SKILL.md");
      if (!fs.existsSync(skillPath)) continue;

      try {
        const content = await fs.promises.readFile(skillPath, "utf-8");
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        let description = taskId;
        let schedule = "";
        let enabled = true;

        if (frontmatterMatch) {
          const fm = frontmatterMatch[1];
          const descMatch = fm.match(/description:\s*(.+)/);
          if (descMatch) description = descMatch[1].trim();
          const schedMatch = fm.match(/cron:\s*(.+)/);
          if (schedMatch) schedule = schedMatch[1].trim();
          const enabledMatch = fm.match(/enabled:\s*(.+)/);
          if (enabledMatch) enabled = enabledMatch[1].trim() !== "false";
        }

        seenIds.add(taskId);
        tasks.push({ taskId, description, schedule, enabled });
      } catch {
        // skip invalid task files
      }
    }
  }

  // 2. Check ~/.claude/scheduled_tasks.json (durable CronCreate tasks)
  const durablePath = path.join(CLAUDE_DIR, "scheduled_tasks.json");
  if (fs.existsSync(durablePath)) {
    try {
      const content = await fs.promises.readFile(durablePath, "utf-8");
      const data = JSON.parse(content);
      const durableTasks = Array.isArray(data) ? data : (data.tasks || []);
      for (const t of durableTasks) {
        const id = t.id || t.taskId || `durable-${tasks.length}`;
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        tasks.push({
          taskId: id,
          description: t.prompt?.slice(0, 100) || t.description || id,
          schedule: t.cron || "",
          enabled: t.recurring !== false,
          project: t.project,
        });
      }
    } catch {
      // skip invalid file
    }
  }

  // 3. Scan active sessions' JSONL for CronCreate tool calls
  const sessions = await getActiveSessions();
  const aliveSessions = sessions.filter((s) => s.isAlive);

  for (const session of aliveSessions) {
    const jsonlPath = findSessionJsonl(session.sessionId);
    if (!jsonlPath) continue;

    try {
      const fileStream = fs.createReadStream(jsonlPath);
      const rl = readline.createInterface({ input: fileStream });
      const cronCreates: Record<string, unknown>[] = [];
      const cronDeletes = new Set<string>();

      for await (const line of rl) {
        try {
          const entry = JSON.parse(line);
          if (entry.type === "assistant" && entry.message?.content) {
            const content = entry.message.content;
            if (Array.isArray(content)) {
              for (const c of content) {
                if (c.type === "tool_use" && c.name === "CronCreate") {
                  cronCreates.push(c.input);
                }
                if (c.type === "tool_use" && c.name === "CronDelete") {
                  cronDeletes.add(c.input?.id);
                }
              }
            }
          }
        } catch {
          // skip invalid lines
        }
      }

      for (const create of cronCreates) {
        const cron = create.cron as string || "";
        const prompt = create.prompt as string || "";
        const recurring = create.recurring !== false;
        const id = `session-${session.sessionId.slice(0, 8)}-${cron.replace(/\s/g, "")}`;
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        tasks.push({
          taskId: id,
          description: prompt.slice(0, 150),
          schedule: cron,
          enabled: recurring,
          project: session.projectName,
        });
      }
    } catch {
      // skip on error
    }
  }

  return tasks;
}

export async function getOverview(): Promise<DashboardOverview> {
  // Run the three independent fetches in parallel — sessions, projects, and
  // scheduled tasks don't share inputs, and serializing them was wasted wall
  // time on every dashboard poll.
  const [sessions, projects, tasks] = await Promise.all([
    getActiveSessions(),
    getProjects(),
    getScheduledTasks(),
  ]);
  const aliveSessions = sessions.filter((s) => s.isAlive);
  const awaitingInput = aliveSessions.filter(
    (s) => s.status === "awaiting_input" || s.status === "needs_attention"
  );

  // Aggregate tokens from all projects, and sum the already model-aware
  // per-project costs so the dashboard tile prices mixed-model use correctly.
  let todayTokens = emptyTokenUsage();
  let aggregateCost: CostEstimate = {
    inputCost: 0,
    outputCost: 0,
    cacheWriteCost: 0,
    cacheReadCost: 0,
    totalCost: 0,
  };

  for (const proj of projects) {
    todayTokens = addTokens(todayTokens, proj.totalTokens);
    aggregateCost = {
      inputCost: aggregateCost.inputCost + proj.cost.inputCost,
      outputCost: aggregateCost.outputCost + proj.cost.outputCost,
      cacheWriteCost: aggregateCost.cacheWriteCost + proj.cost.cacheWriteCost,
      cacheReadCost: aggregateCost.cacheReadCost + proj.cost.cacheReadCost,
      totalCost: aggregateCost.totalCost + proj.cost.totalCost,
    };
  }

  // Build a simple time series from recent project data. We re-derive the
  // most recent JSONL per project using readdir+stat in parallel, then read
  // each file via readTokenTimeline — which is cached by mtime+size, so when
  // getProjects already scanned the same file (it does, for the most-recent
  // jsonl) the entries come back from memory rather than re-parsing.
  const tokenTimeSeries: TokenDataPoint[] = [];
  const projectsDir = path.join(CLAUDE_DIR, "projects");
  if (fs.existsSync(projectsDir)) {
    const recentProjects = projects.slice(0, 3);
    const latestFiles = await Promise.all(
      recentProjects.map(async (proj) => {
        const projPath = path.join(projectsDir, proj.id);
        try {
          const files = await fs.promises.readdir(projPath);
          const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
          if (jsonlFiles.length === 0) return null;
          // Stat all candidates in parallel to find the most recent.
          const stats = await Promise.all(
            jsonlFiles.map(async (f) => ({
              name: f,
              mtimeMs: (await fs.promises.stat(path.join(projPath, f))).mtimeMs,
            }))
          );
          stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
          return path.join(projPath, stats[0].name);
        } catch {
          return null;
        }
      })
    );

    // Read timelines in parallel; the cache makes repeats cheap.
    const timelines = await Promise.all(
      latestFiles.map((fp) =>
        fp ? readTokenTimeline(fp, 100) : Promise.resolve({ entries: [], model: null })
      )
    );

    for (const t of timelines) {
      let cumIn = 0;
      let cumOut = 0;
      for (const e of t.entries) {
        cumIn += e.usage.input_tokens;
        cumOut += e.usage.output_tokens;
        tokenTimeSeries.push({
          timestamp: e.timestamp,
          ...e.usage,
          cumulative_input: cumIn,
          cumulative_output: cumOut,
          provider: "claude",
        });
      }
    }
  }

  tokenTimeSeries.sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Compute monthly tokens from the time series
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthStartMs = monthStart.getTime();

  let monthlyTokens = emptyTokenUsage();
  for (const point of tokenTimeSeries) {
    if (new Date(point.timestamp).getTime() >= monthStartMs) {
      monthlyTokens = addTokens(monthlyTokens, {
        input_tokens: point.input_tokens,
        output_tokens: point.output_tokens,
        cache_creation_input_tokens: point.cache_creation_input_tokens,
        cache_read_input_tokens: point.cache_read_input_tokens,
      });
    }
  }

  return {
    activeSessions: aliveSessions.length,
    awaitingInput: awaitingInput.length,
    totalTokensToday: todayTokens,
    totalTokensMonth: monthlyTokens,
    totalCost: aggregateCost,
    activeProjects: projects.filter((p) => {
      return (
        p.lastActivity &&
        new Date(p.lastActivity).getTime() > Date.now() - 24 * 60 * 60 * 1000
      );
    }).length,
    scheduledTasks: tasks.length,
    recentSessions: aliveSessions.slice(0, 5),
    tokenTimeSeries,
  };
}

// --- Session History (all sessions including dead) ---
export async function getSessionHistory(): Promise<SessionHistory[]> {
  const projectsDir = path.join(CLAUDE_DIR, "projects");
  if (!fs.existsSync(projectsDir)) return [];

  const activeSessions = await getActiveSessions();
  const aliveIds = new Set(activeSessions.filter((s) => s.isAlive).map((s) => s.sessionId));
  const pathCache = await buildProjectPathCache();

  const history: SessionHistory[] = [];
  const dirs = await fs.promises.readdir(projectsDir, { withFileTypes: true });

  // Collect every (jsonl, projectDir) pair, then read in parallel. The
  // dashboard's history page lists ~hundreds of JSONLs; the per-file cache
  // below makes the second poll near-instant, and parallelizing the cold
  // case removes the serial-await bottleneck.
  type JsonlRef = { sessionId: string; filePath: string; dirName: string };
  const refs: JsonlRef[] = [];
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const projPath = path.join(projectsDir, dir.name);
    let files: string[];
    try {
      files = await fs.promises.readdir(projPath);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      refs.push({
        sessionId: f.replace(".jsonl", ""),
        filePath: path.join(projPath, f),
        dirName: dir.name,
      });
    }
  }

  const items = await Promise.all(
    refs.map(async (ref) => {
      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(ref.filePath);
      } catch {
        return null;
      }

      let totalTokens: TokenUsage;
      let messageCount: number;
      let firstTimestamp: string;
      let lastTimestamp: string;
      let sessionModel: string | null;

      const cached = historyCache.get(ref.filePath);
      const cachedSize = cached?.size ?? 0;
      const cachedMtimeMs = cached?.mtimeMs ?? 0;

      let inc;
      try {
        inc = await readIncrementalLines(ref.filePath, cachedSize, cachedMtimeMs);
      } catch {
        inc = null;
      }

      if (
        cached &&
        inc &&
        !inc.fullReparse &&
        inc.newLines.length === 0 &&
        inc.currentSize === cachedSize &&
        inc.currentMtimeMs === cachedMtimeMs
      ) {
        totalTokens = cached.totalTokens;
        messageCount = cached.messageCount;
        firstTimestamp = cached.firstTimestamp;
        lastTimestamp = cached.lastTimestamp;
        sessionModel = cached.model;
      } else if (cached && inc && !inc.fullReparse) {
        // Incremental: fold new lines into the cached aggregate. firstTimestamp
        // stays fixed; lastTimestamp + totals + model + count grow.
        totalTokens = cached.totalTokens;
        messageCount = cached.messageCount;
        firstTimestamp = cached.firstTimestamp;
        lastTimestamp = cached.lastTimestamp;
        sessionModel = cached.model;
        for (const line of inc.newLines) {
          try {
            const entry = JSON.parse(line);
            if (entry.timestamp) {
              if (!firstTimestamp) firstTimestamp = entry.timestamp;
              lastTimestamp = entry.timestamp;
            }
            if (entry.type === "assistant" && entry.message?.usage) {
              messageCount++;
              const u = entry.message.usage;
              totalTokens = addTokens(totalTokens, {
                input_tokens: u.input_tokens || 0,
                output_tokens: u.output_tokens || 0,
                cache_creation_input_tokens: u.cache_creation_input_tokens || 0,
                cache_read_input_tokens: u.cache_read_input_tokens || 0,
              });
              const m = entry.message?.model;
              if (typeof m === "string" && m.trim()) sessionModel = m;
            }
          } catch { /* skip */ }
        }
        historyCache.set(ref.filePath, {
          mtimeMs: inc.currentMtimeMs,
          size: inc.currentSize,
          totalTokens,
          messageCount,
          firstTimestamp,
          lastTimestamp,
          model: sessionModel,
        });
      } else {
        // Full reparse: first read, rotation, or rewrite.
        totalTokens = emptyTokenUsage();
        messageCount = 0;
        firstTimestamp = "";
        lastTimestamp = "";
        sessionModel = null;
        try {
          const lines = await readLastLines(ref.filePath, 50);
          for (const line of lines) {
            try {
              const entry = JSON.parse(line);
              if (entry.timestamp) {
                if (!firstTimestamp) firstTimestamp = entry.timestamp;
                lastTimestamp = entry.timestamp;
              }
              if (entry.type === "assistant" && entry.message?.usage) {
                messageCount++;
                const u = entry.message.usage;
                totalTokens = addTokens(totalTokens, {
                  input_tokens: u.input_tokens || 0,
                  output_tokens: u.output_tokens || 0,
                  cache_creation_input_tokens: u.cache_creation_input_tokens || 0,
                  cache_read_input_tokens: u.cache_read_input_tokens || 0,
                });
                const m = entry.message?.model;
                if (typeof m === "string" && m.trim()) sessionModel = m;
              }
            } catch { /* skip */ }
          }
        } catch { /* skip */ }
        historyCache.set(ref.filePath, {
          mtimeMs: inc?.currentMtimeMs ?? stat.mtimeMs,
          size: inc?.currentSize ?? stat.size,
          totalTokens,
          messageCount,
          firstTimestamp,
          lastTimestamp,
          model: sessionModel,
        });
      }

      const realPath = pathCache.get(ref.dirName) || decodeProjectPath(ref.dirName);
      const active = activeSessions.find((s) => s.sessionId === ref.sessionId);

      return {
        sessionId: ref.sessionId,
        projectName: active?.projectName || projectNameFromPath(realPath),
        cwd: active?.cwd || realPath,
        startedAt: active?.startedAt || stat.birthtimeMs,
        endedAt: aliveIds.has(ref.sessionId)
          ? undefined
          : lastTimestamp || stat.mtime.toISOString(),
        entrypoint: active?.entrypoint || "cli",
        totalTokens,
        cost: calculateClaudeCost(totalTokens, sessionModel),
        messageCount,
        status: active?.status || (aliveIds.has(ref.sessionId) ? "running" : "dead"),
        provider: "claude" as const,
      } as SessionHistory;
    })
  );

  for (const item of items) {
    if (item) history.push(item);
  }

  return history.sort((a, b) => b.startedAt - a.startedAt);
}

// --- Conversation Preview (last N messages from a session) ---
export async function getConversationPreview(
  sessionId: string,
  maxMessages = 20
): Promise<ConversationMessage[]> {
  const jsonlPath = findSessionJsonl(sessionId);
  if (!jsonlPath) return [];

  const messages: ConversationMessage[] = [];
  try {
    const lines = await readLastLines(jsonlPath, maxMessages * 3); // read extra for non-message lines
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === "user") {
          let text = "";
          if (typeof entry.message === "string") {
            text = entry.message;
          } else if (entry.message?.content) {
            if (typeof entry.message.content === "string") {
              text = entry.message.content;
            } else if (Array.isArray(entry.message.content)) {
              text = entry.message.content
                .filter((c: Record<string, unknown>) => c.type === "text")
                .map((c: Record<string, unknown>) => c.text as string)
                .join("\n");
            }
          }
          if (text) {
            messages.push({
              role: "user",
              text: text.slice(0, 500),
              timestamp: entry.timestamp || "",
            });
          }
        } else if (entry.type === "assistant" && entry.message?.content) {
          const content = entry.message.content;
          let text = "";
          const toolUses: string[] = [];
          const errors: string[] = [];
          if (Array.isArray(content)) {
            for (const c of content) {
              if (c.type === "text") {
                text += (c.text as string || "");
              } else if (c.type === "tool_use") {
                toolUses.push(c.name as string);
              }
            }
          }
          // Check for errors in tool results
          if (entry.message?.stop_reason === "end_turn" && !text && toolUses.length === 0) {
            continue; // skip empty entries
          }
          if (text || toolUses.length > 0) {
            messages.push({
              role: "assistant",
              text: text.slice(0, 500),
              timestamp: entry.timestamp || "",
              toolUses: toolUses.length > 0 ? toolUses : undefined,
              errors: errors.length > 0 ? errors : undefined,
            });
          }
        } else if (entry.type === "tool_result" || entry.type === "result") {
          // Check for errors in tool results
          if (entry.is_error || entry.error) {
            const errMsg = typeof entry.content === "string"
              ? entry.content
              : (entry.error?.message || "Tool error");
            if (messages.length > 0) {
              const last = messages[messages.length - 1];
              if (!last.errors) last.errors = [];
              last.errors.push(errMsg.slice(0, 200));
            }
          }
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  return messages.slice(-maxMessages);
}

// --- Search across sessions, projects, and conversations ---
export async function searchAll(query: string): Promise<SearchResult[]> {
  const q = query.toLowerCase();
  const results: SearchResult[] = [];

  // Build the project-path cache once up front. Previously this was awaited
  // inside the conversation-content inner loop, which meant we paid the
  // (cached but still non-zero) lookup cost per matching line.
  const pathCache = await buildProjectPathCache();

  // Search projects
  const projects = await getProjects();
  for (const proj of projects) {
    if (proj.name.toLowerCase().includes(q) || proj.path.toLowerCase().includes(q)) {
      results.push({
        type: "project",
        title: proj.name,
        subtitle: `${proj.sessionCount} sessions`,
        href: `/projects/${encodeURIComponent(proj.id)}`,
      });
    }
  }

  // Search sessions
  const sessions = await getActiveSessions();
  for (const s of sessions) {
    if (
      s.projectName.toLowerCase().includes(q) ||
      s.sessionId.toLowerCase().includes(q) ||
      s.cwd.toLowerCase().includes(q) ||
      (s.slug && s.slug.toLowerCase().includes(q))
    ) {
      results.push({
        type: "session",
        title: s.projectName,
        subtitle: `PID ${s.pid} - ${s.status}${s.slug ? ` (${s.slug})` : ""}`,
        href: "/sessions",
      });
    }
  }

  // Search conversation content (limited scan)
  if (q.length >= 3) {
    const projectsDir = path.join(CLAUDE_DIR, "projects");
    if (fs.existsSync(projectsDir)) {
      const dirs = await fs.promises.readdir(projectsDir, { withFileTypes: true });
      outer: for (const dir of dirs) {
        if (!dir.isDirectory()) continue;
        const projPath = path.join(projectsDir, dir.name);
        const files = await fs.promises.readdir(projPath);
        const jsonlFiles = files.filter((f) => f.endsWith(".jsonl")).slice(0, 5);

        for (const jsonl of jsonlFiles) {
          try {
            const lines = await readLastLines(path.join(projPath, jsonl), 50);
            for (const line of lines) {
              if (!line.toLowerCase().includes(q)) continue;
              try {
                const entry = JSON.parse(line);
                let text = "";
                if (entry.type === "user" && typeof entry.message === "string") {
                  text = entry.message;
                } else if (entry.type === "assistant" && Array.isArray(entry.message?.content)) {
                  const textBlock = entry.message.content.find(
                    (c: Record<string, unknown>) => c.type === "text"
                  );
                  if (textBlock) text = textBlock.text as string;
                }
                if (text && text.toLowerCase().includes(q)) {
                  const idx = text.toLowerCase().indexOf(q);
                  const start = Math.max(0, idx - 40);
                  const end = Math.min(text.length, idx + q.length + 40);
                  const snippet = (start > 0 ? "..." : "") + text.slice(start, end) + (end < text.length ? "..." : "");
                  const realPath = pathCache.get(dir.name) || decodeProjectPath(dir.name);
                  results.push({
                    type: "conversation",
                    title: projectNameFromPath(realPath),
                    subtitle: `Session ${jsonl.replace(".jsonl", "").slice(0, 8)}...`,
                    href: `/projects/${encodeURIComponent(dir.name)}`,
                    snippet,
                  });
                  if (results.length >= 20) break outer;
                }
              } catch { /* skip */ }
            }
          } catch { /* skip */ }
        }
      }
    }
  }

  return results.slice(0, 20);
}

// --- Get session errors/tool failures ---
export async function getSessionErrors(sessionId: string): Promise<string[]> {
  const jsonlPath = findSessionJsonl(sessionId);
  if (!jsonlPath) return [];

  const errors: string[] = [];
  try {
    const lines = await readLastLines(jsonlPath, 200);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        // Check for tool result errors
        if ((entry.type === "tool_result" || entry.type === "result") && (entry.is_error || entry.error)) {
          const msg = typeof entry.content === "string"
            ? entry.content
            : (entry.error?.message || "Tool error");
          errors.push(`[${entry.timestamp || ""}] ${msg.slice(0, 300)}`);
        }
        // Check for assistant messages mentioning errors
        if (entry.type === "assistant" && Array.isArray(entry.message?.content)) {
          for (const c of entry.message.content) {
            if (c.type === "text" && typeof c.text === "string") {
              if (/\berror\b|failed|exception|traceback/i.test(c.text) && c.text.length < 500) {
                errors.push(`[${entry.timestamp || ""}] ${c.text.slice(0, 300)}`);
              }
            }
          }
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  return errors.slice(-20);
}

// --- Daily Token Usage Aggregation ---

export async function getDailyTokenUsage(days: number = 30): Promise<DailyTokenUsage[]> {
  const projectsDir = path.join(CLAUDE_DIR, "projects");
  if (!fs.existsSync(projectsDir)) return [];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  cutoff.setHours(0, 0, 0, 0);
  const cutoffMs = cutoff.getTime();

  // Per-day aggregation. `cost` accumulates the (model-aware) cost
  // contribution of each session-day, so a day spanning Opus and Sonnet
  // sessions is priced correctly without averaging.
  const dailyMap = new Map<
    string,
    { tokens: TokenUsage; sessions: Set<string>; cost: number }
  >();

  const allDirs = await fs.promises.readdir(projectsDir, { withFileTypes: true });
  const dirs = allDirs.filter((d) => d.isDirectory());

  // Collect every JSONL path first, then process them in parallel. The
  // previous implementation awaited each full-file scan sequentially, which
  // dominated the cold-path latency (~1.2s per poll on a 192-file tree).
  type JsonlRef = { sessionId: string; filePath: string };
  const refs: JsonlRef[] = [];
  for (const dir of dirs) {
    const projPath = path.join(projectsDir, dir.name);
    let files: string[];
    try {
      files = (await fs.promises.readdir(projPath)).filter((f) => f.endsWith(".jsonl"));
    } catch { continue; }
    for (const f of files) {
      refs.push({
        sessionId: f.replace(".jsonl", ""),
        filePath: path.join(projPath, f),
      });
    }
  }

  // Per-file cache: each file's tokens-by-date map is keyed by mtime+size.
  // Because JSONL files only ever grow (entries are appended), when neither
  // changed we can skip the full-file parse entirely and just re-merge the
  // cached buckets into the day map. Mtime alone can collide on writes that
  // land within the same millisecond, so we key on both.
  const perFileResults = await Promise.all(
    refs.map(async (ref) => {
      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(ref.filePath);
      } catch {
        return null;
      }
      if (stat.mtimeMs < cutoffMs) return null;

      const cached = dailyTokensCache.get(ref.filePath);
      const cachedSize = cached?.size ?? 0;
      const cachedMtimeMs = cached?.mtimeMs ?? 0;

      let inc;
      try {
        inc = await readIncrementalLines(ref.filePath, cachedSize, cachedMtimeMs);
      } catch {
        inc = null;
      }

      // Unchanged → return cached as-is.
      if (
        cached &&
        inc &&
        !inc.fullReparse &&
        inc.newLines.length === 0 &&
        inc.currentSize === cachedSize &&
        inc.currentMtimeMs === cachedMtimeMs
      ) {
        return cached;
      }

      // Helper: process a stream of lines into a byDate map + last model.
      // Used by both the incremental path (over `newLines`) and the full
      // re-scan path (over a readline stream).
      const addLineToByDate = (
        line: string,
        byDate: Map<string, TokenUsage>,
        prevModel: string | null
      ): string | null => {
        if (!line.trim()) return prevModel;
        try {
          const entry = JSON.parse(line);
          if (entry.type !== "assistant" || !entry.message?.usage || !entry.timestamp) return prevModel;
          const ts = new Date(entry.timestamp);
          if (ts.getTime() < cutoffMs) return prevModel;
          const dateKey = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, "0")}-${String(ts.getDate()).padStart(2, "0")}`;
          const u = entry.message.usage;
          byDate.set(
            dateKey,
            addTokens(byDate.get(dateKey) ?? emptyTokenUsage(), {
              input_tokens: u.input_tokens || 0,
              output_tokens: u.output_tokens || 0,
              cache_creation_input_tokens: u.cache_creation_input_tokens || 0,
              cache_read_input_tokens: u.cache_read_input_tokens || 0,
            })
          );
          const m = entry.message?.model;
          if (typeof m === "string" && m.trim()) return m;
        } catch { /* skip */ }
        return prevModel;
      };

      let byDate: Map<string, TokenUsage>;
      let fileModel: string | null;

      if (cached && inc && !inc.fullReparse) {
        // Incremental: clone the cached byDate so we don't mutate the shared
        // instance (it is returned and merged into dailyMap downstream), then
        // fold in tokens from new lines only.
        byDate = new Map(cached.byDate);
        fileModel = cached.model;
        for (const line of inc.newLines) {
          fileModel = addLineToByDate(line, byDate, fileModel);
        }
      } else {
        // Full re-scan: rotation, first read, or rewrite.
        byDate = new Map<string, TokenUsage>();
        fileModel = null;
        try {
          const stream = fs.createReadStream(ref.filePath, { encoding: "utf-8" });
          const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
          for await (const line of rl) {
            fileModel = addLineToByDate(line, byDate, fileModel);
          }
        } catch {
          // file read error
        }
      }

      const fresh: CachedDailyTokens = {
        mtimeMs: inc?.currentMtimeMs ?? stat.mtimeMs,
        size: inc?.currentSize ?? stat.size,
        byDate,
        sessionId: ref.sessionId,
        model: fileModel,
      };
      dailyTokensCache.set(ref.filePath, fresh);
      return fresh;
    })
  );

  for (const result of perFileResults) {
    if (!result) continue;
    for (const [dateKey, tokens] of result.byDate.entries()) {
      // Older days that the cached file still references but that now fall
      // outside the requested window should be ignored. Compare by string —
      // dateKey is YYYY-MM-DD local, so we can rebuild the cutoff in that
      // shape for cheap lexicographic comparison.
      const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
      if (dateKey < cutoffKey) continue;
      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, {
          tokens: emptyTokenUsage(),
          sessions: new Set(),
          cost: 0,
        });
      }
      const day = dailyMap.get(dateKey)!;
      day.tokens = addTokens(day.tokens, tokens);
      day.sessions.add(result.sessionId);
      // Price this file's contribution at its own model's rate so a day with
      // Opus + Sonnet sessions accumulates the correct blended cost.
      day.cost += calculateClaudeCost(tokens, result.model).totalCost;
    }
  }

  // Fill in missing days with zeros (using local dates to match dateKey format)
  const result: DailyTokenUsage[] = [];
  const now = new Date();
  for (let d = new Date(cutoff); d <= now; d.setDate(d.getDate() + 1)) {
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const day = dailyMap.get(dateKey);
    if (day) {
      result.push({
        date: dateKey,
        ...day.tokens,
        totalCost: day.cost,
        sessionCount: day.sessions.size,
        provider: "claude",
      });
    } else {
      result.push({
        date: dateKey,
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        totalCost: 0,
        sessionCount: 0,
        provider: "claude",
      });
    }
  }

  return result;
}

// --- Project Stats with Error Rates ---

export async function getProjectStats(): Promise<ProjectStats[]> {
  const projectsDir = path.join(CLAUDE_DIR, "projects");
  if (!fs.existsSync(projectsDir)) return [];

  const pathCache = await buildProjectPathCache();
  const allDirs = await fs.promises.readdir(projectsDir, { withFileTypes: true });
  const dirs = allDirs.filter((d) => d.isDirectory());
  const stats: ProjectStats[] = [];

  for (const dir of dirs) {
    const projPath = path.join(projectsDir, dir.name);
    let files: string[];
    try {
      files = (await fs.promises.readdir(projPath)).filter((f) => f.endsWith(".jsonl"));
    } catch { continue; }

    let totalTokens = emptyTokenUsage();
    let lastActivity = "";
    let errorCount = 0;
    let successCount = 0;
    let projectCost: CostEstimate = {
      inputCost: 0,
      outputCost: 0,
      cacheWriteCost: 0,
      cacheReadCost: 0,
      totalCost: 0,
    };

    for (const file of files) {
      const filePath = path.join(projPath, file);
      try {
        const stat = await fs.promises.stat(filePath);
        const iso = stat.mtime.toISOString();
        if (!lastActivity || iso > lastActivity) lastActivity = iso;

        // Read last 20 lines to check outcome and tally tokens
        const lines = await readLastLines(filePath, 50);
        let sessionHasError = false;
        let sessionTokens = emptyTokenUsage();
        let sessionModel: string | null = null;

        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (entry.type === "assistant" && entry.message?.usage) {
              const u = entry.message.usage;
              const usage: TokenUsage = {
                input_tokens: u.input_tokens || 0,
                output_tokens: u.output_tokens || 0,
                cache_creation_input_tokens: u.cache_creation_input_tokens || 0,
                cache_read_input_tokens: u.cache_read_input_tokens || 0,
              };
              totalTokens = addTokens(totalTokens, usage);
              sessionTokens = addTokens(sessionTokens, usage);
              const m = entry.message?.model;
              if (typeof m === "string" && m.trim()) sessionModel = m;
            }
            // Check for error indicators
            if (entry.type === "assistant" && entry.message?.content) {
              for (const block of entry.message.content) {
                if (block.type === "tool_result" && block.is_error) {
                  sessionHasError = true;
                }
              }
            }
            if (entry.type === "result" && entry.is_error) {
              sessionHasError = true;
            }
          } catch { /* skip */ }
        }

        const sessionCost = calculateClaudeCost(sessionTokens, sessionModel);
        projectCost = {
          inputCost: projectCost.inputCost + sessionCost.inputCost,
          outputCost: projectCost.outputCost + sessionCost.outputCost,
          cacheWriteCost: projectCost.cacheWriteCost + sessionCost.cacheWriteCost,
          cacheReadCost: projectCost.cacheReadCost + sessionCost.cacheReadCost,
          totalCost: projectCost.totalCost + sessionCost.totalCost,
        };

        if (sessionHasError) {
          errorCount++;
        } else {
          successCount++;
        }
      } catch { /* skip */ }
    }

    const realPath = pathCache.get(dir.name) || decodeProjectPath(dir.name);
    const total = errorCount + successCount;

    stats.push({
      id: dir.name,
      name: projectNameFromPath(realPath),
      totalTokens,
      cost: projectCost,
      sessionCount: files.length,
      lastActivity,
      errorCount,
      successCount,
      errorRate: total > 0 ? errorCount / total : 0,
      provider: "claude",
    });
  }

  return stats.sort(
    (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
  );
}

/**
 * Read installed plugins from ~/.claude/plugins/installed_plugins.json
 */
export async function getInstalledPlugins(): Promise<InstalledPlugin[]> {
  const pluginsFile = path.join(CLAUDE_DIR, "plugins", "installed_plugins.json");
  if (!fs.existsSync(pluginsFile)) return [];

  try {
    const raw = await fs.promises.readFile(pluginsFile, "utf-8");
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || !data.plugins) return [];

    const plugins: InstalledPlugin[] = [];
    for (const [key, entries] of Object.entries(data.plugins)) {
      if (!Array.isArray(entries) || entries.length === 0) continue;
      const entry = entries[0] as Record<string, unknown>;
      const [pluginName, marketplace] = key.split("@");
      plugins.push({
        name: pluginName || key,
        marketplace: marketplace || "unknown",
        scope: entry.scope === "project" ? "project" : "user",
        version: typeof entry.version === "string" ? entry.version : "unknown",
        installedAt: typeof entry.installedAt === "string" ? entry.installedAt : "",
        lastUpdated: typeof entry.lastUpdated === "string" ? entry.lastUpdated : "",
      });
    }

    return plugins.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/**
 * Get Claude-specific system status: CLI version and Anthropic API reachability.
 */
export async function getClaudeProviderStatus(): Promise<ProviderStatus> {
  let cliVersion = "unknown";
  try {
    cliVersion = execFileSync("claude", ["--version"], {
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
    // Network error or timeout
  }

  return { cliVersion, apiStatus };
}

/**
 * Get system status: CLI version, active session count, API reachability.
 */
export async function getSystemStatus(): Promise<SystemStatus> {
  const [claude, sessions] = await Promise.all([
    getClaudeProviderStatus(),
    getActiveSessions(),
  ]);
  return {
    claude,
    activeSessions: sessions.filter((s) => s.isAlive).length,
  };
}
