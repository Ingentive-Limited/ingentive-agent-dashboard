/**
 * Scout data reader.
 *
 * Microsoft Scout is an Electron wrapper around the `@github/copilot` CLI. It
 * records each session under:
 *
 *   ~/.copilot/session-state/<sessionId>/
 *     events.jsonl     — append-only event log (the only thing we read)
 *     session.db       — SQLite (ignored in v1)
 *     checkpoints/     — auxiliary
 *     files/           — auxiliary
 *     research/        — auxiliary
 *     inuse.<pid>.lock — present while the session is actively running
 *
 * Unlike Claude Code, Scout sessions are driven by the Electron app rather
 * than an OS process we can probe; liveness comes from the lock file plus the
 * most-recent event timestamp.
 *
 * Scout uses camelCase field names (`inputTokens`, `cacheReadTokens`, …) and
 * DOTTED model ids (`claude-opus-4.7`). We normalise both at parse time so
 * downstream code can treat Scout's data identically to Claude Code's.
 *
 * Per-turn model attribution: Scout supports mid-session model switches, so
 * we sum tokens by `data.model` rather than treating the whole session as one
 * model. Cost is computed per (model, tokens) pair using `pricingForModel`.
 * Newer Scout builds emit usage on each `assistant.message`; older builds (as
 * seen on this machine, copilot-agent 1.0.50) emit the aggregate only on the
 * terminal `session.shutdown.data.modelMetrics.<model>.usage`. We handle both
 * shapes so we don't lose data on either version.
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
  readIncrementalLines,
  projectNameFromPath,
  isWithinDir,
  formatLocalDate,
} from "./utils-server";
import { costForCopilotRequests } from "./pricing";

const SCOUT_ROOT = path.join(os.homedir(), ".copilot", "session-state");

/**
 * Combine premium-request counts split by model into a single cost.
 *
 * Scout is a Microsoft-shipped Electron wrapper around the @github/copilot
 * CLI. Users are billed by Copilot using its premium-request model
 * (allowance + over-allowance retail at $0.04/unit × model multiplier),
 * NOT by per-token Anthropic / OpenAI rates. Showing the latter would
 * massively over-state cost — a heavy Opus session with billions of
 * cache_read tokens would look like $10k at API rates but is actually
 * ~20 premium requests × 10× × $0.04 ≈ $8 at Copilot retail.
 *
 * We track request counts per model so a session that switched models
 * mid-flight prices each segment at the correct multiplier. The
 * token-level breakdown of inputCost / outputCost / cacheWriteCost /
 * cacheReadCost doesn't fit Copilot's billing model — those fields are
 * zeroed for Scout sessions, with the whole figure going into totalCost.
 */
function calculateScoutCost(
  requestsByModel: Map<string, number>
): CostEstimate {
  let total = 0;
  for (const [model, count] of requestsByModel.entries()) {
    total += costForCopilotRequests(model, count);
  }
  return {
    inputCost: 0,
    outputCost: 0,
    cacheWriteCost: 0,
    cacheReadCost: 0,
    totalCost: total,
  };
}

/**
 * Normalise a Scout usage object (camelCase keys) into the dashboard's
 * canonical TokenUsage shape (snake_case keys). Exported for unit tests.
 */
export function normaliseScoutUsage(
  usage: Record<string, unknown> | null | undefined
): TokenUsage {
  if (!usage || typeof usage !== "object") return emptyTokenUsage();
  const num = (v: unknown): number => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const reasoning = num(usage.reasoningTokens);
  return {
    input_tokens: num(usage.inputTokens),
    output_tokens: num(usage.outputTokens),
    cache_creation_input_tokens: num(usage.cacheWriteTokens),
    cache_read_input_tokens: num(usage.cacheReadTokens),
    reasoning_tokens: reasoning > 0 ? reasoning : undefined,
  };
}

function scoutRootExists(): boolean {
  return fs.existsSync(SCOUT_ROOT);
}

// ── Manifest discovery + caching ─────────────────────────────────────────────

interface ScoutSessionMeta {
  sessionId: string;
  /** Absolute path to the events.jsonl. */
  eventsPath: string;
  /** Directory containing the session. */
  sessionDir: string;
  /** Path to a `inuse.<pid>.lock` file if one exists, else null. */
  lockPath: string | null;
  /** Parsed session.start event if present (null if file missing/malformed). */
  start: ScoutSessionStart | null;
  /** mtime of events.jsonl in ms epoch (0 if missing). */
  mtimeMs: number;
}

interface ScoutSessionStart {
  sessionId: string;
  copilotVersion?: string;
  startTime?: string;
  selectedModel?: string;
  cwd?: string;
  timestamp?: string;
}

let manifestsCache: ScoutSessionMeta[] | null = null;
let manifestsCacheAt = 0;
const MANIFESTS_TTL_MS = 5_000;

