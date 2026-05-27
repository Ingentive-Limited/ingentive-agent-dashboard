/**
 * Provider routing layer.
 *
 * The UI exposes three top-level provider filters: "all" / "claude" / "codex".
 * Cowork sessions are part of the Claude family (both Anthropic), so the
 * "claude" filter fans out to BOTH `claude-data.ts` (Claude Code) and
 * `cowork-data.ts` (Claude Desktop local-agent sessions). The "all" filter
 * adds Codex on top.
 *
 * Each session still carries its own `session.provider` value internally,
 * which drives per-session behavior (entrypoint label, conversation viewer
 * parser choice, whether "open in terminal" is allowed).
 */
import * as claude from "./claude-data";
import * as codex from "./codex-data";
import * as cowork from "./cowork-data";
import { addTokens } from "./utils-server";
// Side-effect import: kicks off a background scan of all three providers'
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

export type ProviderFilter = "claude" | "codex" | "all";

function parseProvider(value: string | null | undefined): ProviderFilter {
  if (value === "claude" || value === "codex") return value;
  return "all";
}

export { parseProvider };

// ── Sessions ─────────────────────────────────────────────────────────────────

export async function getActiveSessions(provider?: ProviderFilter): Promise<ClaudeSession[]> {
  const p = provider ?? "all";
  if (p === "codex") return codex.getActiveSessions();
  if (p === "claude") {
    const [c, w] = await Promise.all([
      claude.getActiveSessions(),
      cowork.getActiveSessions(),
    ]);
    return [...c, ...w].sort((a, b) => b.startedAt - a.startedAt);
  }
  const [c, x, w] = await Promise.all([
    claude.getActiveSessions(),
    codex.getActiveSessions(),
    cowork.getActiveSessions(),
  ]);
  return [...c, ...x, ...w].sort((a, b) => b.startedAt - a.startedAt);
}

// ── Projects ─────────────────────────────────────────────────────────────────

export async function getProjects(provider?: ProviderFilter): Promise<ProjectSummary[]> {
  const p = provider ?? "all";
  if (p === "codex") return codex.getProjects();
  if (p === "claude") {
    const [c, w] = await Promise.all([claude.getProjects(), cowork.getProjects()]);
    return [...c, ...w].sort(
      (a, b) =>
        new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
    );
  }
  const [c, x, w] = await Promise.all([
    claude.getProjects(),
    codex.getProjects(),
    cowork.getProjects(),
  ]);
  return [...c, ...x, ...w].sort(
    (a, b) =>
      new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
  );
}

export async function getProjectDetail(
  projectId: string,
  provider?: ProviderFilter
): Promise<ProjectDetail | null> {
  // Cowork project IDs are distinctive ("cowork-<workspaceUuid>"), so we can
  // route on the ID shape regardless of the provider filter.
  if (projectId.startsWith("cowork-")) return cowork.getProjectDetail(projectId);

  const p = provider ?? "all";
  if (p === "codex") return codex.getProjectDetail(projectId);
  if (p === "claude") return claude.getProjectDetail(projectId);
  // "all": try Claude then Codex (Cowork was already handled by the prefix check)
  const result = await claude.getProjectDetail(projectId);
  if (result) return result;
  return codex.getProjectDetail(projectId);
}

// ── Session History ──────────────────────────────────────────────────────────

export async function getSessionHistory(provider?: ProviderFilter): Promise<SessionHistory[]> {
  const p = provider ?? "all";
  if (p === "codex") return codex.getSessionHistory();
  if (p === "claude") {
    const [c, w] = await Promise.all([
      claude.getSessionHistory(),
      cowork.getSessionHistory(),
    ]);
    return [...c, ...w].sort((a, b) => b.startedAt - a.startedAt);
  }
  const [c, x, w] = await Promise.all([
    claude.getSessionHistory(),
    codex.getSessionHistory(),
    cowork.getSessionHistory(),
  ]);
  return [...c, ...x, ...w].sort((a, b) => b.startedAt - a.startedAt);
}

// ── Token Usage ──────────────────────────────────────────────────────────────

