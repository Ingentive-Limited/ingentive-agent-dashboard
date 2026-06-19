/**
 * Provider routing layer.
 *
 * The UI exposes five top-level provider filters: "all" / "claude" / "codex" /
 * "scout" / "copilot". Cowork sessions are part of the Claude family (both
 * Anthropic-backed), so the "claude" filter fans out to TWO data sources:
 * `claude-data.ts` (Claude Code) and `cowork-data.ts` (Claude Desktop local
 * agent). Scout and Copilot each have their own top-level filter — Scout is
 * the Microsoft Scout Electron CLI wrapper, Copilot is VS Code's Copilot
 * Chat extension. They live in totally disjoint filesystem paths and are
 * never folded into one another (no double-counting risk).
 *
 * The "all" filter fans out across all five sources.
 *
 * Each session still carries its own `session.provider` value internally,
 * which drives per-session behavior (entrypoint label, conversation viewer
 * parser choice, whether "open in terminal" is allowed).
 */
import * as claude from "./claude-data";
import * as codex from "./codex-data";
import * as cowork from "./cowork-data";
import * as scout from "./scout-data";
import * as copilot from "./copilot-data";
import { addTokens } from "./utils-server";
// Side-effect import: kicks off a background scan of all five providers'
// data sources on first module load, so the first user request hits warm
// per-file caches instead of paying the ~60s cold-parse cost.
import "./startup-warmup";
import type {
  ClaudeSession,
  ProjectSummary,
  ProjectDetail,
  ScheduledTask,
  DashboardOverview,
  SessionHistory,
  ConversationMessage,
  SearchResult,
  DailyTokenUsage,
  ProjectStats,
  InstalledPlugin,
  SystemStatus,
  TokenUsage,
  CostEstimate,
} from "./types";

export type ProviderFilter = "claude" | "codex" | "scout" | "copilot" | "all";

function parseProvider(value: string | null | undefined): ProviderFilter {
  if (
    value === "claude" ||
    value === "codex" ||
    value === "scout" ||
    value === "copilot"
  ) {
    return value;
  }
  return "all";
}

export { parseProvider };

// ── Sessions ─────────────────────────────────────────────────────────────────

export async function getActiveSessions(provider?: ProviderFilter): Promise<ClaudeSession[]> {
  const p = provider ?? "all";
  if (p === "codex") return codex.getActiveSessions();
  if (p === "scout") return scout.getActiveSessions();
  if (p === "copilot") return copilot.getActiveSessions();
  if (p === "claude") {
    // Claude family = Claude Code (CLI/Desktop) + Cowork. Scout and Copilot
    // are their own top-level filters, so they're NOT included here.
    const [c, w] = await Promise.all([
      claude.getActiveSessions(),
      cowork.getActiveSessions(),
    ]);
    return [...c, ...w].sort((a, b) => b.startedAt - a.startedAt);
  }
  const [c, x, w, s, cp] = await Promise.all([
    claude.getActiveSessions(),
    codex.getActiveSessions(),
    cowork.getActiveSessions(),
    scout.getActiveSessions(),
    copilot.getActiveSessions(),
  ]);
  return [...c, ...x, ...w, ...s, ...cp].sort((a, b) => b.startedAt - a.startedAt);
}

// ── Projects ─────────────────────────────────────────────────────────────────

export async function getProjects(provider?: ProviderFilter): Promise<ProjectSummary[]> {
  const p = provider ?? "all";
  if (p === "codex") return codex.getProjects();
  if (p === "scout") return scout.getProjects();
  if (p === "copilot") return copilot.getProjects();
  if (p === "claude") {
    const [c, w] = await Promise.all([
      claude.getProjects(),
      cowork.getProjects(),
    ]);
    return [...c, ...w].sort(
      (a, b) =>
        new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
    );
  }
  const [c, x, w, s, cp] = await Promise.all([
    claude.getProjects(),
    codex.getProjects(),
    cowork.getProjects(),
    scout.getProjects(),
    copilot.getProjects(),
  ]);
  return [...c, ...x, ...w, ...s, ...cp].sort(
    (a, b) =>
      new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
  );
}