async function readFirstLine(filePath: string): Promise<string | null> {
  // The session.start event is always the first line; reading a small head
  // chunk and splitting on \n avoids loading entire 200k+ line transcripts
  // just to grab the metadata.
  try {
    const fd = await fs.promises.open(filePath, "r");
    try {
      const buf = Buffer.alloc(8192);
      const { bytesRead } = await fd.read(buf, 0, 8192, 0);
      if (bytesRead === 0) return null;
      const chunk = buf.subarray(0, bytesRead).toString("utf-8");
      const newline = chunk.indexOf("\n");
      return newline === -1 ? chunk : chunk.slice(0, newline);
    } finally {
      await fd.close();
    }
  } catch {
    return null;
  }
}

function parseSessionStart(line: string): ScoutSessionStart | null {
  try {
    const entry = JSON.parse(line) as Record<string, unknown>;
    if (entry.type !== "session.start") return null;
    const data = (entry.data ?? {}) as Record<string, unknown>;
    const ctx = (data.context ?? {}) as Record<string, unknown>;
    return {
      sessionId: String(data.sessionId ?? ""),
      copilotVersion:
        typeof data.copilotVersion === "string" ? data.copilotVersion : undefined,
      startTime:
        typeof data.startTime === "string" ? data.startTime : undefined,
      selectedModel:
        typeof data.selectedModel === "string" ? data.selectedModel : undefined,
      cwd: typeof ctx.cwd === "string" ? ctx.cwd : undefined,
      timestamp:
        typeof entry.timestamp === "string" ? entry.timestamp : undefined,
    };
  } catch {
    return null;
  }
}

async function discoverSessions(): Promise<ScoutSessionMeta[]> {
  const now = Date.now();
  if (manifestsCache && now - manifestsCacheAt < MANIFESTS_TTL_MS) {
    return manifestsCache;
  }

  if (!scoutRootExists()) {
    manifestsCache = [];
    manifestsCacheAt = now;
    return manifestsCache;
  }

  let sessionDirs: string[];
  try {
    sessionDirs = await fs.promises.readdir(SCOUT_ROOT);
  } catch {
    return [];
  }

  const results: ScoutSessionMeta[] = [];

  for (const sessionId of sessionDirs) {
    if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) continue;
    const sessionDir = path.join(SCOUT_ROOT, sessionId);
    if (!isWithinDir(sessionDir, SCOUT_ROOT)) continue;

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(sessionDir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const eventsPath = path.join(sessionDir, "events.jsonl");
    let eventsStat: fs.Stats | null = null;
    try {
      eventsStat = await fs.promises.stat(eventsPath);
    } catch {
      // Session directory may exist briefly without events.jsonl while
      // the agent is initialising — skip rather than fail.
      continue;
    }
    if (!eventsStat.isFile()) continue;

    // Find an `inuse.<pid>.lock` if present (used for liveness detection).
    let lockPath: string | null = null;
    try {
      const entries = await fs.promises.readdir(sessionDir);
      const lock = entries.find(
        (e) => e.startsWith("inuse.") && e.endsWith(".lock")
      );
      if (lock) lockPath = path.join(sessionDir, lock);
    } catch {
      // ignore
    }

    const firstLine = await readFirstLine(eventsPath);
    const start = firstLine ? parseSessionStart(firstLine) : null;

    results.push({
      sessionId,
      eventsPath,
      sessionDir,
      lockPath,
      start,
      mtimeMs: eventsStat.mtimeMs,
    });
  }

  manifestsCache = results;
  manifestsCacheAt = now;
  return results;
}

// ── Status detection ─────────────────────────────────────────────────────────

interface StatusResult {
  status: SessionStatus;
  lastMessage?: string;
}

/**
 * Determine session status from the tail of an events.jsonl file. Exported
 * for unit testing.
 *
 * - `session.shutdown`                 → dead
 * - `permission.requested` (unmatched) → needs_attention
 * - last activity within last 30 s     → running
 * - `assistant.turn_end` / `assistant.message` → awaiting_input
 * - `user.message` (last meaningful)   → processing
 * - otherwise                          → idle
 *
 * The `hasLock` argument lets callers force "running" when a sibling
 * `inuse.<pid>.lock` exists, since the Electron app holds it for the duration
 * of an active session.
 */
