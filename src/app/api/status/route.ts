import { NextResponse } from "next/server";
import { getSystemStatus } from "@/lib/claude-data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = await getSystemStatus();
    return NextResponse.json(status);
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch status" },
      { status: 500 }
    );
  }
}
