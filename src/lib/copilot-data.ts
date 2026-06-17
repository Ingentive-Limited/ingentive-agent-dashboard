/**
 * GitHub Copilot Chat (VS Code) data reader.
 *
 * The Copilot Chat extension for VS Code records one chat session per JSONL
 * (or pretty-printed JSON for empty-window sessions) under:
 *
 *   ~/Library/Application Support/Code/User/workspaceStorage/
 *     <workspaceHash>/chatSessions/<sessionId>.jsonl
 *   ~/Library/Application Support/Code/User/globalStorage/
 *     emptyWindowChatSessions/<sessionId>.json
 *
 * The workspace one is the dominant case: an append-only JSONL where the
 * first line is a `{kind:0, v:{...}}` header (full session snapshot) and
 * each subsequent `{kind:1, k:<path>, v:<value>}` line is a JSON Patch-style
 * mutation. A completed assistant turn lands as
 *
 *   {kind:1, k:["requests", N, "result"], v:{ usage, details, metadata, ... }}
 *
 * where:
 *   - `details` carries the model name AND the Copilot premium-request
 *     multiplier inline ("Claude Opus 4.7 • 10x", "Grok Code Fast 1 • 1x").
 *     Microsoft has already computed and recorded the correct multiplier;
 *     we parse it back out with a regex rather than consulting our own
 *     COPILOT_MULTIPLIERS table.
 *   - `usage = { promptTokens, completionTokens, promptTokenDetails }` —
 *     camelCase, no cache_read/cache_write counters (VS Code's Copilot Chat
 *     doesn't expose them). We map `promptTokens → input_tokens` and
 *     `completionTokens → output_tokens` with cache_* set to 0.
 *   - `metadata.agentId` identifies the mode (editsAgent, askAgent, etc.).
 *
 * Each `["requests", N, "result"]` mutation = 1 completed assistant turn =
 * 1 premium request consumed (the multiplier scales the COST, not the count).
 *
 * Empty-window files (`emptyWindowChatSessions/*.json`) are pretty-printed
 * SNAPSHOTS (not JSONL) of the same shape — a single JSON object with a
 * top-level `requests` array containing entries whose `result` field has the
 * same `details` / `usage` / `metadata` payload as the JSONL `result`
 * mutations. We parse those whole, then aggregate.
 *
 * Workspace project name: `<workspaceStorage>/<hash>/workspace.json` has
 * `{"folder":"file:///path/to/project"}`. Leaf directory of that path is the
 * project name. Missing workspace.json → fall back to the short hash.
 *
 * IMPORTANT — this module lives in totally DISJOINT paths from
 * scout-data.ts. Scout uses `~/.copilot/session-state/`; this module uses
 * `~/Library/Application Support/Code/.../chatSessions/` and never touches
 * `~/.copilot/`. There is no double-counting risk between Scout and Copilot.
 *
 * Cost: per (model, count) using the multiplier parsed from `details` ×
 * COPILOT_OVER_QUOTA_RATE_USD ($0.04). The COPILOT_MULTIPLIERS lookup table
 * is a fallback for transcripts whose `details` is missing or unparseable.
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
import {
  COPILOT_OVER_QUOTA_RATE_USD,
  copilotMultiplier,
} from "./pricing";

const COPILOT_ROOT_WORKSPACE = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "Code",
  "User",
  "workspaceStorage"
);
const COPILOT_ROOT_EMPTY = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "Code",
  "User",
  "globalStorage",
  "emptyWindowChatSessions"
);

// ── Details / multiplier parsing ─────────────────────────────────────────────

/**
 * Extract the numeric premium-request multiplier embedded in a Copilot
 * `details` string such as "Claude Opus 4.7 • 10x", "o3-mini • 0.33x",
 * "Grok Code Fast 1 • 1x". Returns undefined when no `<number>x` suffix is
 * present. Exported for unit tests.
 */