export async function getProjectDetail(
  projectId: string,
  provider?: ProviderFilter
): Promise<ProjectDetail | null> {
  // Cowork, Scout, and Copilot project IDs are distinctively prefixed, so we
  // route on the ID shape regardless of the provider filter.
  if (projectId.startsWith("cowork-")) return cowork.getProjectDetail(projectId);
  if (projectId.startsWith("scout-")) return scout.getProjectDetail(projectId);
  if (projectId.startsWith("copilot-")) return copilot.getProjectDetail(projectId);

  const p = provider ?? "all";
  if (p === "codex") return codex.getProjectDetail(projectId);
  if (p === "scout") return scout.getProjectDetail(projectId);
  if (p === "copilot") return copilot.getProjectDetail(projectId);
  if (p === "claude") return claude.getProjectDetail(projectId);
  // "all": try Claude then Codex (Cowork/Scout/Copilot were already handled above)
  const result = await claude.getProjectDetail(projectId);
  if (result) return result;
  return codex.getProjectDetail(projectId);
}

// ── Session History ──────────────────────────────────────────────────────────

export async function getSessionHistory(provider?: ProviderFilter): Promise<SessionHistory[]> {
  const p = provider ?? "all";
  if (p === "codex") return codex.getSessionHistory();
  if (p === "scout") return scout.getSessionHistory();
  if (p === "copilot") return copilot.getSessionHistory();
  if (p === "claude") {
    const [c, w] = await Promise.all([
      claude.getSessionHistory(),
      cowork.getSessionHistory(),
    ]);
    return [...c, ...w].sort((a, b) => b.startedAt - a.startedAt);
  }
  const [c, x, w, s, cp] = await Promise.all([
    claude.getSessionHistory(),
    codex.getSessionHistory(),
    cowork.getSessionHistory(),
    scout.getSessionHistory(),
    copilot.getSessionHistory(),
  ]);
  return [...c, ...x, ...w, ...s, ...cp].sort((a, b) => b.startedAt - a.startedAt);
}

// ── Token Usage ──────────────────────────────────────────────────────────────

/**
 * Concatenate per-provider daily-usage lists WITHOUT summing across
 * providers — every row carries its `provider` tag so the UI can split or
 * aggregate as it sees fit. Cowork sessions can have gigabytes of
 * `cache_read_input_tokens`, which used to drown out Claude Code numbers
 * when we merged per-date; preserving the split lets the UI render Cowork
 * separately. Rows are sorted by date for downstream chart compatibility.
 */
