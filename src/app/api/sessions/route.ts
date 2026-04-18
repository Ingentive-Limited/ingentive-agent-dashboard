import { NextResponse } from "next/server";
import { getActiveSessions, parseProvider } from "@/lib/agent-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = parseProvider(searchParams.get("provider"));
    const sessions = await getActiveSessions(provider);
    return NextResponse.json(sessions);
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch sessions" },
      { status: 500 }
    );
  }
}