export function parseMultiplierFromDetails(
  details: string | undefined | null
): number | undefined {
  if (!details || typeof details !== "string") return undefined;
  const m = details.match(/(\d+(?:\.\d+)?)\s*x\s*$/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Extract the model display name from a `details` string by stripping the
 * trailing " • <Nx>" suffix. "Claude Opus 4.7 • 10x" → "Claude Opus 4.7".
 * Returns the original string when no suffix is detected, undefined for
 * null/empty input.
 */
export function parseModelFromDetails(
  details: string | undefined | null
): string | undefined {
  if (!details || typeof details !== "string") return undefined;
  const trimmed = details.trim();
  if (!trimmed) return undefined;
  // Strip a trailing " • Nx" / " · Nx" suffix.
  const stripped = trimmed.replace(/\s*[•·]\s*\d+(?:\.\d+)?\s*x\s*$/i, "").trim();
  return stripped || trimmed;
}

/**
 * Compute the Copilot dollar cost for a set of completed requests grouped by
 * model display name. Each request was already attributed its inline
 * multiplier at parse time, so this just sums multiplier × COPILOT_OVER_QUOTA_RATE_USD.
 */
function calculateCopilotCost(
  multiplierByRequest: number[]
): CostEstimate {
  let total = 0;
  for (const m of multiplierByRequest) {
    if (Number.isFinite(m)) total += m * COPILOT_OVER_QUOTA_RATE_USD;
  }
  return {
    inputCost: 0,
    outputCost: 0,
    cacheWriteCost: 0,
    cacheReadCost: 0,
    totalCost: total,
  };
}

// ── Workspace / project mapping ─────────────────────────────────────────────

interface CopilotSessionMeta {
  sessionId: string;
  /** Absolute path to the JSONL (or JSON for empty-window) file. */
  eventsPath: string;
  /**
   * Workspace storage hash for grouping, or the literal "__empty__" for
   * windows that had no folder open when the chat was started.
   */
  workspaceHash: string;
  /** Decoded folder path (from workspace.json `folder` file URI), or null. */
  folder: string | null;
  /** mtime of the events file in ms epoch. */
  mtimeMs: number;
  /** Header inputState.mode.id (e.g. "agent", "ask"). null for snapshots. */
  modeId: string | null;
  /** Header selectedModel.name (display name). */
  headerModelName: string | null;
  /** ms epoch creationDate from header, if known. */
  creationDateMs: number | null;
  /** True for empty-window snapshot files (.json), false for JSONL workspace files. */
  isSnapshot: boolean;
}

let manifestsCache: CopilotSessionMeta[] | null = null;
let manifestsCacheAt = 0;
const MANIFESTS_TTL_MS = 5_000;

function rootExists(): boolean {
  return (
    fs.existsSync(COPILOT_ROOT_WORKSPACE) || fs.existsSync(COPILOT_ROOT_EMPTY)
  );
}

async function readFirstLine(filePath: string): Promise<string | null> {
  try {
    const fd = await fs.promises.open(filePath, "r");
    try {
      const buf = Buffer.alloc(16384);
      const { bytesRead } = await fd.read(buf, 0, 16384, 0);
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

interface ParsedHeader {
  modeId: string | null;
  modelName: string | null;
  creationDateMs: number | null;
}

function parseJsonlHeader(line: string): ParsedHeader {
  try {
    const entry = JSON.parse(line) as Record<string, unknown>;
    if (entry.kind !== 0) {
      return { modeId: null, modelName: null, creationDateMs: null };
    }
    const v = (entry.v ?? {}) as Record<string, unknown>;
    const inputState = (v.inputState ?? {}) as Record<string, unknown>;
    const mode = (inputState.mode ?? {}) as Record<string, unknown>;
    const selectedModel = (inputState.selectedModel ?? {}) as Record<
      string,
      unknown
    >;
    const metadata = (selectedModel.metadata ?? {}) as Record<string, unknown>;
    const modeId = typeof mode.id === "string" ? mode.id : null;
    const modelName =
      typeof metadata.name === "string"
        ? metadata.name
        : typeof selectedModel.name === "string"
        ? (selectedModel.name as string)
        : null;
    const creationDate =
      typeof v.creationDate === "number" ? v.creationDate : null;
    return { modeId, modelName, creationDateMs: creationDate };
  } catch {
    return { modeId: null, modelName: null, creationDateMs: null };
  }
}

/**
 * Decode the workspace.json `folder` field. The value is a `file://` URI
 * (with percent-encoded segments). Returns null on any error.
 */
function decodeWorkspaceFolder(workspaceJsonPath: string): string | null {
  try {
    const raw = fs.readFileSync(workspaceJsonPath, "utf-8");
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const folder = typeof obj.folder === "string" ? obj.folder : null;
    if (!folder) return null;
    if (folder.startsWith("file://")) {
      try {
        return decodeURIComponent(folder.slice("file://".length));
      } catch {
        return folder.slice("file://".length);
      }
    }
    return folder;
  } catch {
    return null;
  }
}

async function discoverSessions(): Promise<CopilotSessionMeta[]> {
  const now = Date.now();
  if (manifestsCache && now - manifestsCacheAt < MANIFESTS_TTL_MS) {
    return manifestsCache;
  }

  if (!rootExists()) {
    manifestsCache = [];
    manifestsCacheAt = now;
    return manifestsCache;
  }

  const results: CopilotSessionMeta[] = [];

  // ── Workspace JSONLs ──
  let workspaceHashes: string[] = [];
  try {
    workspaceHashes = await fs.promises.readdir(COPILOT_ROOT_WORKSPACE);
  } catch {
    workspaceHashes = [];
  }

  for (const hash of workspaceHashes) {
    if (!/^[a-zA-Z0-9_-]+$/.test(hash)) continue;
    const wsDir = path.join(COPILOT_ROOT_WORKSPACE, hash);
    if (!isWithinDir(wsDir, COPILOT_ROOT_WORKSPACE)) continue;
    const chatDir = path.join(wsDir, "chatSessions");

    let chatFiles: string[];
    try {
      const stat = await fs.promises.stat(chatDir);
      if (!stat.isDirectory()) continue;
      chatFiles = await fs.promises.readdir(chatDir);
    } catch {
      continue;
    }
    if (chatFiles.length === 0) continue;

    const folder = decodeWorkspaceFolder(path.join(wsDir, "workspace.json"));

    for (const fname of chatFiles) {
      if (!fname.endsWith(".jsonl")) continue;
      const sessionId = fname.slice(0, -".jsonl".length);
      if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) continue;
      const eventsPath = path.join(chatDir, fname);
      if (!isWithinDir(eventsPath, COPILOT_ROOT_WORKSPACE)) continue;

      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(eventsPath);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;

      const firstLine = await readFirstLine(eventsPath);
      const header = firstLine
        ? parseJsonlHeader(firstLine)
        : { modeId: null, modelName: null, creationDateMs: null };

      results.push({
        sessionId,
        eventsPath,
        workspaceHash: hash,
        folder,
        mtimeMs: stat.mtimeMs,
        modeId: header.modeId,
        headerModelName: header.modelName,
        creationDateMs: header.creationDateMs,
        isSnapshot: false,
      });
    }
  }

  // ── Empty-window JSON snapshots ──
  if (fs.existsSync(COPILOT_ROOT_EMPTY)) {
    let emptyFiles: string[];
    try {
      emptyFiles = await fs.promises.readdir(COPILOT_ROOT_EMPTY);
    } catch {
      emptyFiles = [];
    }
    for (const fname of emptyFiles) {
      if (!fname.endsWith(".json")) continue;
      const sessionId = fname.slice(0, -".json".length);
      if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) continue;
      const eventsPath = path.join(COPILOT_ROOT_EMPTY, fname);
      if (!isWithinDir(eventsPath, COPILOT_ROOT_EMPTY)) continue;

      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(eventsPath);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;

      // Snapshot files are small enough to read in one go for the header
      // (and tokens; the whole file is the "events"). Parse the JSON now to
      // grab the header bits; tokensForSession() will re-read on demand.
      let modeId: string | null = null;
      let modelName: string | null = null;
      let creationDateMs: number | null = null;
      try {
        const raw = await fs.promises.readFile(eventsPath, "utf-8");
        const obj = JSON.parse(raw) as Record<string, unknown>;
        const mode = (obj.mode ?? {}) as Record<string, unknown>;
        modeId = typeof mode.id === "string" ? mode.id : null;
        creationDateMs =
          typeof obj.creationDate === "number" ? obj.creationDate : null;
        // selectedModel may live on inputState or at the root depending on
        // VS Code version. Try both.
        const selectedModel =
          ((obj.selectedModel ??
            ((obj.inputState as Record<string, unknown> | undefined) ?? {})
              .selectedModel) as Record<string, unknown> | undefined) ?? {};
        const metadata = (selectedModel.metadata ?? {}) as Record<
          string,
          unknown
        >;
        modelName =
          typeof metadata.name === "string"
            ? metadata.name
            : typeof selectedModel.name === "string"
            ? (selectedModel.name as string)
            : null;
      } catch {
        // best-effort
      }

      results.push({
        sessionId,
        eventsPath,
        workspaceHash: "__empty__",
        folder: null,
        mtimeMs: stat.mtimeMs,
        modeId,
        headerModelName: modelName,
        creationDateMs,
        isSnapshot: true,
      });
    }
  }

  manifestsCache = results;
  manifestsCacheAt = now;
  return results;
}

// ── Token aggregation ───────────────────────────────────────────────────────

interface CompletedRequest {
  /** Model display name parsed from `details`, or null if absent. */
  model: string | null;
  /** Multiplier parsed from `details`, or undefined when unrecognised. */
  multiplier: number | undefined;
  /** Token usage normalised to canonical shape. */
  tokens: TokenUsage;
  /** True when the result included an `errorDetails` block. */
  hadError: boolean;
}

interface ParsedSessionState {
  /** All completed requests parsed from the file. */
  requests: CompletedRequest[];
  /** Whether at least one `["requests", N]` slot exists without a `result`. */
  hasPendingRequest: boolean;
  /** Header-default model name from session.inputState.selectedModel. */
  headerModel: string | null;
  /** Last seen agentId. */
  lastAgentId: string | null;
}

/**
 * Normalise a Copilot usage object (camelCase keys: `promptTokens`,
 * `completionTokens`) into the canonical TokenUsage shape. Cache fields are
 * always 0 because VS Code Copilot Chat doesn't expose cache-read or
 * cache-write metrics. Exported for unit tests.
 */
export function normaliseCopilotUsage(
  usage: Record<string, unknown> | null | undefined
): TokenUsage {
  if (!usage || typeof usage !== "object") return emptyTokenUsage();
  const num = (v: unknown): number => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    input_tokens: num(usage.promptTokens),
    output_tokens: num(usage.completionTokens),
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
}

function parseResultPayload(
  v: Record<string, unknown> | null | undefined,
  headerModel: string | null
): CompletedRequest {
  const safe = v ?? {};
  const details = typeof safe.details === "string" ? safe.details : undefined;
  const model = parseModelFromDetails(details) ?? headerModel ?? null;
  const multiplier = parseMultiplierFromDetails(details);
  const usage = (safe.usage ?? null) as Record<string, unknown> | null;
  const tokens = normaliseCopilotUsage(usage);
  const hadError =
    safe.errorDetails != null &&
    typeof safe.errorDetails === "object";
  return { model, multiplier, tokens, hadError };
}

/**
 * Parse a Copilot Chat JSONL transcript (and snapshot JSON) into completed
 * requests. Exported for unit tests.
 *
 * For JSONL files we walk patch events:
 *   - `{kind:0, v:{...}}` → header (model/mode defaults)
 *   - `{kind:1, k:["requests", N, "result"], v:{...}}` → completed request
 *   - `{kind:1, k:["requests", N], v:{...}}` (full slot write without result
 *     yet) → tracked as `hasPendingRequest`
 *
 * For snapshot JSON files the caller passes a single line containing the
 * entire pretty-printed object (we synthesise by joining and reading the
 * whole file ahead of time).
 */
export function tokensFromCopilotEvents(
  lines: string[],
  initial: ParsedSessionState
): ParsedSessionState {
  // We must track per-index whether a `result` has landed yet, so that a
  // partial mutation (the slot exists but result is missing) is recorded as
  // `hasPendingRequest`. Indices are stable across incremental reads since
  // VS Code only appends to the end.
  const resultsByIndex = new Map<number, CompletedRequest>();
  // Seed with already-parsed requests so an incremental call doesn't lose
  // previous turns. Index reconstruction is not strictly needed for our use:
  // we treat the seeded array as immutable history and add new ones from
  // result events in this chunk.
  const carry: CompletedRequest[] = [...initial.requests];
  let headerModel = initial.headerModel;
  let lastAgentId = initial.lastAgentId;
  const slotsSeen = new Set<number>();

  for (const line of lines) {
    if (!line) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.kind === 0) {
      const v = (entry.v ?? {}) as Record<string, unknown>;
      const inputState = (v.inputState ?? {}) as Record<string, unknown>;
      const selectedModel = (inputState.selectedModel ?? {}) as Record<
        string,
        unknown
      >;
      const metadata = (selectedModel.metadata ?? {}) as Record<string, unknown>;
      headerModel =
        typeof metadata.name === "string"
          ? metadata.name
          : typeof selectedModel.name === "string"
          ? (selectedModel.name as string)
          : headerModel;
      // Pre-existing requests in the header snapshot
      const reqs = v.requests;
      if (Array.isArray(reqs)) {
        for (let i = 0; i < reqs.length; i++) {
          const r = reqs[i] as Record<string, unknown> | undefined;
          slotsSeen.add(i);
          if (r && typeof r === "object" && r.result != null) {
            const parsed = parseResultPayload(
              r.result as Record<string, unknown>,
              headerModel
            );
            const md = ((r.result as Record<string, unknown>).metadata ?? {}) as Record<
              string,
              unknown
            >;
            if (typeof md.agentId === "string") lastAgentId = md.agentId;
            resultsByIndex.set(i, parsed);
          }
        }
      }
      continue;
    }
    if (entry.kind !== 1) continue;
    const k = entry.k;
    if (!Array.isArray(k) || k.length < 2 || k[0] !== "requests") continue;
    const idx = typeof k[1] === "number" ? k[1] : null;
    if (idx === null) continue;
    slotsSeen.add(idx);
    // Two shapes that matter: write of the whole slot at index N, or write
    // of just the `result` sub-field. We only count the result.
    if (k.length === 2) {
      // Full slot write; check whether it has a `result` field.
      const v = entry.v as Record<string, unknown> | null | undefined;
      if (v && typeof v === "object" && v.result != null) {
        const parsed = parseResultPayload(
          v.result as Record<string, unknown>,
          headerModel
        );
        const md = ((v.result as Record<string, unknown>).metadata ?? {}) as Record<
          string,
          unknown
        >;
        if (typeof md.agentId === "string") lastAgentId = md.agentId;
        resultsByIndex.set(idx, parsed);
      }
      continue;
    }
    if (k.length >= 3 && k[2] === "result") {
      // Direct write to the result field of slot N.
      const v = entry.v as Record<string, unknown> | null | undefined;
      if (v && typeof v === "object") {
        const parsed = parseResultPayload(v, headerModel);
        const md = (v.metadata ?? {}) as Record<string, unknown>;
        if (typeof md.agentId === "string") lastAgentId = md.agentId;
        resultsByIndex.set(idx, parsed);
      }
      continue;
    }
    // Other sub-paths (timings, etc.) — we don't need them.
  }

  // Append new results in index order.
  const newRequests = [...resultsByIndex.entries()].sort(
    (a, b) => a[0] - b[0]
  );
  for (const [, req] of newRequests) carry.push(req);

  const hasPendingRequest =
    slotsSeen.size > 0 &&
    [...slotsSeen].some((i) => !resultsByIndex.has(i)) &&
    initial.requests.length === 0; // best-effort, only checked on cold parse

  return {
    requests: carry,
    hasPendingRequest: initial.hasPendingRequest || hasPendingRequest,
    headerModel,
    lastAgentId,
  };
}

/**
 * Parse a single pretty-printed snapshot JSON file (emptyWindowChatSessions).
 * Equivalent to tokensFromCopilotEvents but pulled out for clarity. Returns
 * the same ParsedSessionState shape.
 */
export function tokensFromSnapshotJson(
  raw: string
): ParsedSessionState {
  const state: ParsedSessionState = {
    requests: [],
    hasPendingRequest: false,
    headerModel: null,
    lastAgentId: null,
  };
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return state;
  }
  const inputState =
    (obj.inputState as Record<string, unknown> | undefined) ?? obj;
  const selectedModel = (inputState.selectedModel ?? {}) as Record<
    string,
    unknown
  >;
  const metadata = (selectedModel.metadata ?? {}) as Record<string, unknown>;
  state.headerModel =
    typeof metadata.name === "string"
      ? metadata.name
      : typeof selectedModel.name === "string"
      ? (selectedModel.name as string)
      : null;
  const reqs = obj.requests;
  if (Array.isArray(reqs)) {
    for (let i = 0; i < reqs.length; i++) {
      const r = reqs[i] as Record<string, unknown> | undefined;
      if (r && typeof r === "object" && r.result != null) {
        const parsed = parseResultPayload(
          r.result as Record<string, unknown>,
          state.headerModel
        );
        const md = ((r.result as Record<string, unknown>).metadata ?? {}) as Record<
          string,
          unknown
        >;
        if (typeof md.agentId === "string") state.lastAgentId = md.agentId;
        state.requests.push(parsed);
      } else if (r && typeof r === "object") {
        state.hasPendingRequest = true;
      }
    }
  }
  return state;
}

// ── Per-file token cache ────────────────────────────────────────────────────

interface CachedTokens {
  mtimeMs: number;
  size: number;
  state: ParsedSessionState;
}
const tokensCache = new Map<string, CachedTokens>();

async function parsedStateForSession(
  meta: CopilotSessionMeta
): Promise<ParsedSessionState> {
  if (!fs.existsSync(meta.eventsPath)) {
    return {
      requests: [],
      hasPendingRequest: false,
      headerModel: meta.headerModelName,
      lastAgentId: null,
    };
  }

  if (meta.isSnapshot) {
    // Snapshot files are tiny and need a single parse — no need for the
    // incremental tail-read path. Still cache by mtime+size.
    const cached = tokensCache.get(meta.eventsPath);
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(meta.eventsPath);
    } catch {
      return (
        cached?.state ?? {
          requests: [],
          hasPendingRequest: false,
          headerModel: meta.headerModelName,
          lastAgentId: null,
        }
      );
    }
    if (
      cached &&
      cached.mtimeMs === stat.mtimeMs &&
      cached.size === stat.size
    ) {
      return cached.state;
    }
    let raw: string;
    try {
      raw = await fs.promises.readFile(meta.eventsPath, "utf-8");
    } catch {
      return (
        cached?.state ?? {
          requests: [],
          hasPendingRequest: false,
          headerModel: meta.headerModelName,
          lastAgentId: null,
        }
      );
    }
    const state = tokensFromSnapshotJson(raw);
    tokensCache.set(meta.eventsPath, {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      state,
    });
    return state;
  }

  // JSONL incremental path — mirrors scout-data exactly.
  const cached = tokensCache.get(meta.eventsPath);
  const cachedSize = cached?.size ?? 0;
  const cachedMtimeMs = cached?.mtimeMs ?? 0;

  let inc;
  try {
    inc = await readIncrementalLines(
      meta.eventsPath,
      cachedSize,
      cachedMtimeMs
    );
  } catch {
    return (
      cached?.state ?? {
        requests: [],
        hasPendingRequest: false,
        headerModel: meta.headerModelName,
        lastAgentId: null,
      }
    );
  }

  if (
    cached &&
    !inc.fullReparse &&
    inc.newLines.length === 0 &&
    inc.currentSize === cachedSize &&
    inc.currentMtimeMs === cachedMtimeMs
  ) {
    return cached.state;
  }

  let state: ParsedSessionState;
  if (inc.fullReparse || !cached) {
    let lines: string[] = [];
    try {
      // The JSONL can be enormous (tens of MB for long sessions). Read up
      // to ~200k tail lines like scout does.
      lines = await readLastLines(meta.eventsPath, 200_000);
    } catch {
      // ignore
    }
    state = tokensFromCopilotEvents(lines, {
      requests: [],
      hasPendingRequest: false,
      headerModel: meta.headerModelName,
      lastAgentId: null,
    });
  } else {
    state = tokensFromCopilotEvents(inc.newLines, cached.state);
  }

  tokensCache.set(meta.eventsPath, {
    mtimeMs: inc.currentMtimeMs,
    size: inc.currentSize,
    state,
  });
  return state;
}