function concatDailyUsage(...lists: DailyTokenUsage[][]): DailyTokenUsage[] {
  const out: DailyTokenUsage[] = [];
  for (const list of lists) out.push(...list);
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export async function getDailyTokenUsage(
  days?: number,
  provider?: ProviderFilter
): Promise<DailyTokenUsage[]> {
  const p = provider ?? "all";
  if (p === "codex") return codex.getDailyTokenUsage(days);
  if (p === "scout") return scout.getDailyTokenUsage(days);
  if (p === "copilot") return copilot.getDailyTokenUsage(days);
  if (p === "claude") {
    const [c, w] = await Promise.all([
      claude.getDailyTokenUsage(days),
      cowork.getDailyTokenUsage(days),
    ]);
    return concatDailyUsage(c, w);
  }
  const [c, x, w, s, cp] = await Promise.all([
    claude.getDailyTokenUsage(days),
    codex.getDailyTokenUsage(days),
    cowork.getDailyTokenUsage(days),
    scout.getDailyTokenUsage(days),
    copilot.getDailyTokenUsage(days),
  ]);
  return concatDailyUsage(c, x, w, s, cp);
}

export async function getProjectStats(provider?: ProviderFilter): Promise<ProjectStats[]> {
  const p = provider ?? "all";
  if (p === "codex") return codex.getProjectStats();
  if (p === "scout") return scout.getProjectStats();
  if (p === "copilot") return copilot.getProjectStats();
  if (p === "claude") {
    const [c, w] = await Promise.all([
      claude.getProjectStats(),
      cowork.getProjectStats(),
    ]);
    return [...c, ...w].sort(
      (a, b) =>
        new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
    );
  }
  const [c, x, w, s, cp] = await Promise.all([
    claude.getProjectStats(),
    codex.getProjectStats(),
    cowork.getProjectStats(),
    scout.getProjectStats(),
    copilot.getProjectStats(),
  ]);
  return [...c, ...x, ...w, ...s, ...cp].sort(
    (a, b) =>
      new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
  );
}

// ── Search ───────────────────────────────────────────────────────────────────

export async function searchAll(query: string, provider?: ProviderFilter): Promise<SearchResult[]> {
  const p = provider ?? "all";
  if (p === "codex") return codex.searchAll(query);
  if (p === "scout") return scout.searchAll(query);
  if (p === "copilot") return copilot.searchAll(query);
  if (p === "claude") {
    const [c, w] = await Promise.all([
      claude.searchAll(query),
      cowork.searchAll(query),
    ]);
    return [...c, ...w].slice(0, 20);
  }
  const [c, x, w, s, cp] = await Promise.all([
    claude.searchAll(query),
    codex.searchAll(query),
    cowork.searchAll(query),
    scout.searchAll(query),
    copilot.searchAll(query),
  ]);
  return [...c, ...x, ...w, ...s, ...cp].slice(0, 20);
}

// ── Conversation ─────────────────────────────────────────────────────────────
//
// The conversation-viewer passes the session's actual provider value
// ("claude" / "codex" / "cowork" / "scout" / "copilot") as a query param, so
// this routing layer also accepts those broader values here — they're session-
// level concerns, not UI filters.

export type ConversationProviderFilter = ProviderFilter | "cowork";

export function findSessionJsonl(
  sessionId: string,
  provider?: ConversationProviderFilter
): string | null {
  const p = provider ?? "all";
  if (p === "codex") return codex.findSessionJsonl(sessionId);
  if (p === "cowork") return cowork.findSessionJsonlSync(sessionId);
  if (p === "scout") return scout.findSessionJsonlSync(sessionId);
  if (p === "copilot") return copilot.findSessionJsonlSync(sessionId);
  if (p === "claude") {
    return (
      claude.findSessionJsonl(sessionId) ||
      cowork.findSessionJsonlSync(sessionId) ||
      scout.findSessionJsonlSync(sessionId) ||
      copilot.findSessionJsonlSync(sessionId)
    );
  }
  return (
    claude.findSessionJsonl(sessionId) ||
    codex.findSessionJsonl(sessionId) ||
    cowork.findSessionJsonlSync(sessionId) ||
    scout.findSessionJsonlSync(sessionId) ||
    copilot.findSessionJsonlSync(sessionId)
  );
}

export async function readConversationLines(
  filePath: string,
  n: number
): Promise<string[]> {
  // Provider-agnostic — just reads lines from a file.
  return claude.readConversationLines(filePath, n);
}

export async function getConversationPreview(
  sessionId: string,
  maxMessages?: number,
  provider?: ConversationProviderFilter
): Promise<ConversationMessage[]> {
  const p = provider ?? "all";
  if (p === "codex") return codex.getConversationPreview(sessionId, maxMessages);
  if (p === "cowork") return cowork.getConversationPreview(sessionId, maxMessages);
  if (p === "scout") return scout.getConversationPreview(sessionId, maxMessages);
  if (p === "copilot") return copilot.getConversationPreview(sessionId, maxMessages);
  if (p === "claude") {
    const result = await claude.getConversationPreview(sessionId, maxMessages);
    if (result.length > 0) return result;
    const coworkResult = await cowork.getConversationPreview(sessionId, maxMessages);
    if (coworkResult.length > 0) return coworkResult;
    return scout.getConversationPreview(sessionId, maxMessages);
  }
  const result = await claude.getConversationPreview(sessionId, maxMessages);
  if (result.length > 0) return result;
  const codexResult = await codex.getConversationPreview(sessionId, maxMessages);
  if (codexResult.length > 0) return codexResult;
  const coworkResult = await cowork.getConversationPreview(sessionId, maxMessages);
  if (coworkResult.length > 0) return coworkResult;
  const scoutResult = await scout.getConversationPreview(sessionId, maxMessages);
  if (scoutResult.length > 0) return scoutResult;
  return copilot.getConversationPreview(sessionId, maxMessages);
}

export async function getSessionErrors(
  sessionId: string,
  provider?: ConversationProviderFilter
): Promise<string[]> {
  const p = provider ?? "all";
  if (p === "codex") return codex.getSessionErrors(sessionId);
  if (p === "cowork") return cowork.getSessionErrors(sessionId);
  if (p === "scout") return scout.getSessionErrors(sessionId);
  if (p === "copilot") return copilot.getSessionErrors(sessionId);
  if (p === "claude") {
    const result = await claude.getSessionErrors(sessionId);
    if (result.length > 0) return result;
    const coworkResult = await cowork.getSessionErrors(sessionId);
    if (coworkResult.length > 0) return coworkResult;
    return scout.getSessionErrors(sessionId);
  }
  const result = await claude.getSessionErrors(sessionId);
  if (result.length > 0) return result;
  const codexResult = await codex.getSessionErrors(sessionId);
  if (codexResult.length > 0) return codexResult;
  const coworkResult = await cowork.getSessionErrors(sessionId);
  if (coworkResult.length > 0) return coworkResult;
  const scoutResult = await scout.getSessionErrors(sessionId);
  if (scoutResult.length > 0) return scoutResult;
  return copilot.getSessionErrors(sessionId);
}

// ── Scheduled Tasks ──────────────────────────────────────────────────────────

export async function getScheduledTasks(provider?: ProviderFilter): Promise<ScheduledTask[]> {
  const p = provider ?? "all";
  // Cowork inherits the Claude scheduled-tasks store, so we don't double-add
  // cowork tasks under the Claude filter. Scout and Copilot have no
  // scheduling concept.
  if (p === "codex") return codex.getScheduledTasks();
  if (p === "scout") return [];
  if (p === "copilot") return [];
  if (p === "claude") return claude.getScheduledTasks();
  const [c, x] = await Promise.all([
    claude.getScheduledTasks(),
    codex.getScheduledTasks(),
  ]);
  return [...c, ...x];
}

// ── Plugins ──────────────────────────────────────────────────────────────────

export async function getInstalledPlugins(provider?: ProviderFilter): Promise<InstalledPlugin[]> {
  const p = provider ?? "all";
  // Same as scheduled tasks: Cowork uses Claude's plugin set, so no duplication.
  // Scout has its own (separate) ecosystem of MCP servers; Copilot's
  // extensions aren't enumerated through the dashboard surface today.
  if (p === "codex") return codex.getInstalledPlugins();
  if (p === "scout") return [];
  if (p === "copilot") return [];
  if (p === "claude") return claude.getInstalledPlugins();
  const [c, x] = await Promise.all([
    claude.getInstalledPlugins(),
    codex.getInstalledPlugins(),
  ]);
  return [...c, ...x].sort((a, b) => a.name.localeCompare(b.name));
}

// ── Overview ─────────────────────────────────────────────────────────────────

function addCost(a: CostEstimate, b: CostEstimate): CostEstimate {
  return {
    inputCost: a.inputCost + b.inputCost,
    outputCost: a.outputCost + b.outputCost,
    cacheWriteCost: a.cacheWriteCost + b.cacheWriteCost,
    cacheReadCost: a.cacheReadCost + b.cacheReadCost,
    totalCost: a.totalCost + b.totalCost,
  };
}

function mergeOverviews(...parts: DashboardOverview[]): DashboardOverview {
  let totalTokensToday: TokenUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  let totalTokensMonth = { ...totalTokensToday };
  let totalCost: CostEstimate = {
    inputCost: 0,
    outputCost: 0,
    cacheWriteCost: 0,
    cacheReadCost: 0,
    totalCost: 0,
  };
  let activeSessions = 0;
  let awaitingInput = 0;
  let activeProjects = 0;
  let scheduledTasks = 0;
  const recentSessions: ClaudeSession[] = [];
  const tokenTimeSeries = [];

  for (const part of parts) {
    activeSessions += part.activeSessions;
    awaitingInput += part.awaitingInput;
    totalTokensToday = addTokens(totalTokensToday, part.totalTokensToday);
    totalTokensMonth = addTokens(totalTokensMonth, part.totalTokensMonth);
    totalCost = addCost(totalCost, part.totalCost);
    activeProjects += part.activeProjects;
    scheduledTasks += part.scheduledTasks;
    recentSessions.push(...part.recentSessions);
    tokenTimeSeries.push(...part.tokenTimeSeries);
  }

  return {
    activeSessions,
    awaitingInput,
    totalTokensToday,
    totalTokensMonth,
    totalCost,
    activeProjects,
    scheduledTasks,
    recentSessions: recentSessions
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 5),
    tokenTimeSeries: tokenTimeSeries.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    ),
  };
}

