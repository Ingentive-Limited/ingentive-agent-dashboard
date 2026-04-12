import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline";
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
} from "./types";

// Anthropic pricing per million tokens (Sonnet 4 as default)
const PRICING = {
  input: 3.0 / 1_000_000,
  output: 15.0 / 1_000_000,
  cacheWrite: 3.75 / 1_000_000,
  cacheRead: 0.30 / 1_000_000,
};

function calculateCost(tokens: TokenUsage): CostEstimate {
  const inputCost = tokens.input_tokens * PRICING.input;
  const outputCost = tokens.output_tokens * PRICING.output;
  const cacheWriteCost = tokens.cache_creation_input_tokens * PRICING.cacheWrite;
  const cacheReadCost = tokens.cache_read_input_tokens * PRICING.cacheRead;
  return {
    inputCost,
    outputCost,
    cacheWriteCost,
    cacheReadCost,
    totalCost: inputCost + outputCost + cacheWriteCost + cacheReadCost,
  };
}

const IS_WIN = process.platform === "win32";
const CLAUDE_DIR = path.join(os.homedir(), ".claude");

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

function emptyTokenUsage(): TokenUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
}

function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_creation_input_tokens:
      a.cache_creation_input_tokens + b.cache_creation_input_tokens,
    cache_read_input_tokens:
      a.cache_read_input_tokens + b.cache_read_input_tokens,
  };
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Build a mapping of encoded project dir names to real paths from session cwds
let projectPathCache: Map<string, string> | null = null;
let projectPathCacheTime: number | null = null;

async function buildProjectPathCache(): Promise<Map<string, string>> {
  // Cache for 30s to avoid re-reading on every request
  if (projectPathCache && projectPathCacheTime && Date.now() - projectPathCacheTime < 30000) {
    return projectPathCache;
  }
  projectPathCache = new Map();
  projectPathCacheTime = Date.now();

  // Read all session files to get real cwds
  const sessionsDir = path.join(CLAUDE_DIR, "sessions");
  if (fs.existsSync(sessionsDir)) {
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const content = await fs.promises.readFile(
          path.join(sessionsDir, file),
          "utf-8"
        );
        const data = JSON.parse(content);
        if (data.cwd) {
          // Encode path: replace both / and \ with -
          const encoded = data.cwd.replace(/[\\/]/g, "-");
          projectPathCache.set(encoded, data.cwd);
        }
      } catch {
        // skip
      }
    }
  }

  // Also scan JSONL files for session cwds
  const projectsDir = path.join(CLAUDE_DIR, "projects");
  if (fs.existsSync(projectsDir)) {
    const dirs = fs.readdirSync(projectsDir);
    for (const dir of dirs) {
      if (projectPathCache.has(dir)) continue;
      const projectPath = path.join(projectsDir, dir);
      const jsonlFiles = fs.readdirSync(projectPath).filter((f) => f.endsWith(".jsonl"));
      if (jsonlFiles.length > 0) {
        try {
          const firstLine = (await fs.promises.readFile(
            path.join(projectPath, jsonlFiles[0]),
            "utf-8"
          )).split("\n").find((l) => l.includes('"cwd"'));
          if (firstLine) {
            const entry = JSON.parse(firstLine);
            if (entry.cwd) {
              projectPathCache.set(dir, entry.cwd);
            }
          }
        } catch {
          // skip
        }
      }
    }
  }

  return projectPathCache;
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