export function getStatusFromEvents(
  eventsPath: string | null,
  hasLock = false
): StatusResult {
  if (!eventsPath || !fs.existsSync(eventsPath)) {
    return hasLock ? { status: "running" } : { status: "idle" };
  }

  try {
    const stat = fs.statSync(eventsPath);
    const readSize = Math.min(stat.size, 16384);
    if (readSize === 0) {
      return hasLock ? { status: "running" } : { status: "idle" };
    }
    const buf = Buffer.alloc(readSize);
    const fd = fs.openSync(eventsPath, "r");
    fs.readSync(fd, buf, 0, readSize, Math.max(0, stat.size - readSize));
    fs.closeSync(fd);

    const tail = buf.toString("utf-8");
    const lines = tail.split("\n").filter((l) => l.trim());
    if (lines.length === 0) {
      return hasLock ? { status: "running" } : { status: "idle" };
    }

    // Walk lines bottom-up and find the most recent "meaningful" event.
    // We skip hook/tool noise so a long tool burst doesn't mask the fact
    // that the agent already completed its turn.
    let lastTimestampMs = 0;
    let pendingPermission = false;
    let sawShutdown = false;
    let assistantTurnDone = false;
    let lastAssistantText: string | undefined;
    let processing = false;

    for (let i = 0; i < lines.length; i++) {
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(lines[i]) as Record<string, unknown>;
      } catch {
        continue;
      }
      const ts = typeof entry.timestamp === "string" ? entry.timestamp : null;
      if (ts) {
        const t = Date.parse(ts);
        if (Number.isFinite(t) && t > lastTimestampMs) lastTimestampMs = t;
      }
      const type = entry.type as string | undefined;

      if (type === "session.shutdown") {
        sawShutdown = true;
      } else if (type === "permission.requested") {
        pendingPermission = true;
      } else if (type === "permission.completed") {
        // Pair-matches an earlier request. Best-effort: just clear the flag.
        pendingPermission = false;
      } else if (type === "assistant.turn_end") {
        assistantTurnDone = true;
        processing = false;
      } else if (type === "assistant.message") {
        assistantTurnDone = true;
        const data = (entry.data ?? {}) as Record<string, unknown>;
        const content = data.content;
        if (typeof content === "string" && content.trim()) {
          lastAssistantText = content.slice(0, 200);
        }
      } else if (type === "user.message") {
        processing = true;
        assistantTurnDone = false;
      } else if (type === "assistant.turn_start") {
        processing = true;
        assistantTurnDone = false;
      }
    }

    if (sawShutdown) return { status: "dead" };
    if (pendingPermission) return { status: "needs_attention" };

    const ageMs = lastTimestampMs > 0 ? Date.now() - lastTimestampMs : Infinity;
    if (hasLock && ageMs < 30_000) return { status: "running", lastMessage: lastAssistantText };
    if (hasLock && processing) return { status: "running", lastMessage: lastAssistantText };
    if (assistantTurnDone) {
      return { status: "awaiting_input", lastMessage: lastAssistantText };
    }
    if (processing) return { status: "processing" };
    if (hasLock) return { status: "running" };
    return { status: "idle" };
  } catch {
    return hasLock ? { status: "running" } : { status: "idle" };
  }
}

// ── Token aggregation with per-model attribution ─────────────────────────────

interface CachedTokens {
  mtimeMs: number;
  size: number;
  tokensByModel: Map<string, TokenUsage>;
  /**
   * Premium-request count per model. Each `assistant.message` event is one
   * premium request (i.e. one round-trip with the model). When
   * `session.shutdown.modelMetrics.<model>.requests.count` is present it
   * supersedes the per-message count (it's the canonical figure Microsoft
   * itself records and bills against).
   */
  requestsByModel: Map<string, number>;
  /** Last `selectedModel` seen — used as fallback when an event doesn't tag a model. */
  lastModel?: string;
  /** Whether session.shutdown was observed; if so, modelMetrics is authoritative. */
  shutdownSeen: boolean;
}
const tokensCache = new Map<string, CachedTokens>();

function addToBucket(
  bucket: Map<string, TokenUsage>,
  model: string,
  tokens: TokenUsage
): void {
  const existing = bucket.get(model);
  bucket.set(model, existing ? addTokens(existing, tokens) : tokens);
}

function incrementRequest(bucket: Map<string, number>, model: string): void {
  bucket.set(model, (bucket.get(model) ?? 0) + 1);
}

/**
 * Scan an events.jsonl and return tokens grouped by `model`. Both shapes are
 * handled — per-message `data.usage` on `assistant.message`, and the
 * `session.shutdown.data.modelMetrics.<model>.usage` aggregate. If both are
 * present we PREFER the shutdown aggregate (it's the canonical total) and
 * discard the per-message accumulation to avoid double counting.
 *
 * Exported for unit testing.
 */