export async function getOverview(provider?: ProviderFilter): Promise<DashboardOverview> {
  const p = provider ?? "all";
  if (p === "codex") return codex.getOverview();
  if (p === "scout") return scout.getOverview();
  if (p === "copilot") return copilot.getOverview();
  if (p === "claude") {
    const [c, w] = await Promise.all([
      claude.getOverview(),
      cowork.getOverview(),
    ]);
    return mergeOverviews(c, w);
  }
  const [c, x, w, s, cp] = await Promise.all([
    claude.getOverview(),
    codex.getOverview(),
    cowork.getOverview(),
    scout.getOverview(),
    copilot.getOverview(),
  ]);
  return mergeOverviews(c, x, w, s, cp);
}

// ── System Status ────────────────────────────────────────────────────────────

export async function getSystemStatus(provider?: ProviderFilter): Promise<SystemStatus> {
  const p = provider ?? "all";
  if (p === "codex") return codex.getSystemStatus();

  if (p === "scout") {
    const [s, scoutSessions] = await Promise.all([
      scout.getScoutProviderStatus(),
      scout.getActiveSessions(),
    ]);
    return {
      scout: s,
      activeSessions: scoutSessions.filter((sess) => sess.isAlive).length,
    };
  }

  if (p === "copilot") {
    const [c, copilotSessions] = await Promise.all([
      copilot.getCopilotProviderStatus(),
      copilot.getActiveSessions(),
    ]);
    return {
      copilot: c,
      activeSessions: copilotSessions.filter((sess) => sess.isAlive).length,
    };
  }

  if (p === "claude") {
    // Claude row covers Claude Code + Cowork (both Anthropic). Scout and
    // Copilot have their own top-level filters and their own status rows —
    // don't roll them in here.
    const [c, claudeSessions, coworkSessions] = await Promise.all([
      claude.getClaudeProviderStatus(),
      claude.getActiveSessions(),
      cowork.getActiveSessions(),
    ]);
    return {
      claude: c,
      activeSessions:
        claudeSessions.filter((s) => s.isAlive).length +
        coworkSessions.filter((s) => s.isAlive).length,
    };
  }

  // all
  const [
    c,
    x,
    s,
    cp,
    claudeSessions,
    codexSessions,
    coworkSessions,
    scoutSessions,
    copilotSessions,
  ] = await Promise.all([
    claude.getClaudeProviderStatus(),
    codex.getCodexProviderStatus(),
    scout.getScoutProviderStatus(),
    copilot.getCopilotProviderStatus(),
    claude.getActiveSessions(),
    codex.getActiveSessions(),
    cowork.getActiveSessions(),
    scout.getActiveSessions(),
    copilot.getActiveSessions(),
  ]);
  return {
    claude: c,
    codex: x,
    scout: s,
    copilot: cp,
    activeSessions:
      claudeSessions.filter((sess) => sess.isAlive).length +
      codexSessions.filter((sess) => sess.isAlive).length +
      coworkSessions.filter((sess) => sess.isAlive).length +
      scoutSessions.filter((sess) => sess.isAlive).length +
      copilotSessions.filter((sess) => sess.isAlive).length,
  };
}