function sumTokens(requests: CompletedRequest[]): TokenUsage {
  let total = emptyTokenUsage();
  for (const r of requests) total = addTokens(total, r.tokens);
  return total;
}

function costFromRequests(requests: CompletedRequest[]): CostEstimate {
  const multipliers: number[] = [];
  for (const r of requests) {
    if (r.multiplier != null) {
      multipliers.push(r.multiplier);
    } else {
      // Fallback when `details` was missing or unparseable — use the static
      // COPILOT_MULTIPLIERS table from pricing.ts. Last resort.
      multipliers.push(copilotMultiplier(r.model));
    }
  }
  return calculateCopilotCost(multipliers);
}

// ── Status detection ────────────────────────────────────────────────────────

interface StatusResult {
  status: SessionStatus;
  lastMessage?: string;
}

/**
 * Determine session status from the most-recent activity on a Copilot Chat
 * file. VS Code has no clear "ended" marker, so:
 *   - mtime within 30s → running
 *   - last completed request had errorDetails → needs_attention
 *   - has at least one completed request → awaiting_input
 *   - has a pending slot without result → processing
 *   - otherwise → idle (over 7 days idle is still idle; we never report dead
 *     for Copilot since the file persists indefinitely)
 *
 * Exported for unit tests.
 */
export function statusFromCopilotState(
  state: ParsedSessionState,
  mtimeMs: number
): StatusResult {
  const ageMs = Number.isFinite(mtimeMs) ? Date.now() - mtimeMs : Infinity;
  if (ageMs < 30_000 && (state.requests.length > 0 || state.hasPendingRequest)) {
    return { status: "running" };
  }
  const last = state.requests[state.requests.length - 1];
  if (last?.hadError) return { status: "needs_attention" };
  if (state.hasPendingRequest && state.requests.length === 0) {
    return { status: "processing" };
  }
  if (state.requests.length > 0) {
    return { status: "awaiting_input" };
  }
  return { status: "idle" };
}