export function tokensFromEvents(
  lines: string[],
  initial: {
    tokensByModel: Map<string, TokenUsage>;
    requestsByModel: Map<string, number>;
    lastModel?: string;
    shutdownSeen: boolean;
  }
): {
  tokensByModel: Map<string, TokenUsage>;
  requestsByModel: Map<string, number>;
  lastModel?: string;
  shutdownSeen: boolean;
} {
  // Carry forward the running per-message accumulator across incremental
  // chunks. Tokens are summed; request count is incremented per assistant
  // message. When a shutdown lands, modelMetrics replaces both totals.
  const perMessageTokens = new Map<string, TokenUsage>();
  const perMessageRequests = new Map<string, number>();
  for (const [m, t] of initial.tokensByModel.entries()) perMessageTokens.set(m, t);
  for (const [m, c] of initial.requestsByModel.entries()) perMessageRequests.set(m, c);
  let lastModel = initial.lastModel;
  let shutdownSeen = initial.shutdownSeen;
  const shutdownTokens = new Map<string, TokenUsage>();
  const shutdownRequests = new Map<string, number>();

  for (const line of lines) {
    if (
      line.indexOf("session.start") === -1 &&
      line.indexOf("session.shutdown") === -1 &&
      line.indexOf("assistant.message") === -1
    ) {
      continue;
    }
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const type = entry.type as string | undefined;
    const data = (entry.data ?? {}) as Record<string, unknown>;

    if (type === "session.start") {
      const sel = data.selectedModel;
      if (typeof sel === "string") lastModel = sel;
      continue;
    }

    if (type === "assistant.message") {
      const model =
        typeof data.model === "string" ? data.model : lastModel ?? "unknown";
      if (typeof data.model === "string") lastModel = data.model;
      // Every assistant turn is one Copilot premium request, regardless of
      // whether the message carries a per-turn usage payload.
      incrementRequest(perMessageRequests, model);
      const usage =
        (data.usage as Record<string, unknown> | undefined) ?? undefined;
      if (usage) {
        addToBucket(perMessageTokens, model, normaliseScoutUsage(usage));
      }
      continue;
    }

    if (type === "session.shutdown") {
      shutdownSeen = true;
      const metrics = data.modelMetrics as
        | Record<string, Record<string, unknown>>
        | undefined;
      if (metrics) {
        for (const [model, mv] of Object.entries(metrics)) {
          const usage = (mv?.usage ?? {}) as Record<string, unknown>;
          if (Object.keys(usage).length > 0) {
            addToBucket(shutdownTokens, model, normaliseScoutUsage(usage));
          }
          // requests.count is the canonical figure — Microsoft writes it
          // even when usage is empty, so always check it.
          const requests = mv?.requests as
            | Record<string, unknown>
            | undefined;
          const count =
            requests && typeof requests.count === "number"
              ? requests.count
              : 0;
          if (count > 0) {
            shutdownRequests.set(
              model,
              (shutdownRequests.get(model) ?? 0) + count
            );
          }
        }
      }
      continue;
    }
  }

  // When a shutdown was seen with at least one usage or request entry, treat
  // its totals as authoritative (they're what Microsoft's own bookkeeping
  // recorded) and drop the per-message accumulation to avoid double-counting.
  if (shutdownSeen && (shutdownTokens.size > 0 || shutdownRequests.size > 0)) {
    return {
      tokensByModel: shutdownTokens,
      requestsByModel: shutdownRequests,
      lastModel,
      shutdownSeen,
    };
  }
  return {
    tokensByModel: perMessageTokens,
    requestsByModel: perMessageRequests,
    lastModel,
    shutdownSeen,
  };
}

async function tokensForSession(eventsPath: string): Promise<{
  tokensByModel: Map<string, TokenUsage>;
  requestsByModel: Map<string, number>;
  lastModel?: string;
}> {
  if (!fs.existsSync(eventsPath)) {
    return { tokensByModel: new Map(), requestsByModel: new Map() };
  }

  const cached = tokensCache.get(eventsPath);
  const cachedSize = cached?.size ?? 0;
  const cachedMtimeMs = cached?.mtimeMs ?? 0;

  let inc;
  try {
    inc = await readIncrementalLines(eventsPath, cachedSize, cachedMtimeMs);
  } catch {
    return {
      tokensByModel: cached?.tokensByModel ?? new Map(),
      requestsByModel: cached?.requestsByModel ?? new Map(),
      lastModel: cached?.lastModel,
    };
  }

  if (
    cached &&
    !inc.fullReparse &&
    inc.newLines.length === 0 &&
    inc.currentSize === cachedSize &&
    inc.currentMtimeMs === cachedMtimeMs
  ) {
    return {
      tokensByModel: cached.tokensByModel,
      requestsByModel: cached.requestsByModel,
      lastModel: cached.lastModel,
    };
  }

  let result: ReturnType<typeof tokensFromEvents>;
  if (inc.fullReparse || !cached) {
    // Scout transcripts can hit tens of thousands of lines; read everything
    // since the shutdown aggregate may appear at the very end. The
    // mtime+size cache means we only pay this once per file.
    let lines: string[] = [];
    try {
      lines = await readLastLines(eventsPath, 200_000);
    } catch {
      // ignore
    }
    result = tokensFromEvents(lines, {
      tokensByModel: new Map(),
      requestsByModel: new Map(),
      shutdownSeen: false,
    });
  } else {
    result = tokensFromEvents(inc.newLines, {
      tokensByModel: cached.tokensByModel,
      requestsByModel: cached.requestsByModel,
      lastModel: cached.lastModel,
      shutdownSeen: cached.shutdownSeen,
    });
  }

  tokensCache.set(eventsPath, {
    mtimeMs: inc.currentMtimeMs,
    size: inc.currentSize,
    tokensByModel: result.tokensByModel,
    requestsByModel: result.requestsByModel,
    lastModel: result.lastModel,
    shutdownSeen: result.shutdownSeen,
  });
  return {
    tokensByModel: result.tokensByModel,
    requestsByModel: result.requestsByModel,
    lastModel: result.lastModel,
  };
}

