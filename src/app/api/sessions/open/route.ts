import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { getActiveSessions, parseProvider } from "@/lib/agent-data";

export const dynamic = "force-dynamic";

const IS_WIN = process.platform === "win32";

// Strict: alphanumeric + hyphen + underscore only. This explicitly excludes
// every AppleScript-dangerous character (", `, \, $, newline) as well as every
// shell metacharacter, so by the time we interpolate sessionId below it cannot
// break out of its string context.
const SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/;

/**
 * Opens a terminal with `claude -r <sessionId>` in the given cwd.
 * Uses spawn with the cwd option to avoid shell injection entirely.
 */
function openSessionInTerminal(cwd: string, sessionId: string, provider: "claude" | "codex" = "claude") {
  const cli = provider === "codex" ? "codex" : "claude";
  const resumeArgs = provider === "codex" ? ["--resume", sessionId] : ["-r", sessionId];

  if (IS_WIN) {
    spawn("cmd.exe", ["/c", "start", "cmd.exe", "/k", cli, ...resumeArgs], {
      cwd,
      detached: true,
      stdio: "ignore",
    }).unref();
  } else if (process.platform === "linux") {
    const terminals = [
      { bin: "gnome-terminal", args: ["--working-directory", cwd, "--", cli, ...resumeArgs] },
      { bin: "konsole", args: ["--workdir", cwd, "-e", cli, ...resumeArgs] },
      { bin: "xterm", args: ["-e", cli, ...resumeArgs] },
    ];

    function tryTerminal(index: number) {
      if (index >= terminals.length) {
        console.error("No supported terminal emulator found");
        return;
      }
      const t = terminals[index];
      const proc = spawn(t.bin, t.args, {
        cwd,
        detached: true,
        stdio: "ignore",
      });
      proc.on("error", () => tryTerminal(index + 1));
      proc.unref();
    }
    tryTerminal(0);
  } else {
    // macOS: sessionId has already been validated against SESSION_ID_RE by
    // the POST handler, so it contains only [a-zA-Z0-9_-] and is safe to
    // interpolate into an AppleScript string literal without escaping.
    const command =
      provider === "codex"
        ? `codex --resume ${sessionId}`
        : `claude -r ${sessionId}`;
    const proc = spawn("open", ["-a", "Terminal", cwd], {
      detached: true,
      stdio: "ignore",
    });
    proc.on("close", () => {
      setTimeout(() => {
        spawn(
          "osascript",
          [
            "-e",
            `tell application "Terminal" to do script "${command}" in front window`,
          ],
          {
            detached: true,
            stdio: "ignore",
          }
        ).unref();
      }, 500);
    });
    proc.unref();
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { sessionId } = body;
    const requestedProvider = parseProvider(body.provider);

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 }
      );
    }

    // Validate sessionId format (alphanumeric, hyphens, underscores only)
    if (!SESSION_ID_RE.test(sessionId)) {
      return NextResponse.json(
        { error: "Invalid sessionId format" },
        { status: 400 }
      );
    }

    // Look up the session's working directory from our own data source
    // (the Claude/Codex SQLite/JSONL) rather than trusting the client-supplied
    // cwd. This means the only way to open a terminal is for an already-known
    // session, and the cwd is whatever the CLI recorded when the session was
    // created — not user input at request time.
    const sessions = await getActiveSessions(requestedProvider);
    const session = sessions.find((s) => s.sessionId === sessionId);
    if (!session) {
      return NextResponse.json(
        { error: "Unknown session" },
        { status: 404 }
      );
    }

    const trustedCwd = session.cwd;
    const resolvedProvider = session.provider === "codex" ? "codex" : "claude";

    openSessionInTerminal(trustedCwd, sessionId, resolvedProvider);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to open session" },
      { status: 500 }
    );
  }
}
