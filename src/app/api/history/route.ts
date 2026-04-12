import { NextResponse } from "next/server";
import { getSessionHistory } from "@/lib/claude-data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const history = await getSessionHistory();
    return NextResponse.json(history);
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch session history" },
      { status: 500 }
    );
  }
}