function sumTokens(byModel: Map<string, TokenUsage>): TokenUsage {
  let total = emptyTokenUsage();
  for (const t of byModel.values()) total = addTokens(total, t);
  return total;
}

// ── Sessions ─────────────────────────────────────────────────────────────────

function metaToSession(meta: ScoutSessionMeta): ClaudeSession {
  const start = meta.start;
  const startedAt = start?.startTime
    ? Date.parse(start.startTime)
    : meta.mtimeMs;
  const cwd = start?.cwd ?? "";
  const hasLock = !!meta.lockPath && fs.existsSync(meta.lockPath);

  const { status, lastMessage } = getStatusFromEvents(meta.eventsPath, hasLock);

  const projectName =
    projectNameFromPath(cwd) ||
    `Scout session ${meta.sessionId.slice(0, 8)}`;

  return {
    pid: 0,
    sessionId: meta.sessionId,
    cwd,
    startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
    kind: "task",
    entrypoint: "scout",
    isAlive: status !== "dead",
    status,
    projectName,
    lastMessage,
    provider: "scout",
    model: start?.selectedModel,
  };
}

export async function getActiveSessions(): Promise<ClaudeSession[]> {
  const sessions = await discoverSessions();
  return sessions
    .map(metaToSession)
    .sort((a, b) => b.startedAt - a.startedAt);
}

// ── Projects ─────────────────────────────────────────────────────────────────
//
// Scout's cwd is often a fixed sandbox path (e.g. ~/Documents/Microsoft Scout)
// so grouping by cwd would produce a single mega-project. We group instead by
// the leaf directory name of `cwd` — sessions that ran in different folders
// each show up as their own project, and the default Scout sandbox folds into
// one. Sessions with no cwd fall into a single "Scout sessions" bucket.

function projectKeyFor(meta: ScoutSessionMeta): string {
  const cwd = meta.start?.cwd ?? "";
  if (!cwd) return "scout-default";
  return cwd;
}

function projectLabelFor(key: string): string {
  if (key === "scout-default") return "Scout sessions";
  return projectNameFromPath(key) || key;
}

function projectIdFor(key: string): string {
  // Stable, URL-safe id. Use a hash-like representation so identical cwd
  // strings collide deterministically across processes.
  // We avoid `crypto` to keep this synchronous and pure: a base64 encoding
  // of the key is enough for uniqueness.
  return `scout-${Buffer.from(key).toString("base64url")}`;
}

function projectKeyFromId(id: string): string | null {
  if (!id.startsWith("scout-")) return null;
  const encoded = id.slice("scout-".length);
  try {
    return Buffer.from(encoded, "base64url").toString("utf-8");
  } catch {
    return null;
  }
}

async function tokensForMany(
  sessions: ScoutSessionMeta[]
): Promise<
  Array<{
    tokensByModel: Map<string, TokenUsage>;
    requestsByModel: Map<string, number>;
    lastModel?: string;
  }>
> {
  return Promise.all(sessions.map((s) => tokensForSession(s.eventsPath)));
}