function projectNameFromPath(p: string): string {
  // Split on both / and \ for cross-platform support
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

// Read the last N lines of a file by reading chunks from the end.
// Avoids loading the entire file into memory for large JSONL files.
const READ_CHUNK_SIZE = 8192;

async function readLastLines(
  filePath: string,
  n: number
): Promise<string[]> {
  const stat = await fs.promises.stat(filePath);
  const fileSize = stat.size;

  if (fileSize === 0) return [];

  // For small files (< 64KB), just read the whole thing
  if (fileSize < 65536) {
    const content = await fs.promises.readFile(filePath, "utf-8");
    const lines = content.trim().split("\n");
    return lines.slice(-n);
  }

  // For large files, read chunks from the end
  const fd = await fs.promises.open(filePath, "r");
  try {
    const lines: string[] = [];
    let remaining = "";
    let position = fileSize;

    while (lines.length < n && position > 0) {
      const chunkSize = Math.min(READ_CHUNK_SIZE, position);
      position -= chunkSize;
      const buf = Buffer.alloc(chunkSize);
      await fd.read(buf, 0, chunkSize, position);
      const chunk = buf.toString("utf-8") + remaining;
      const parts = chunk.split("\n");
      // The first element is a partial line (unless we're at the start)
      remaining = parts[0];
      // Add complete lines from this chunk (in reverse, we'll reverse later)
      for (let i = parts.length - 1; i >= 1; i--) {
        const line = parts[i].trim();
        if (line) lines.push(line);
        if (lines.length >= n) break;
      }
    }

    // If we reached the start of the file, include the remaining partial line
    if (position === 0 && remaining.trim() && lines.length < n) {
      lines.push(remaining.trim());
    }

    return lines.reverse();
  } finally {
    await fd.close();
  }
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
function isWithinDir(filePath: string, baseDir: string): boolean {
  const resolved = path.resolve(filePath);
  const resolvedBase = path.resolve(baseDir) + path.sep;
  return resolved.startsWith(resolvedBase) || resolved === path.resolve(baseDir);
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

    // Light token scan: read last 50 lines of most recent jsonl
    if (fileStats.length > 0) {
      const sortedFiles = fileStats
        .map((f) => ({ name: f.name, mtime: f.mtime.getTime() }))
        .sort((a, b) => b.mtime - a.mtime);

      try {
        const lastLines = await readLastLines(
          path.join(projectPath, sortedFiles[0].name),
          100
        );
        for (const line of lastLines) {
          try {
            const entry = JSON.parse(line);
            if (entry.type === "assistant" && entry.message?.usage) {
              const u = entry.message.usage;
              totalTokens = addTokens(totalTokens, {
                input_tokens: u.input_tokens || 0,
                output_tokens: u.output_tokens || 0,
                cache_creation_input_tokens:
                  u.cache_creation_input_tokens || 0,
                cache_read_input_tokens: u.cache_read_input_tokens || 0,
              });
            }
          } catch {
            // skip invalid lines
          }
        }
      } catch {
        // file read error
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
      cost: calculateCost(totalTokens),
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

  for (const jsonl of jsonlFiles) {
    const sessionId = jsonl.replace(".jsonl", "");
    const filePath = path.join(projectPath, jsonl);
    let messageCount = 0;
    let sessionTokens = emptyTokenUsage();
    let firstMessage = "";
    let lastMessage = "";

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

          tokenTimeSeries.push({
            timestamp: entry.timestamp,
            ...usage,
            cumulative_input: cumulativeInput,
            cumulative_output: cumulativeOutput,
          });
        }
      } catch {
        // skip invalid lines
      }
    }

    totalTokens = addTokens(totalTokens, sessionTokens);
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
    cost: calculateCost(totalTokens),
    sessions: projectSessions,
    subagents,
    memoryFiles,
    tokenTimeSeries: tokenTimeSeries.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    ),
  };
}