// ── Sessions ────────────────────────────────────────────────────────────────

function entrypointForAgentId(agentId: string | null): string {
  if (!agentId) return "copilot";
  // `github.copilot.editsAgent` / `github.copilot.askAgent` /
  // `github.copilot.terminalAgent` → shorten to "Copilot · Edit" etc.
  if (agentId.includes("editsAgent")) return "copilot-edit";
  if (agentId.includes("askAgent")) return "copilot-ask";
  if (agentId.includes("terminalAgent")) return "copilot-terminal";
  return "copilot";
}

function projectNameForMeta(meta: CopilotSessionMeta): string {
  if (meta.folder) return projectNameFromPath(meta.folder) || meta.folder;
  if (meta.workspaceHash === "__empty__") return "Copilot (no folder)";
  return `Copilot ${meta.workspaceHash.slice(0, 6)}`;
}

async function metaToSession(meta: CopilotSessionMeta): Promise<ClaudeSession> {
  const state = await parsedStateForSession(meta);
  const { status } = statusFromCopilotState(state, meta.mtimeMs);
  const startedAt = meta.creationDateMs ?? meta.mtimeMs;
  const lastModel =
    state.requests.length > 0
      ? state.requests[state.requests.length - 1].model
      : null;
  return {
    pid: 0,
    sessionId: meta.sessionId,
    cwd: meta.folder ?? "",
    startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
    kind: "task",
    entrypoint: entrypointForAgentId(state.lastAgentId),
    isAlive: status !== "dead",
    status,
    projectName: projectNameForMeta(meta),
    provider: "copilot",
    model: lastModel ?? meta.headerModelName ?? undefined,
  };
}