export async function getProjects(): Promise<ProjectSummary[]> {
  const sessions = await discoverSessions();
  if (sessions.length === 0) return [];

  const byKey = new Map<string, ScoutSessionMeta[]>();
  for (const m of sessions) {
    const k = projectKeyFor(m);
    const list = byKey.get(k) ?? [];
    list.push(m);
    byKey.set(k, list);
  }

  const summaries: ProjectSummary[] = [];
  for (const [key, items] of byKey.entries()) {
    const tokensPerItem = await tokensForMany(items);

    let totalTokens = emptyTokenUsage();
    let lastActivity = 0;
    let projectCost: CostEstimate = {
      inputCost: 0,
      outputCost: 0,
      cacheWriteCost: 0,
      cacheReadCost: 0,
      totalCost: 0,
    };

    for (let i = 0; i < items.length; i++) {
      const meta = items[i];
      const { tokensByModel, requestsByModel } = tokensPerItem[i];
      totalTokens = addTokens(totalTokens, sumTokens(tokensByModel));
      const c = calculateScoutCost(requestsByModel);
      projectCost = {
        inputCost: projectCost.inputCost + c.inputCost,
        outputCost: projectCost.outputCost + c.outputCost,
        cacheWriteCost: projectCost.cacheWriteCost + c.cacheWriteCost,
        cacheReadCost: projectCost.cacheReadCost + c.cacheReadCost,
        totalCost: projectCost.totalCost + c.totalCost,
      };
      const startedAt = meta.start?.startTime
        ? Date.parse(meta.start.startTime)
        : meta.mtimeMs;
      if (Number.isFinite(startedAt) && startedAt > lastActivity) {
        lastActivity = startedAt;
      }
      if (meta.mtimeMs > lastActivity) lastActivity = meta.mtimeMs;
    }

    summaries.push({
      id: projectIdFor(key),
      path: key,
      name: projectLabelFor(key),
      sessionCount: items.length,
      lastActivity: new Date(lastActivity || Date.now()).toISOString(),
      totalTokens,
      cost: projectCost,
      provider: "scout",
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
  const key = projectKeyFromId(projectId);
  if (key === null) return null;

  const sessions = await discoverSessions();
  const items = sessions.filter((m) => projectKeyFor(m) === key);
  if (items.length === 0) return null;

  const sorted = [...items].sort((a, b) => {
    const ta = a.start?.startTime ? Date.parse(a.start.startTime) : a.mtimeMs;
    const tb = b.start?.startTime ? Date.parse(b.start.startTime) : b.mtimeMs;
    return ta - tb;
  });

  const tokensPerItem = await tokensForMany(sorted);

  let totalTokens = emptyTokenUsage();
  const sessionRows: ProjectSession[] = [];
  const tokenTimeSeries: TokenDataPoint[] = [];
  let cumulativeInput = 0;
  let cumulativeOutput = 0;
  let lastActivity = 0;
  let projectCost: CostEstimate = {
    inputCost: 0,
    outputCost: 0,
    cacheWriteCost: 0,
    cacheReadCost: 0,
    totalCost: 0,
  };

  for (let i = 0; i < sorted.length; i++) {
    const meta = sorted[i];
    const { tokensByModel, requestsByModel } = tokensPerItem[i];
    const tokens = sumTokens(tokensByModel);
    totalTokens = addTokens(totalTokens, tokens);
    cumulativeInput += tokens.input_tokens;
    cumulativeOutput += tokens.output_tokens;
    const sessionCost = calculateScoutCost(requestsByModel);
    projectCost = {
      inputCost: projectCost.inputCost + sessionCost.inputCost,
      outputCost: projectCost.outputCost + sessionCost.outputCost,
      cacheWriteCost: projectCost.cacheWriteCost + sessionCost.cacheWriteCost,
      cacheReadCost: projectCost.cacheReadCost + sessionCost.cacheReadCost,
      totalCost: projectCost.totalCost + sessionCost.totalCost,
    };

    const startedAt = meta.start?.startTime
      ? Date.parse(meta.start.startTime)
      : meta.mtimeMs;
    const updated = meta.mtimeMs || startedAt;
    if (updated > lastActivity) lastActivity = updated;

    sessionRows.push({
      sessionId: meta.sessionId,
      messageCount: 0,
      totalTokens: tokens,
      firstMessage: new Date(startedAt || Date.now()).toISOString(),
      lastMessage: new Date(updated || Date.now()).toISOString(),
    });

    tokenTimeSeries.push({
      timestamp: new Date(startedAt || Date.now()).toISOString(),
      ...tokens,
      cumulative_input: cumulativeInput,
      cumulative_output: cumulativeOutput,
      provider: "scout",
    });
  }

  return {
    id: projectId,
    path: key,
    name: projectLabelFor(key),
    sessionCount: sorted.length,
    lastActivity: new Date(lastActivity || Date.now()).toISOString(),
    totalTokens,
    cost: projectCost,
    sessions: sessionRows,
    subagents: [],
    memoryFiles: [],
    tokenTimeSeries,
  };
}

// ── Session History ──────────────────────────────────────────────────────────

export async function getSessionHistory(): Promise<SessionHistory[]> {
  const sessions = await discoverSessions();
  if (sessions.length === 0) return [];

  const tokensPerItem = await tokensForMany(sessions);

  const history: SessionHistory[] = sessions.map((meta, idx) => {
    const { tokensByModel, requestsByModel } = tokensPerItem[idx];
    const tokens = sumTokens(tokensByModel);
    const hasLock = !!meta.lockPath && fs.existsSync(meta.lockPath);
    const { status } = getStatusFromEvents(meta.eventsPath, hasLock);
    const startedAt = meta.start?.startTime
      ? Date.parse(meta.start.startTime)
      : meta.mtimeMs;
    return {
      sessionId: meta.sessionId,
      projectName:
        projectNameFromPath(meta.start?.cwd ?? "") ||
        `Scout session ${meta.sessionId.slice(0, 8)}`,
      cwd: meta.start?.cwd ?? "",
      startedAt: Number.isFinite(startedAt) ? startedAt : 0,
      endedAt:
        status === "dead" ? new Date(meta.mtimeMs).toISOString() : undefined,
      entrypoint: "scout",
      totalTokens: tokens,
      cost: calculateScoutCost(requestsByModel),
      messageCount: 0,
      status,
      provider: "scout" as const,
    };
  });

  return history.sort((a, b) => b.startedAt - a.startedAt);
}

// ── Token usage ──────────────────────────────────────────────────────────────

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
      provider: "scout",
    });
  }
  return result;
}

