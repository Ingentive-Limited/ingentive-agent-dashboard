import { NextResponse } from "next/server";
import { execFileSync } from "child_process";
import { getActiveSessions } from "@/lib/claude-data";

export const dynamic = "force-dynamic";

/** Verify the PID is still a Claude process right before kill (mitigate TOCTOU). */
function verifyClaudeProcess(pid: number): boolean {
  try {
    // Use execFileSync (no shell) to safely check the process name
    const result = execFileSync("ps", ["-p", String(pid), "-o", "comm="], {
      timeout: 2000,
      encoding: "utf-8",
    }).trim().toLowerCase();
    return result.includes("claude") || result.includes("node");
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  try {
    const { pid } = await request.json();

    if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
      return NextResponse.json(
        { error: "pid must be a positive integer" },
        { status: 400 }
      );
    }

    // Verify the PID belongs to a known Claude session
    const sessions = await getActiveSessions();
    const isClaudeSession = sessions.some((s) => s.pid === pid && s.isAlive);
    if (!isClaudeSession) {
      return NextResponse.json(
        { error: "Not a known Claude session" },
        { status: 403 }
      );
    }

    // Re-verify process name immediately before kill to reduce TOCTOU window
    if (!verifyClaudeProcess(pid)) {
      return NextResponse.json(
        { error: "Process is no longer a Claude session" },
        { status: 409 }
      );
    }

    try {
      process.kill(pid, "SIGTERM");
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && err.code === "ESRCH") {
        return NextResponse.json(
          { error: "Process not found" },
          { status: 404 }
        );
      }
      throw err;
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to kill session" },
      { status: 500 }
    );
  }
}