export async function getActiveSessions(): Promise<ClaudeSession[]> {
  const sessions = await discoverSessions();
  const rows = await Promise.all(sessions.map(metaToSession));
  return rows.sort((a, b) => b.startedAt - a.startedAt);
}

// ── Projects ────────────────────────────────────────────────────────────────

function projectKeyFor(meta: CopilotSessionMeta): string {
  if (meta.folder) return meta.folder;
  if (meta.workspaceHash === "__empty__") return "__empty__";
  return `__hash__:${meta.workspaceHash}`;
}

function projectLabelFor(key: string): string {
  if (key === "__empty__") return "Copilot (no folder)";
  if (key.startsWith("__hash__:")) {
    return `Copilot ${key.slice("__hash__:".length).slice(0, 6)}`;
  }
  return projectNameFromPath(key) || key;
}

function projectIdFor(key: string): string {
  return `copilot-${Buffer.from(key).toString("base64url")}`;
}

function projectKeyFromId(id: string): string | null {
  if (!id.startsWith("copilot-")) return null;
  const encoded = id.slice("copilot-".length);
  try {
    return Buffer.from(encoded, "base64url").toString("utf-8");
  } catch {
    return null;
  }
}

async function statesForMany(
  sessions: CopilotSessionMeta[]
): Promise<ParsedSessionState[]> {
  return Promise.all(sessions.map((s) => parsedStateForSession(s)));
}

