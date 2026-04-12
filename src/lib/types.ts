export interface ClaudeSession {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  kind: string;
  entrypoint: string;
  isAlive: boolean;
  status: SessionStatus;
  projectName: string;
  lastMessage?: string;
  slug?: string;
  totalTokens?: TokenUsage;
}

export type SessionStatus =
  | "running"
  | "awaiting_input"
  | "needs_attention"
  | "processing"
  | "idle"
  | "dead";

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface TokenDataPoint {
  timestamp: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  cumulative_input: number;
  cumulative_output: number;
}

export interface CostEstimate {
  inputCost: number;
  outputCost: number;
  cacheWriteCost: number;
  cacheReadCost: number;
  totalCost: number;
}

export interface ProjectSummary {
  id: string;
  path: string;
  name: string;
  sessionCount: number;
  lastActivity: string;
  totalTokens: TokenUsage;
  cost: CostEstimate;
}

export interface ProjectDetail extends ProjectSummary {
  sessions: ProjectSession[];
  subagents: SubagentMeta[];
  memoryFiles: string[];
  tokenTimeSeries: TokenDataPoint[];
}

export interface ProjectSession {
  sessionId: string;
  messageCount: number;
  totalTokens: TokenUsage;
  firstMessage: string;
  lastMessage: string;
}

export interface SubagentMeta {
  agentType: string;
  description: string;
  sessionId: string;
}

export interface ScheduledTask {
  taskId: string;
  description: string;
  schedule: string;
  enabled: boolean;
  project?: string;
  lastRunAt?: string;
  nextRunAt?: string;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  text: string;
  timestamp: string;
  toolUses?: string[];
  errors?: string[];
}

export interface SessionHistory {
  sessionId: string;
  projectName: string;
  cwd: string;
  startedAt: number;
  endedAt?: string;
  entrypoint: string;
  totalTokens: TokenUsage;
  cost: CostEstimate;
  messageCount: number;
  status: SessionStatus;
}

export interface SearchResult {
  type: "session" | "project" | "conversation";
  title: string;
  subtitle: string;
  href: string;
  snippet?: string;
}

export interface DailyTokenUsage {
  date: string; // YYYY-MM-DD
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  totalCost: number;
  sessionCount: number;
}

export interface ProjectStats {
  id: string;
  name: string;
  totalTokens: TokenUsage;
  cost: CostEstimate;
  sessionCount: number;
  lastActivity: string;
  errorCount: number;
  successCount: number;
  errorRate: number;
}

export interface DashboardOverview {
  activeSessions: number;
  awaitingInput: number;
  totalTokensToday: TokenUsage;
  totalTokensMonth: TokenUsage;
  totalCost: CostEstimate;
  activeProjects: number;
  scheduledTasks: number;
  recentSessions: ClaudeSession[];
  tokenTimeSeries: TokenDataPoint[];
}
