import { NextResponse } from "next/server";
import { getActiveSessions } from "@/lib/claude-data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sessions = await getActiveSessions();
    return NextResponse.json(sessions);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch sessions" },
      { status: 500 }
    );
  }
}
