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

export interface ProjectSummary {
  id: string;
  path: string;
  name: string;
  sessionCount: number;
  lastActivity: string;
  totalTokens: TokenUsage;
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

export interface DashboardOverview {
  activeSessions: number;
  awaitingInput: number;
  totalTokensToday: TokenUsage;
  activeProjects: number;
  scheduledTasks: number;
  recentSessions: ClaudeSession[];
}
