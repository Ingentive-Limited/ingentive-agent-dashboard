#!/usr/bin/env bash
# Seed ~/.claude/ with realistic fixture data for CI e2e tests.
# This script is called by the GitHub Actions workflow before Playwright runs.

set -euo pipefail

CLAUDE_DIR="$HOME/.claude"

# ── Sessions ──────────────────────────────────────────────────────────────────
mkdir -p "$CLAUDE_DIR/sessions"

# Start a long-running background process so isPidAlive() returns true
sleep 600 &
LIVE_PID=$!

cat > "$CLAUDE_DIR/sessions/session-abc123.json" <<EOF
{
  "pid": $LIVE_PID,
  "sessionId": "abc123",
  "cwd": "/home/runner/projects/my-app",
  "startedAt": $(date +%s)000,
  "kind": "task",
  "entrypoint": "cli"
}
EOF

cat > "$CLAUDE_DIR/sessions/session-def456.json" <<EOF
{
  "pid": 99999,
  "sessionId": "def456",
  "cwd": "/home/runner/projects/api-server",
  "startedAt": $(date -d '1 hour ago' +%s 2>/dev/null || date -v-1H +%s)000,
  "kind": "interactive",
  "entrypoint": "cli"
}
EOF

# ── Projects & JSONL conversation logs ────────────────────────────────────────
PROJECT1_DIR="$CLAUDE_DIR/projects/-home-runner-projects-my-app"
PROJECT2_DIR="$CLAUDE_DIR/projects/-home-runner-projects-api-server"
mkdir -p "$PROJECT1_DIR" "$PROJECT2_DIR"

NOW_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Session abc123 – awaiting input (assistant message with stop_reason end_turn)
cat > "$PROJECT1_DIR/abc123.jsonl" <<EOF
{"type":"user","message":{"role":"user","content":"Build a landing page"},"timestamp":"$NOW_ISO","cwd":"/home/runner/projects/my-app"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"I've created the landing page. Let me know if you'd like any changes."}],"stop_reason":"end_turn","usage":{"input_tokens":1200,"output_tokens":350,"cache_creation_input_tokens":0,"cache_read_input_tokens":800}},"timestamp":"$NOW_ISO"}
EOF

# Session def456 – dead session with some token usage
cat > "$PROJECT2_DIR/def456.jsonl" <<EOF
{"type":"user","message":{"role":"user","content":"Add error handling"},"timestamp":"$NOW_ISO","cwd":"/home/runner/projects/api-server"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Done. I've added try/catch blocks."}],"stop_reason":"end_turn","usage":{"input_tokens":800,"output_tokens":200,"cache_creation_input_tokens":100,"cache_read_input_tokens":500}},"timestamp":"$NOW_ISO"}
EOF

# ── Plugins ───────────────────────────────────────────────────────────────────
mkdir -p "$CLAUDE_DIR/plugins"

cat > "$CLAUDE_DIR/plugins/installed_plugins.json" <<EOF
{
  "version": 2,
  "plugins": {
    "code-review@marketplace": [
      {
        "scope": "user",
        "version": "1.2.0",
        "installedAt": "$NOW_ISO",
        "lastUpdated": "$NOW_ISO"
      }
    ],
    "test-runner@marketplace": [
      {
        "scope": "project",
        "version": "0.9.1",
        "installedAt": "$NOW_ISO",
        "lastUpdated": "$NOW_ISO"
      }
    ]
  }
}
EOF

# ── History ───────────────────────────────────────────────────────────────────
cat > "$CLAUDE_DIR/history.jsonl" <<EOF
{"command":"claude","cwd":"/home/runner/projects/my-app","timestamp":"$NOW_ISO"}
{"command":"claude /schedule","cwd":"/home/runner/projects/api-server","timestamp":"$NOW_ISO"}
EOF

echo "✓ Seeded $CLAUDE_DIR with fixture data for e2e tests"
