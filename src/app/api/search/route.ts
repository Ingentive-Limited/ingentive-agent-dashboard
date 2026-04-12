import { NextResponse } from "next/server";
import { searchAll } from "@/lib/claude-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q");
    if (!q || q.length < 2) {
      return NextResponse.json([]);
    }
    const results = await searchAll(q);
    return NextResponse.json(results);
  } catch {
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}
