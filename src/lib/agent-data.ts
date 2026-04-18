/**
 * Provider routing layer — delegates to claude-data or codex-data
 * based on the active provider selection.
 */
import * as claude from "./claude-data";
import * as codex from "./codex-data";
import { addTokens } from "./utils-server";
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
  if (p === "claude") return claude.getActiveSessions();
  if (p === "codex") return codex.getActiveSessions();
  const [c, x] = await Promise.all([claude.getActiveSessions(), codex.getActiveSessions()]);
  return [...c, ...x].sort((a, b) => b.startedAt - a.startedAt);
}

// ── Projects ─────────────────────────────────────────────────────────────────

export async function getProjects(provider?: ProviderFilter): Promise<ProjectSummary[]> {
  const p = provider ?? "all";
  if (p === "claude") return claude.getProjects();
  if (p === "codex") return codex.getProjects();
  const [c, x] = await Promise.all([claude.getProjects(), codex.getProjects()]);
  return [...c, ...x].sort((a, b) =>
    new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
  );
}

export async function getProjectDetail(
  projectId: string,
  provider?: ProviderFilter
): Promise<ProjectDetail | null> {
  const p = provider ?? "all";
  if (p === "claude") return claude.getProjectDetail(projectId);
  if (p === "codex") return codex.getProjectDetail(projectId);
  // Try Claude first, then Codex
  const result = await claude.getProjectDetail(projectId);
  if (result) return result;
  return codex.getProjectDetail(projectId);
}

// ── Session History ──────────────────────────────────────────────────────────

export async function getSessionHistory(provider?: ProviderFilter): Promise<SessionHistory[]> {
  const p = provider ?? "all";
  if (p === "claude") return claude.getSessionHistory();
  if (p === "codex") return codex.getSessionHistory();
  const [c, x] = await Promise.all([claude.getSessionHistory(), codex.getSessionHistory()]);
  return [...c, ...x].sort((a, b) => b.startedAt - a.startedAt);
}

// ── Token Usage ──────────────────────────────────────────────────────────────

