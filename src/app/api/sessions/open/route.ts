import { NextResponse } from "next/server";
import { execFile } from "child_process";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

const IS_WIN = process.platform === "win32";

function escapeAppleScript(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

const SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/;

function openSessionInTerminal(cwd: string, sessionId: string) {
  if (IS_WIN) {
    // Windows: open Windows Terminal or cmd with the claude command
    const cmd = `cd /d "${cwd}" && claude -r ${sessionId}`;
    // Try Windows Terminal first, fall back to cmd
    execFile("cmd.exe", ["/c", "start", "cmd.exe", "/k", cmd], (err) => {
      if (err) {
        console.error("Failed to open terminal:", err);
      }
    });
  } else if (process.platform === "linux") {
    // Linux: try common terminal emulators
    const cmd = `cd "${cwd}" && claude -r ${sessionId}`;
    // Try xterm as a widely available fallback
    const terminals = [
      { cmd: "gnome-terminal", args: ["--", "bash", "-c", cmd] },
      { cmd: "konsole", args: ["-e", "bash", "-c", cmd] },
      { cmd: "xterm", args: ["-e", `bash -c '${cmd.replace(/'/g, "'\\''")}'`] },
    ];

    function tryTerminal(index: number) {
      if (index >= terminals.length) {
        console.error("No supported terminal emulator found");
        return;
      }
      const t = terminals[index];
      execFile(t.cmd, t.args, (err) => {
        if (err) tryTerminal(index + 1);
      });
    }
    tryTerminal(0);
  } else {
    // macOS: use osascript to open Terminal.app
    const safeCwd = escapeAppleScript(cwd);
    const safeSessionId = escapeAppleScript(sessionId);

    const script = `tell application "Terminal"
      activate
      do script "cd \\"${safeCwd}\\" && claude -r ${safeSessionId}"
    end tell`;

    execFile("osascript", ["-e", script], (err) => {
      if (err) {
        console.error("Failed to open terminal:", err);
      }
    });
  }
}

export async function POST(request: Request) {
  try {
    const { sessionId, cwd } = await request.json();

    if (!sessionId || !cwd) {
      return NextResponse.json(
        { error: "sessionId and cwd are required" },
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

    // Validate cwd is an absolute path that exists
    const resolvedCwd = path.resolve(cwd);
    if (!path.isAbsolute(resolvedCwd) || !fs.existsSync(resolvedCwd)) {
      return NextResponse.json(
        { error: "Invalid working directory" },
        { status: 400 }
      );
    }

    openSessionInTerminal(resolvedCwd, sessionId);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to open session" },
      { status: 500 }
    );
  }
}
