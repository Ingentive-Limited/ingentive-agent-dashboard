# Ingentive Agent OS

A local management dashboard for monitoring and interacting with your active Claude Code sessions, projects, token usage, and scheduled tasks. Works on macOS, Windows, and Linux.

Ingentive Agent OS reads data directly from the `~/.claude/` filesystem and Claude Desktop app storage to give you real-time visibility into everything Claude is doing on your machine.

## Features

- **Dashboard** - Overview of active sessions, token usage, estimated costs, active projects, scheduled tasks, and a token usage chart
- **Sessions** - Live session list with status indicators (running, processing, idle, awaiting input), PID, duration, and entrypoint (CLI/Desktop)
- **Awaiting Input** - Sessions where Claude is waiting for your response, with configurable browser notifications (sound, status filters)
- **Session History** - Full history of all sessions (active and dead) with expandable conversation preview and error surfacing
- **Projects** - All Claude projects with session counts, last activity, token summaries, and cost estimates. Sort by name, activity, tokens, cost, or sessions. Group by parent directory
- **Project Detail** - Per-project view with session history, token usage charts, subagents, and memory files
- **Token Usage** - Stacked charts showing input/output/cache token breakdown per project
- **Scheduled Tasks** - All scheduled tasks grouped by project, pulled from Claude Desktop
- **Global Search** - Search across projects, sessions, and conversations with Cmd/Ctrl+K
- **Cost Tracking** - Estimated USD costs based on Anthropic API pricing (Sonnet 4), with an API/Subscription toggle to hide costs for subscription users
- **Session Interaction** - Click any session to open it directly in your terminal via `claude -r`
- **Dark/Light Mode** - Full theme support with the Ingentive brand

## Tech Stack

- Next.js 15 (App Router) + TypeScript
- shadcn/ui v4 + Tailwind CSS v4
- Recharts for token usage charts
- SWR for client-side polling (5s refresh)
- next-themes for dark/light mode

## Prerequisites

- Node.js 18+
- npm
- Claude Code or Claude Desktop installed

## Platform Support

Ingentive Agent OS supports macOS, Windows, and Linux. Session data is read from platform-appropriate locations, and clicking a session opens it in the native terminal for each OS.

| Platform | Claude data directory | App data directory | Terminal |
|----------|----------------------|--------------------|----------|
| macOS | `~/.claude/` | `~/Library/Application Support/Claude/` | Terminal.app |
| Windows | `%USERPROFILE%\.claude\` | `%APPDATA%\Claude\` | cmd.exe |
| Linux | `~/.claude/` | `$XDG_CONFIG_HOME/Claude/` (default: `~/.config/Claude/`) | gnome-terminal, konsole, or xterm |

## Getting Started

### Install dependencies

```bash
cd ingentive-agent-os
npm install
```

### Build and run in production mode

```bash
npm run build
npm start
```

The app will be available at [http://localhost:3000](http://localhost:3000).

### Run in development mode (with hot reload)

```bash
npm run dev
```

## Data Sources

All data is read server-side from the local filesystem. No external APIs or databases are required.

| Source | Location | Data |
|--------|----------|------|
| Sessions | `~/.claude/sessions/*.json` | Active session PIDs, working directories, entrypoints |
| Conversations | `~/.claude/projects/<encoded-path>/*.jsonl` | Token usage, session status, message history |
| Subagents | `~/.claude/projects/.../subagents/agent-*.meta.json` | Agent types and descriptions |
| Scheduled Tasks | `<app-data-dir>/local-agent-mode-sessions/**/scheduled-tasks.json` | Task definitions, schedules, last run times |
| Task Definitions | Referenced via `filePath` in scheduled-tasks.json | Task descriptions and prompts |

## Session Status Detection

Session status is determined by reading the last entry in each session's JSONL conversation log:

| Last Entry | Status |
|-----------|--------|
| Assistant message with `stop_reason: "end_turn"` | Awaiting input |
| Assistant message with `AskUserQuestion` tool use | Needs attention |
| Assistant message with `stop_reason: "tool_use"` | Running |
| User message | Processing |
| PID not alive | Dead |

## License

This project is licensed under an MIT License with Restrictions — free to use, no redistribution without permission, forking with attribution allowed. See [LICENSE](LICENSE) for details.
