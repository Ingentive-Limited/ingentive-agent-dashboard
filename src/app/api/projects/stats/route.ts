import { NextResponse } from "next/server";
import { getProjectStats } from "@/lib/claude-data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stats = await getProjectStats();
    return NextResponse.json(stats);
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch project stats" },
      { status: 500 }
    );
  }
}