export async function getDailyTokenUsage(
  days?: number,
  provider?: ProviderFilter
): Promise<DailyTokenUsage[]> {
  const p = provider ?? "all";
  if (p === "claude") return claude.getDailyTokenUsage(days);
  if (p === "codex") return codex.getDailyTokenUsage(days);
  const [c, x] = await Promise.all([
    claude.getDailyTokenUsage(days),
    codex.getDailyTokenUsage(days),
  ]);
  // Merge by date
  const map = new Map<string, DailyTokenUsage>();
  for (const entry of [...c, ...x]) {
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
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export async function getProjectStats(provider?: ProviderFilter): Promise<ProjectStats[]> {
  const p = provider ?? "all";
  if (p === "claude") return claude.getProjectStats();
  if (p === "codex") return codex.getProjectStats();
  const [c, x] = await Promise.all([claude.getProjectStats(), codex.getProjectStats()]);
  return [...c, ...x].sort((a, b) =>
    new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
  );
}

// ── Search ───────────────────────────────────────────────────────────────────

export async function searchAll(query: string, provider?: ProviderFilter): Promise<SearchResult[]> {
  const p = provider ?? "all";
  if (p === "claude") return claude.searchAll(query);
  if (p === "codex") return codex.searchAll(query);
  const [c, x] = await Promise.all([claude.searchAll(query), codex.searchAll(query)]);
  return [...c, ...x].slice(0, 20);
}

// ── Conversation ─────────────────────────────────────────────────────────────

export function findSessionJsonl(sessionId: string, provider?: ProviderFilter): string | null {
  const p = provider ?? "all";
  if (p === "claude") return claude.findSessionJsonl(sessionId);
  if (p === "codex") return codex.findSessionJsonl(sessionId);
  return claude.findSessionJsonl(sessionId) || codex.findSessionJsonl(sessionId);
}

export async function readConversationLines(
  filePath: string,
  n: number
): Promise<string[]> {
  // This is provider-agnostic — just reads lines from a file
  return claude.readConversationLines(filePath, n);
}

export async function getConversationPreview(
  sessionId: string,
  maxMessages?: number,
  provider?: ProviderFilter
): Promise<ConversationMessage[]> {
  const p = provider ?? "all";
  if (p === "claude") return claude.getConversationPreview(sessionId, maxMessages);
  if (p === "codex") return codex.getConversationPreview(sessionId, maxMessages);
  // Try Claude first, then Codex
  const result = await claude.getConversationPreview(sessionId, maxMessages);
  if (result.length > 0) return result;
  return codex.getConversationPreview(sessionId, maxMessages);
}

export async function getSessionErrors(
  sessionId: string,
  provider?: ProviderFilter
): Promise<string[]> {
  const p = provider ?? "all";
  if (p === "claude") return claude.getSessionErrors(sessionId);
  if (p === "codex") return codex.getSessionErrors(sessionId);
  const result = await claude.getSessionErrors(sessionId);
  if (result.length > 0) return result;
  return codex.getSessionErrors(sessionId);
}

// ── Scheduled Tasks ──────────────────────────────────────────────────────────

export async function getScheduledTasks(provider?: ProviderFilter): Promise<ScheduledTask[]> {
  const p = provider ?? "all";
  if (p === "claude") return claude.getScheduledTasks();
  if (p === "codex") return codex.getScheduledTasks();
  const [c, x] = await Promise.all([claude.getScheduledTasks(), codex.getScheduledTasks()]);
  return [...c, ...x];
}

// ── Plugins ──────────────────────────────────────────────────────────────────

export async function getInstalledPlugins(provider?: ProviderFilter): Promise<InstalledPlugin[]> {
  const p = provider ?? "all";
  if (p === "claude") return claude.getInstalledPlugins();
  if (p === "codex") return codex.getInstalledPlugins();
  const [c, x] = await Promise.all([claude.getInstalledPlugins(), codex.getInstalledPlugins()]);
  return [...c, ...x].sort((a, b) => a.name.localeCompare(b.name));
}

// ── Overview ─────────────────────────────────────────────────────────────────

export async function getOverview(provider?: ProviderFilter): Promise<DashboardOverview> {
  const p = provider ?? "all";
  if (p === "claude") return claude.getOverview();
  if (p === "codex") return codex.getOverview();

  const [c, x] = await Promise.all([claude.getOverview(), codex.getOverview()]);
  return {
    activeSessions: c.activeSessions + x.activeSessions,
    awaitingInput: c.awaitingInput + x.awaitingInput,
    totalTokensToday: addTokens(c.totalTokensToday, x.totalTokensToday),
    totalTokensMonth: addTokens(c.totalTokensMonth, x.totalTokensMonth),
    totalCost: {
      inputCost: c.totalCost.inputCost + x.totalCost.inputCost,
      outputCost: c.totalCost.outputCost + x.totalCost.outputCost,
      cacheWriteCost: c.totalCost.cacheWriteCost + x.totalCost.cacheWriteCost,
      cacheReadCost: c.totalCost.cacheReadCost + x.totalCost.cacheReadCost,
      totalCost: c.totalCost.totalCost + x.totalCost.totalCost,
    },
    activeProjects: c.activeProjects + x.activeProjects,
    scheduledTasks: c.scheduledTasks + x.scheduledTasks,
    recentSessions: [...c.recentSessions, ...x.recentSessions]
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 5),
    tokenTimeSeries: [...c.tokenTimeSeries, ...x.tokenTimeSeries].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    ),
  };
}

// ── System Status ────────────────────────────────────────────────────────────

export async function getSystemStatus(provider?: ProviderFilter): Promise<SystemStatus> {
  const p = provider ?? "all";
  if (p === "claude") return claude.getSystemStatus();
  if (p === "codex") return codex.getSystemStatus();

  // Merge both providers
  const [c, x, claudeSessions, codexSessions] = await Promise.all([
    claude.getClaudeProviderStatus(),
    codex.getCodexProviderStatus(),
    claude.getActiveSessions(),
    codex.getActiveSessions(),
  ]);

  return {
    claude: c,
    codex: x,
    activeSessions:
      claudeSessions.filter((s) => s.isAlive).length +
      codexSessions.filter((s) => s.isAlive).length,
  };
}