export async function getDailyTokenUsage(days = 30): Promise<DailyTokenUsage[]> {
  const sessions = await discoverSessions();
  if (sessions.length === 0) return fillEmptyDays(days);

  const cutoff = Date.now() - days * 86_400_000;
  const relevant = sessions.filter((m) => {
    const startedAt = m.start?.startTime ? Date.parse(m.start.startTime) : m.mtimeMs;
    return Number.isFinite(startedAt) && startedAt >= cutoff;
  });

  const tokensPerItem = await tokensForMany(relevant);

  const byDay = new Map<string, TokenUsage>();
  const costByDay = new Map<string, number>();
  const sessionsByDay = new Map<string, number>();

  for (let i = 0; i < relevant.length; i++) {
    const meta = relevant[i];
    const startedAt = meta.start?.startTime
      ? Date.parse(meta.start.startTime)
      : meta.mtimeMs;
    const dateStr = formatLocalDate(new Date(startedAt));
    const { tokensByModel, requestsByModel } = tokensPerItem[i];
    const tokens = sumTokens(tokensByModel);
    byDay.set(
      dateStr,
      addTokens(byDay.get(dateStr) ?? emptyTokenUsage(), tokens)
    );
    const cost = calculateScoutCost(requestsByModel).totalCost;
    costByDay.set(dateStr, (costByDay.get(dateStr) ?? 0) + cost);
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
      totalCost: costByDay.get(dateStr) ?? 0,
      sessionCount: sessionsByDay.get(dateStr) ?? 0,
      provider: "scout",
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
    provider: "scout" as const,
  }));
}

// ── Search ───────────────────────────────────────────────────────────────────

export async function searchAll(query: string): Promise<SearchResult[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const sessions = await discoverSessions();
  const results: SearchResult[] = [];
  for (const meta of sessions) {
    const haystack = [
      meta.start?.cwd ?? "",
      meta.start?.selectedModel ?? "",
      meta.sessionId,
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(q)) continue;
    results.push({
      type: "session",
      title:
        projectNameFromPath(meta.start?.cwd ?? "") ||
        `Scout session ${meta.sessionId.slice(0, 8)}`,
      subtitle: meta.start?.cwd || "Scout session",
      href: `/sessions?id=${meta.sessionId}`,
    });
    if (results.length >= 20) break;
  }
  return results;
}

// ── Conversation ─────────────────────────────────────────────────────────────

export async function findSessionJsonl(sessionId: string): Promise<string | null> {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) return null;
  if (!scoutRootExists()) return null;
  const eventsPath = path.join(SCOUT_ROOT, sessionId, "events.jsonl");
  if (!isWithinDir(eventsPath, SCOUT_ROOT)) return null;
  return fs.existsSync(eventsPath) ? eventsPath : null;
}

export function findSessionJsonlSync(sessionId: string): string | null {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) return null;
  if (!scoutRootExists()) return null;
  const eventsPath = path.join(SCOUT_ROOT, sessionId, "events.jsonl");
  if (!isWithinDir(eventsPath, SCOUT_ROOT)) return null;
  try {
    return fs.existsSync(eventsPath) ? eventsPath : null;
  } catch {
    return null;
  }
}

