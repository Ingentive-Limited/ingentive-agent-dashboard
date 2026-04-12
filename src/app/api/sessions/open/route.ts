import { NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";

export const dynamic = "force-dynamic";

const IS_WIN = process.platform === "win32";

const SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/;

/**
 * Opens a terminal with `claude -r <sessionId>` in the given cwd.
 * Uses spawn with the cwd option to avoid shell injection entirely.
 */
function openSessionInTerminal(cwd: string, sessionId: string) {
  if (IS_WIN) {
    // Windows: open a new cmd.exe window, run claude -r
    // Use 'start' to open a new window, then run claude directly
    spawn("cmd.exe", ["/c", "start", "cmd.exe", "/k", "claude", "-r", sessionId], {
      cwd,
      detached: true,
      stdio: "ignore",
    }).unref();
  } else if (process.platform === "linux") {
    // Linux: try common terminal emulators with direct args (no shell interpolation)
    const terminals = [
      { bin: "gnome-terminal", args: ["--working-directory", cwd, "--", "claude", "-r", sessionId] },
      { bin: "konsole", args: ["--workdir", cwd, "-e", "claude", "-r", sessionId] },
      { bin: "xterm", args: ["-e", "claude", "-r", sessionId] },
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
    // macOS: use `open -a Terminal <cwd>` to open Terminal at the directory,
    // then use osascript to run the claude command in the frontmost Terminal window.
    // The sessionId is validated by regex, so it's safe to interpolate.
    const proc = spawn("open", ["-a", "Terminal", cwd], {
      detached: true,
      stdio: "ignore",
    });
    proc.on("close", () => {
      // Give Terminal a moment to open, then run the command
      setTimeout(() => {
        spawn("osascript", [
          "-e",
          `tell application "Terminal" to do script "claude -r ${sessionId}" in front window`,
        ], {
          detached: true,
          stdio: "ignore",
        }).unref();
      }, 500);
    });
    proc.unref();
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

    // Validate cwd is an absolute path that exists within the user's home
    const resolvedCwd = path.resolve(cwd);
    const homeDir = os.homedir();
    if (
      !path.isAbsolute(resolvedCwd) ||
      !resolvedCwd.startsWith(homeDir) ||
      !fs.existsSync(resolvedCwd)
    ) {
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
