import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline";
import type {
  ClaudeSession,
  SessionStatus,
  TokenUsage,
  TokenDataPoint,
  ProjectSummary,
  ProjectDetail,
  ProjectSession,
  SubagentMeta,
  ScheduledTask,
  DashboardOverview,
} from "./types";

const CLAUDE_DIR = path.join(os.homedir(), ".claude");

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
          const encoded = data.cwd.replace(/\//g, "-");
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
  // Fallback: replace leading - with / and remaining - with /
  return dirName.replace(/^-/, "/").replace(/-/g, "/");
}

function projectNameFromPath(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] || p;
}

// Read the last N lines of a file efficiently
async function readLastLines(
  filePath: string,
  n: number
): Promise<string[]> {
  const content = await fs.promises.readFile(filePath, "utf-8");
  const lines = content.trim().split("\n");
  return lines.slice(-n);
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

// Get the session's JSONL file path by matching sessionId to project files
function findSessionJsonl(sessionId: string): string | null {
  const projectsDir = path.join(CLAUDE_DIR, "projects");
  if (!fs.existsSync(projectsDir)) return null;

  const projects = fs.readdirSync(projectsDir);
  for (const proj of projects) {
    const jsonlPath = path.join(projectsDir, proj, `${sessionId}.jsonl`);
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

  const dirs = fs.readdirSync(projectsDir).filter((d) => {
    return fs.statSync(path.join(projectsDir, d)).isDirectory();
  });

  const projects: ProjectSummary[] = [];

  // Build a cwd-to-project mapping from sessions and JSONL files
  const pathCache = await buildProjectPathCache();

  for (const dir of dirs) {
    const projectPath = path.join(projectsDir, dir);
    const jsonlFiles = fs.readdirSync(projectPath).filter((f) =>
      f.endsWith(".jsonl")
    );

    let lastActivity = "";
    let totalTokens = emptyTokenUsage();

    // Quick scan: get last activity from file mtime
    for (const jsonl of jsonlFiles) {
      const stat = fs.statSync(path.join(projectPath, jsonl));
      const mtime = stat.mtime.toISOString();
      if (!lastActivity || mtime > lastActivity) {
        lastActivity = mtime;
      }
    }

    // Light token scan: read last 50 lines of most recent jsonl
    if (jsonlFiles.length > 0) {
      const sortedFiles = jsonlFiles
        .map((f) => ({
          name: f,
          mtime: fs.statSync(path.join(projectPath, f)).mtimeMs,
        }))
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
  const projectPath = path.join(CLAUDE_DIR, "projects", projectId);
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
    os.homedir(),
    "Library",
    "Application Support",
    "Claude",
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
              if (t.filePath && fs.existsSync(t.filePath)) {
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

  // Aggregate today's tokens from all projects
  let todayTokens = emptyTokenUsage();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  for (const proj of projects) {
    // Use the lightweight token data already aggregated
    todayTokens = addTokens(todayTokens, proj.totalTokens);
  }

  return {
    activeSessions: aliveSessions.length,
    awaitingInput: awaitingInput.length,
    totalTokensToday: todayTokens,
    activeProjects: projects.filter((p) => {
      return (
        p.lastActivity &&
        new Date(p.lastActivity).getTime() > Date.now() - 24 * 60 * 60 * 1000
      );
    }).length,
    scheduledTasks: tasks.length,
    recentSessions: aliveSessions.slice(0, 5),
  };
}
