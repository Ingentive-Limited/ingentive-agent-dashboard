import { NextResponse } from "next/server";
import { getSessionErrors } from "@/lib/claude-data";

export const dynamic = "force-dynamic";

const SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("id");
    if (!sessionId || !SESSION_ID_RE.test(sessionId)) {
      return NextResponse.json(
        { error: "Valid session ID required" },
        { status: 400 }
      );
    }
    const errors = await getSessionErrors(sessionId);
    return NextResponse.json(errors);
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch errors" },
      { status: 500 }
    );
  }
}
