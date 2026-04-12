import { NextResponse } from "next/server";
import { getDailyTokenUsage } from "@/lib/claude-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const daysParam = searchParams.get("days");
    const days = daysParam ? Math.min(Math.max(parseInt(daysParam, 10) || 30, 1), 365) : 30;

    const daily = await getDailyTokenUsage(days);
    return NextResponse.json(daily);
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch daily token usage" },
      { status: 500 }
    );
  }
}