export async function getProjects(): Promise<ProjectSummary[]> {
  const sessions = await discoverSessions();
  if (sessions.length === 0) return [];

  const byKey = new Map<string, CopilotSessionMeta[]>();
  for (const m of sessions) {
    const k = projectKeyFor(m);
    const list = byKey.get(k) ?? [];
    list.push(m);
    byKey.set(k, list);
  }

  const summaries: ProjectSummary[] = [];
  for (const [key, items] of byKey.entries()) {
    const states = await statesForMany(items);
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
      const state = states[i];
      totalTokens = addTokens(totalTokens, sumTokens(state.requests));
      const c = costFromRequests(state.requests);
      projectCost = {
        inputCost: 0,
        outputCost: 0,
        cacheWriteCost: 0,
        cacheReadCost: 0,
        totalCost: projectCost.totalCost + c.totalCost,
      };
      const startedAt = meta.creationDateMs ?? meta.mtimeMs;
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
      provider: "copilot",
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

  const sorted = [...items].sort(
    (a, b) => (a.creationDateMs ?? a.mtimeMs) - (b.creationDateMs ?? b.mtimeMs)
  );

  const states = await statesForMany(sorted);

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
    const state = states[i];
    const tokens = sumTokens(state.requests);
    totalTokens = addTokens(totalTokens, tokens);
    cumulativeInput += tokens.input_tokens;
    cumulativeOutput += tokens.output_tokens;
    const sessionCost = costFromRequests(state.requests);
    projectCost = {
      inputCost: 0,
      outputCost: 0,
      cacheWriteCost: 0,
      cacheReadCost: 0,
      totalCost: projectCost.totalCost + sessionCost.totalCost,
    };

    const startedAt = meta.creationDateMs ?? meta.mtimeMs;
    const updated = meta.mtimeMs || startedAt;
    if (updated > lastActivity) lastActivity = updated;

    sessionRows.push({
      sessionId: meta.sessionId,
      messageCount: state.requests.length,
      totalTokens: tokens,
      firstMessage: new Date(startedAt || Date.now()).toISOString(),
      lastMessage: new Date(updated || Date.now()).toISOString(),
    });

    tokenTimeSeries.push({
      timestamp: new Date(startedAt || Date.now()).toISOString(),
      ...tokens,
      cumulative_input: cumulativeInput,
      cumulative_output: cumulativeOutput,
      provider: "copilot",
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

// ── Session History ─────────────────────────────────────────────────────────

export async function getSessionHistory(): Promise<SessionHistory[]> {
  const sessions = await discoverSessions();
  if (sessions.length === 0) return [];

  const states = await statesForMany(sessions);

  const history: SessionHistory[] = sessions.map((meta, idx) => {
    const state = states[idx];
    const tokens = sumTokens(state.requests);
    const { status } = statusFromCopilotState(state, meta.mtimeMs);
    const startedAt = meta.creationDateMs ?? meta.mtimeMs;
    return {
      sessionId: meta.sessionId,
      projectName: projectNameForMeta(meta),
      cwd: meta.folder ?? "",
      startedAt: Number.isFinite(startedAt) ? startedAt : 0,
      endedAt: undefined,
      entrypoint: entrypointForAgentId(state.lastAgentId),
      totalTokens: tokens,
      cost: costFromRequests(state.requests),
      messageCount: state.requests.length,
      status,
      provider: "copilot" as const,
    };
  });

  return history.sort((a, b) => b.startedAt - a.startedAt);
}

// ── Daily token usage ───────────────────────────────────────────────────────

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
      provider: "copilot",
    });
  }
  return result;
}

