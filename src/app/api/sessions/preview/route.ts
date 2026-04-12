import { NextResponse } from "next/server";
import { getConversationPreview } from "@/lib/claude-data";

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
    const messages = await getConversationPreview(sessionId);
    return NextResponse.json(messages);
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch preview" },
      { status: 500 }
    );
  }
}
