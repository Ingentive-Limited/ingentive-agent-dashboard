import { NextResponse } from "next/server";
import { getOverview } from "@/lib/claude-data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const overview = await getOverview();
    return NextResponse.json(overview);
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch overview" },
      { status: 500 }
    );
  }
}