function mergeDailyUsage(...lists: DailyTokenUsage[][]): DailyTokenUsage[] {
  const map = new Map<string, DailyTokenUsage>();
  for (const list of lists) {
    for (const entry of list) {
      const existing = map.get(entry.date);
      if (existing) {
        existing.input_tokens += entry.input_tokens;
        existing.output_tokens += entry.output_tokens;
        existing.cache_creation_input_tokens += entry.cache_creation_input_tokens;
        existing.cache_read_input_tokens += entry.cache_read_input_tokens;
        existing.totalCost += entry.totalCost;
        existing.sessionCount += entry.sessionCount;
      } else {
        map.set(entry.date, { ...entry });
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export async function getDailyTokenUsage(
  days?: number,
  provider?: ProviderFilter
): Promise<DailyTokenUsage[]> {
  const p = provider ?? "all";
  if (p === "codex") return codex.getDailyTokenUsage(days);
  if (p === "claude") {
    const [c, w] = await Promise.all([
      claude.getDailyTokenUsage(days),
      cowork.getDailyTokenUsage(days),
    ]);
    return mergeDailyUsage(c, w);
  }
  const [c, x, w] = await Promise.all([
    claude.getDailyTokenUsage(days),
    codex.getDailyTokenUsage(days),
    cowork.getDailyTokenUsage(days),
  ]);
  return mergeDailyUsage(c, x, w);
}

export async function getProjectStats(provider?: ProviderFilter): Promise<ProjectStats[]> {
  const p = provider ?? "all";
  if (p === "codex") return codex.getProjectStats();
  if (p === "claude") {
    const [c, w] = await Promise.all([claude.getProjectStats(), cowork.getProjectStats()]);
    return [...c, ...w].sort(
      (a, b) =>
        new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
    );
  }
  const [c, x, w] = await Promise.all([
    claude.getProjectStats(),
    codex.getProjectStats(),
    cowork.getProjectStats(),
  ]);
  return [...c, ...x, ...w].sort(
    (a, b) =>
      new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
  );
}

// ── Search ───────────────────────────────────────────────────────────────────

export async function searchAll(query: string, provider?: ProviderFilter): Promise<SearchResult[]> {
  const p = provider ?? "all";
  if (p === "codex") return codex.searchAll(query);
  if (p === "claude") {
    const [c, w] = await Promise.all([claude.searchAll(query), cowork.searchAll(query)]);
    return [...c, ...w].slice(0, 20);
  }
  const [c, x, w] = await Promise.all([
    claude.searchAll(query),
    codex.searchAll(query),
    cowork.searchAll(query),
  ]);
  return [...c, ...x, ...w].slice(0, 20);
}

// ── Conversation ─────────────────────────────────────────────────────────────
//
// The conversation-viewer passes the session's actual provider value
// ("claude" / "codex" / "cowork") as a query param, so this routing layer
// also accepts "cowork" here — it's a session-level concern, not a UI filter.
// We accept the broader value via a separate ConversationProviderFilter type.

export type ConversationProviderFilter = ProviderFilter | "cowork";

export function findSessionJsonl(
  sessionId: string,
  provider?: ConversationProviderFilter
): string | null {
  const p = provider ?? "all";
  if (p === "codex") return codex.findSessionJsonl(sessionId);
  if (p === "cowork") return cowork.findSessionJsonlSync(sessionId);
  if (p === "claude") {
    return (
      claude.findSessionJsonl(sessionId) || cowork.findSessionJsonlSync(sessionId)
    );
  }
  return (
    claude.findSessionJsonl(sessionId) ||
    codex.findSessionJsonl(sessionId) ||
    cowork.findSessionJsonlSync(sessionId)
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
  if (p === "claude") {
    const result = await claude.getConversationPreview(sessionId, maxMessages);
    if (result.length > 0) return result;
    return cowork.getConversationPreview(sessionId, maxMessages);
  }
  const result = await claude.getConversationPreview(sessionId, maxMessages);
  if (result.length > 0) return result;
  const codexResult = await codex.getConversationPreview(sessionId, maxMessages);
  if (codexResult.length > 0) return codexResult;
  return cowork.getConversationPreview(sessionId, maxMessages);
}

export async function getSessionErrors(
  sessionId: string,
  provider?: ConversationProviderFilter
): Promise<string[]> {
  const p = provider ?? "all";
  if (p === "codex") return codex.getSessionErrors(sessionId);
  if (p === "cowork") return cowork.getSessionErrors(sessionId);
  if (p === "claude") {
    const result = await claude.getSessionErrors(sessionId);
    if (result.length > 0) return result;
    return cowork.getSessionErrors(sessionId);
  }
  const result = await claude.getSessionErrors(sessionId);
  if (result.length > 0) return result;
  const codexResult = await codex.getSessionErrors(sessionId);
  if (codexResult.length > 0) return codexResult;
  return cowork.getSessionErrors(sessionId);
}

// ── Scheduled Tasks ──────────────────────────────────────────────────────────

export async function getScheduledTasks(provider?: ProviderFilter): Promise<ScheduledTask[]> {
  const p = provider ?? "all";
  // Cowork inherits the Claude scheduled-tasks store, so we don't double-add
  // cowork tasks under the Claude filter.
  if (p === "codex") return codex.getScheduledTasks();
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
  if (p === "codex") return codex.getInstalledPlugins();
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
  if (p === "claude") {
    const [c, w] = await Promise.all([claude.getOverview(), cowork.getOverview()]);
    return mergeOverviews(c, w);
  }
  const [c, x, w] = await Promise.all([
    claude.getOverview(),
    codex.getOverview(),
    cowork.getOverview(),
  ]);
  return mergeOverviews(c, x, w);
}

// ── System Status ────────────────────────────────────────────────────────────

export async function getSystemStatus(provider?: ProviderFilter): Promise<SystemStatus> {
  const p = provider ?? "all";
  if (p === "codex") return codex.getSystemStatus();

  if (p === "claude") {
    // Surface only the Claude status row. Cowork is grouped under Claude in
    // the UI; its API health is the same Anthropic status check, so there's
    // no information loss in collapsing the row.
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
  const [c, x, claudeSessions, codexSessions, coworkSessions] = await Promise.all([
    claude.getClaudeProviderStatus(),
    codex.getCodexProviderStatus(),
    claude.getActiveSessions(),
    codex.getActiveSessions(),
    cowork.getActiveSessions(),
  ]);
  return {
    claude: c,
    codex: x,
    activeSessions:
      claudeSessions.filter((s) => s.isAlive).length +
      codexSessions.filter((s) => s.isAlive).length +
      coworkSessions.filter((s) => s.isAlive).length,
  };
}