export async function getDailyTokenUsage(days = 30): Promise<DailyTokenUsage[]> {
  const sessions = await discoverSessions();
  if (sessions.length === 0) return fillEmptyDays(days);

  const cutoff = Date.now() - days * 86_400_000;
  const relevant = sessions.filter((m) => {
    const t = m.creationDateMs ?? m.mtimeMs;
    return Number.isFinite(t) && t >= cutoff;
  });

  const states = await statesForMany(relevant);

  const byDay = new Map<string, TokenUsage>();
  const costByDay = new Map<string, number>();
  const sessionsByDay = new Map<string, number>();

  for (let i = 0; i < relevant.length; i++) {
    const meta = relevant[i];
    const state = states[i];
    const startedAt = meta.creationDateMs ?? meta.mtimeMs;
    const dateStr = formatLocalDate(new Date(startedAt));
    const tokens = sumTokens(state.requests);
    byDay.set(
      dateStr,
      addTokens(byDay.get(dateStr) ?? emptyTokenUsage(), tokens)
    );
    const cost = costFromRequests(state.requests).totalCost;
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
      provider: "copilot",
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
    provider: "copilot" as const,
  }));
}

// ── Search ──────────────────────────────────────────────────────────────────

export async function searchAll(query: string): Promise<SearchResult[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const sessions = await discoverSessions();
  const results: SearchResult[] = [];
  for (const meta of sessions) {
    const haystack = [
      meta.folder ?? "",
      meta.headerModelName ?? "",
      meta.sessionId,
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(q)) continue;
    results.push({
      type: "session",
      title: projectNameForMeta(meta),
      subtitle: meta.folder || "Copilot session",
      href: `/sessions?id=${meta.sessionId}`,
    });
    if (results.length >= 20) break;
  }
  return results;
}

// ── Conversation preview ────────────────────────────────────────────────────

export async function findSessionJsonl(
  sessionId: string
): Promise<string | null> {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) return null;
  const sessions = await discoverSessions();
  const match = sessions.find((m) => m.sessionId === sessionId);
  return match?.eventsPath ?? null;
}