function cronToHuman(cron: string): string {
  const parts = cron.split(" ");
  if (parts.length !== 5) return cron;
  const [min, hour, , , dow] = parts;
  const time = `~${hour}:${min.padStart(2, "0")}`;
  const days: Record<string, string> = {
    "0": "Sunday", "1": "Monday", "2": "Tuesday", "3": "Wednesday",
    "4": "Thursday", "5": "Friday", "6": "Saturday", "7": "Sunday",
  };
  if (dow === "*") return `Every day at ${time}`;
  if (dow === "1-5") return `Weekdays at ${time}`;
  if (days[dow]) return `Every ${days[dow]} at ${time}`;
  return `Cron: ${cron}`;
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
  const sessions = await getActiveSessions();
  const aliveSessions = sessions.filter((s) => s.isAlive);
  const awaitingInput = aliveSessions.filter(
    (s) => s.status === "awaiting_input" || s.status === "needs_attention"
  );
  const projects = await getProjects();
  const tasks = await getScheduledTasks();

  // Aggregate tokens from all projects
  let todayTokens = emptyTokenUsage();

  for (const proj of projects) {
    todayTokens = addTokens(todayTokens, proj.totalTokens);
  }

  // Build a simple time series from recent project data
  const tokenTimeSeries: TokenDataPoint[] = [];
  const projectsDir = path.join(CLAUDE_DIR, "projects");
  if (fs.existsSync(projectsDir)) {
    const dirs = await fs.promises.readdir(projectsDir, { withFileTypes: true });
    // Read last 50 lines from the 3 most recent projects for dashboard chart
    const recentProjects = projects.slice(0, 3);
    for (const proj of recentProjects) {
      const projPath = path.join(projectsDir, proj.id);
      try {
        const files = await fs.promises.readdir(projPath);
        const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
        if (jsonlFiles.length === 0) continue;
        // Get most recent file
        let latestFile = jsonlFiles[0];
        let latestMtime = 0;
        for (const f of jsonlFiles) {
          const stat = await fs.promises.stat(path.join(projPath, f));
          if (stat.mtimeMs > latestMtime) {
            latestMtime = stat.mtimeMs;
            latestFile = f;
          }
        }
        const lines = await readLastLines(path.join(projPath, latestFile), 100);
        let cumIn = 0, cumOut = 0;
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (entry.type === "assistant" && entry.message?.usage && entry.timestamp) {
              const u = entry.message.usage;
              const usage: TokenUsage = {
                input_tokens: u.input_tokens || 0,
                output_tokens: u.output_tokens || 0,
                cache_creation_input_tokens: u.cache_creation_input_tokens || 0,
                cache_read_input_tokens: u.cache_read_input_tokens || 0,
              };
              cumIn += usage.input_tokens;
              cumOut += usage.output_tokens;
              tokenTimeSeries.push({
                timestamp: entry.timestamp,
                ...usage,
                cumulative_input: cumIn,
                cumulative_output: cumOut,
              });
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
    // suppress unused var
    void dirs;
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
    totalCost: calculateCost(todayTokens),
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

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const projPath = path.join(projectsDir, dir.name);
    const files = await fs.promises.readdir(projPath);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
    const realPath = pathCache.get(dir.name) || decodeProjectPath(dir.name);

    for (const jsonl of jsonlFiles) {
      const sessionId = jsonl.replace(".jsonl", "");
      const filePath = path.join(projPath, jsonl);
      const stat = await fs.promises.stat(filePath);
      let totalTokens = emptyTokenUsage();
      let messageCount = 0;
      let firstTimestamp = "";
      let lastTimestamp = "";

      // Read first and last lines for timestamps, scan for tokens
      try {
        const lines = await readLastLines(filePath, 50);
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
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }

      // Find matching active session for metadata
      const active = activeSessions.find((s) => s.sessionId === sessionId);

      history.push({
        sessionId,
        projectName: active?.projectName || projectNameFromPath(realPath),
        cwd: active?.cwd || realPath,
        startedAt: active?.startedAt || stat.birthtimeMs,
        endedAt: aliveIds.has(sessionId) ? undefined : lastTimestamp || stat.mtime.toISOString(),
        entrypoint: active?.entrypoint || "cli",
        totalTokens,
        cost: calculateCost(totalTokens),
        messageCount,
        status: active?.status || (aliveIds.has(sessionId) ? "running" : "dead"),
      });
    }
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
                  const pathCache = await buildProjectPathCache();
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

  const dailyMap = new Map<string, { tokens: TokenUsage; sessions: Set<string> }>();

  const allDirs = await fs.promises.readdir(projectsDir, { withFileTypes: true });
  const dirs = allDirs.filter((d) => d.isDirectory());

  for (const dir of dirs) {
    const projPath = path.join(projectsDir, dir.name);
    let files: string[];
    try {
      files = (await fs.promises.readdir(projPath)).filter((f) => f.endsWith(".jsonl"));
    } catch { continue; }

    // Only read files modified within the window
    for (const file of files) {
      const filePath = path.join(projPath, file);
      try {
        const stat = await fs.promises.stat(filePath);
        if (stat.mtimeMs < cutoffMs) continue;

        const sessionId = file.replace(".jsonl", "");
        const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

        for await (const line of rl) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if (entry.type !== "assistant" || !entry.message?.usage || !entry.timestamp) continue;

            const ts = new Date(entry.timestamp);
            if (ts.getTime() < cutoffMs) continue;

            const dateKey = ts.toISOString().slice(0, 10);
            const u = entry.message.usage;

            if (!dailyMap.has(dateKey)) {
              dailyMap.set(dateKey, { tokens: emptyTokenUsage(), sessions: new Set() });
            }
            const day = dailyMap.get(dateKey)!;
            day.tokens = addTokens(day.tokens, {
              input_tokens: u.input_tokens || 0,
              output_tokens: u.output_tokens || 0,
              cache_creation_input_tokens: u.cache_creation_input_tokens || 0,
              cache_read_input_tokens: u.cache_read_input_tokens || 0,
            });
            day.sessions.add(sessionId);
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
  }

  // Fill in missing days with zeros
  const result: DailyTokenUsage[] = [];
  const now = new Date();
  for (let d = new Date(cutoff); d <= now; d.setDate(d.getDate() + 1)) {
    const dateKey = d.toISOString().slice(0, 10);
    const day = dailyMap.get(dateKey);
    if (day) {
      const cost = calculateCost(day.tokens);
      result.push({
        date: dateKey,
        ...day.tokens,
        totalCost: cost.totalCost,
        sessionCount: day.sessions.size,
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

    for (const file of files) {
      const filePath = path.join(projPath, file);
      try {
        const stat = await fs.promises.stat(filePath);
        const iso = stat.mtime.toISOString();
        if (!lastActivity || iso > lastActivity) lastActivity = iso;

        // Read last 20 lines to check outcome and tally tokens
        const lines = await readLastLines(filePath, 50);
        let sessionHasError = false;

        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (entry.type === "assistant" && entry.message?.usage) {
              const u = entry.message.usage;
              totalTokens = addTokens(totalTokens, {
                input_tokens: u.input_tokens || 0,
                output_tokens: u.output_tokens || 0,
                cache_creation_input_tokens: u.cache_creation_input_tokens || 0,
                cache_read_input_tokens: u.cache_read_input_tokens || 0,
              });
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
      cost: calculateCost(totalTokens),
      sessionCount: files.length,
      lastActivity,
      errorCount,
      successCount,
      errorRate: total > 0 ? errorCount / total : 0,
    });
  }

  return stats.sort(
    (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
  );
}
