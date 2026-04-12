import { NextResponse } from "next/server";
import { execFile } from "child_process";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { sessionId, cwd } = await request.json();

    if (!sessionId || !cwd) {
      return NextResponse.json(
        { error: "sessionId and cwd are required" },
        { status: 400 }
      );
    }

    // Use osascript to open Terminal and resume the Claude session
    const script = `tell application "Terminal"
      activate
      do script "cd '${cwd}' && claude -r ${sessionId}"
    end tell`;

    execFile("osascript", ["-e", script], (error) => {
      if (error) {
        console.error("Failed to open terminal:", error);
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to open session" },
      { status: 500 }
    );
  }
}