export async function getConversationPreview(
  sessionId: string,
  maxMessages = 20
): Promise<ConversationMessage[]> {
  const eventsPath = await findSessionJsonl(sessionId);
  if (!eventsPath) return [];

  try {
    // Pull a generous tail: events.jsonl interleaves tool, hook, and
    // permission events with the actual user/assistant turns, so we'd need
    // to over-read by ~10x to recover `maxMessages` real messages.
    const lines = await readLastLines(eventsPath, maxMessages * 20);
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
        (entry.timestamp as string | undefined) ?? new Date().toISOString();
      const data = (entry.data ?? {}) as Record<string, unknown>;

      if (type === "user.message") {
        const content = data.content ?? data.text ?? data.message;
        let text = "";
        if (typeof content === "string") {
          text = content;
        } else if (Array.isArray(content)) {
          const textBlock = (content as Array<Record<string, unknown>>).find(
            (c) => c.type === "text"
          );
          if (textBlock && typeof textBlock.text === "string") {
            text = textBlock.text;
          }
        }
        if (text.trim()) {
          messages.push({
            role: "user",
            text: text.slice(0, 500),
            timestamp: ts,
          });
        }
      } else if (type === "assistant.message") {
        const content = data.content;
        let text = "";
        if (typeof content === "string") {
          text = content;
        } else if (Array.isArray(content)) {
          text = (content as Array<Record<string, unknown>>)
            .filter((c) => c.type === "text")
            .map((c) => String(c.text ?? ""))
            .join("\n");
        }
        // Scout also stores reasoning text separately — surface it when no
        // user-visible content is present so the preview isn't empty for
        // reasoning-heavy turns.
        if (!text.trim() && typeof data.reasoningText === "string") {
          text = data.reasoningText;
        }
        if (text.trim()) {
          messages.push({
            role: "assistant",
            text: text.slice(0, 500),
            timestamp: ts,
          });
        }
      }
    }

    return messages.slice(-maxMessages);
  } catch {
    return [];
  }
}

export async function getSessionErrors(sessionId: string): Promise<string[]> {
  const eventsPath = await findSessionJsonl(sessionId);
  if (!eventsPath) return [];

  try {
    const lines = await readLastLines(eventsPath, 500);
    const errors: string[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        const type = entry.type as string | undefined;
        const data = (entry.data ?? {}) as Record<string, unknown>;
        if (type === "tool.execution_complete") {
          const error = data.error ?? data.errorMessage;
          if (error && typeof error === "string" && error.trim()) {
            errors.push(error.slice(0, 300));
          } else if (data.isError === true) {
            const result = data.result;
            const text =
              typeof result === "string" ? result : JSON.stringify(result ?? "");
            errors.push(text.slice(0, 300));
          }
        } else if (type === "permission.completed") {
          const decision = data.decision ?? data.outcome;
          if (typeof decision === "string" && decision.toLowerCase() === "denied") {
            const tool =
              typeof data.toolName === "string" ? data.toolName : "tool";
            errors.push(`Permission denied for ${tool}`);
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

export async function readConversationLines(
  filePath: string,
  n: number
): Promise<string[]> {
  return readLastLines(filePath, n);
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
  let monthCostTotal = 0;

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
      monthCostTotal += day.totalCost;
    }
  }

  const tokenTimeSeries: TokenDataPoint[] = [];
  const recentProjects = projects.slice(0, 3);
  const recentDetails = await Promise.all(
    recentProjects.map((p) => getProjectDetail(p.id))
  );
  for (const detail of recentDetails) {
    if (detail) tokenTimeSeries.push(...detail.tokenTimeSeries);
  }

  const activeProjectCount = projects.filter((p) => {
    const lastAct = new Date(p.lastActivity).getTime();
    return Date.now() - lastAct < 86_400_000;
  }).length;

  return {
    activeSessions: aliveSessions.length,
    awaitingInput,
    totalTokensToday,
    totalTokensMonth,
    totalCost: {
      inputCost: 0,
      outputCost: 0,
      cacheWriteCost: 0,
      cacheReadCost: 0,
      totalCost: monthCostTotal,
    },
    activeProjects: activeProjectCount,
    scheduledTasks: 0,
    recentSessions: aliveSessions.slice(0, 5),
    tokenTimeSeries: tokenTimeSeries.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    ),
  };
}

// ── Scheduled tasks / plugins ────────────────────────────────────────────────

export async function getScheduledTasks(): Promise<ScheduledTask[]> {
  // Scout has no scheduled-task system of its own.
  return [];
}

export async function getInstalledPlugins(): Promise<InstalledPlugin[]> {
  // Scout's ecosystem is separate (skills/MCP under ~/.copilot/) — not
  // surfaced through the Claude plugins page in v1.
  return [];
}

// ── System Status ────────────────────────────────────────────────────────────

export async function getScoutProviderStatus(): Promise<ProviderStatus> {
  // CLI version is taken from the first session.start event we can find;
  // Scout itself doesn't expose a global version file.
  let cliVersion = scoutRootExists() ? "via Microsoft Scout" : "not installed";
  try {
    const sessions = await discoverSessions();
    const versioned = sessions.find((s) => s.start?.copilotVersion);
    if (versioned?.start?.copilotVersion) {
      cliVersion = versioned.start.copilotVersion;
    }
  } catch {
    // best-effort
  }

  // Scout is primarily Claude-backed; reuse the Anthropic status check.
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
    // best-effort
  }

  return { cliVersion, apiStatus };
}