export function findSessionJsonlSync(sessionId: string): string | null {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) return null;
  // Synchronous probe used by route handlers — we walk both roots directly
  // rather than waiting for the async manifest cache.
  if (fs.existsSync(COPILOT_ROOT_WORKSPACE)) {
    try {
      const hashes = fs.readdirSync(COPILOT_ROOT_WORKSPACE);
      for (const hash of hashes) {
        if (!/^[a-zA-Z0-9_-]+$/.test(hash)) continue;
        const p = path.join(
          COPILOT_ROOT_WORKSPACE,
          hash,
          "chatSessions",
          `${sessionId}.jsonl`
        );
        if (
          isWithinDir(p, COPILOT_ROOT_WORKSPACE) &&
          fs.existsSync(p)
        ) {
          return p;
        }
      }
    } catch {
      // ignore
    }
  }
  if (fs.existsSync(COPILOT_ROOT_EMPTY)) {
    const p = path.join(COPILOT_ROOT_EMPTY, `${sessionId}.json`);
    if (isWithinDir(p, COPILOT_ROOT_EMPTY) && fs.existsSync(p)) return p;
  }
  return null;
}

export async function getConversationPreview(
  sessionId: string,
  maxMessages = 20
): Promise<ConversationMessage[]> {
  const filePath = await findSessionJsonl(sessionId);
  if (!filePath) return [];

  const sessions = await discoverSessions();
  const meta = sessions.find((m) => m.sessionId === sessionId);
  if (!meta) return [];

  try {
    if (meta.isSnapshot) {
      // Snapshot files don't carry user-facing message text consistently;
      // best-effort: pull `inputText` plus any request `message` fields.
      const raw = await fs.promises.readFile(filePath, "utf-8");
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const out: ConversationMessage[] = [];
      const reqs = obj.requests;
      if (Array.isArray(reqs)) {
        for (const r of reqs as Record<string, unknown>[]) {
          const msg = (r.message ?? {}) as Record<string, unknown>;
          const text = typeof msg.text === "string" ? msg.text : "";
          if (text.trim()) {
            out.push({
              role: "user",
              text: text.slice(0, 500),
              timestamp: new Date(meta.creationDateMs ?? meta.mtimeMs).toISOString(),
            });
          }
        }
      }
      return out.slice(-maxMessages);
    }

    const lines = await readLastLines(filePath, maxMessages * 30);
    const out: ConversationMessage[] = [];

    for (const line of lines) {
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (entry.kind !== 1) continue;
      const k = entry.k;
      if (!Array.isArray(k) || k[0] !== "requests") continue;
      // Match writes of the user-typed `message` payload, or whole-slot
      // writes carrying a `message` sub-field.
      const v = entry.v as Record<string, unknown> | null | undefined;
      if (!v) continue;
      if (k.length >= 3 && k[2] === "message") {
        const text = typeof v.text === "string" ? v.text : "";
        if (text.trim()) {
          out.push({
            role: "user",
            text: text.slice(0, 500),
            timestamp: new Date(meta.mtimeMs).toISOString(),
          });
        }
        continue;
      }
      if (k.length === 2 && v.message) {
        const msg = v.message as Record<string, unknown>;
        const text = typeof msg.text === "string" ? msg.text : "";
        if (text.trim()) {
          out.push({
            role: "user",
            text: text.slice(0, 500),
            timestamp: new Date(meta.mtimeMs).toISOString(),
          });
        }
      }
      if (k.length >= 3 && k[2] === "response") {
        // Response writes can carry an array of {value: string} segments.
        if (Array.isArray(v)) {
          const text = (v as Array<Record<string, unknown>>)
            .map((p) => (typeof p.value === "string" ? p.value : ""))
            .join("");
          if (text.trim()) {
            out.push({
              role: "assistant",
              text: text.slice(0, 500),
              timestamp: new Date(meta.mtimeMs).toISOString(),
            });
          }
        }
      }
    }

    return out.slice(-maxMessages);
  } catch {
    return [];
  }
}

export async function getSessionErrors(sessionId: string): Promise<string[]> {
  const filePath = await findSessionJsonl(sessionId);
  if (!filePath) return [];

  const sessions = await discoverSessions();
  const meta = sessions.find((m) => m.sessionId === sessionId);
  if (!meta) return [];

  const state = await parsedStateForSession(meta);
  const errors: string[] = [];
  for (const r of state.requests) {
    if (r.hadError) {
      errors.push(`Request error (model=${r.model ?? "unknown"})`);
    }
  }
  return errors;
}

export async function readConversationLines(
  filePath: string,
  n: number
): Promise<string[]> {
  return readLastLines(filePath, n);
}

// ── Overview ────────────────────────────────────────────────────────────────

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

// ── Scheduled tasks / plugins ───────────────────────────────────────────────

export async function getScheduledTasks(): Promise<ScheduledTask[]> {
  return [];
}

export async function getInstalledPlugins(): Promise<InstalledPlugin[]> {
  return [];
}

// ── System Status ──────────────────────────────────────────────────────────

export async function getCopilotProviderStatus(): Promise<ProviderStatus> {
  // VS Code's Copilot Chat extension version isn't exposed via filesystem
  // alongside transcripts. We label it descriptively rather than guess.
  const installed = rootExists();
  const cliVersion = installed
    ? "Copilot Chat (VS Code)"
    : "not installed";

  // Best-effort GitHub status check — Copilot piggybacks on GitHub services.
  let apiStatus: "operational" | "degraded" | "unknown" = "unknown";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(
      "https://www.githubstatus.com/api/v2/status.json",
      { signal: controller.signal }
    );
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
