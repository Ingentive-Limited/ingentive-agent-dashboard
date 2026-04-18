import { NextResponse } from "next/server";
import { searchAll, parseProvider } from "@/lib/agent-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = parseProvider(searchParams.get("provider"));
    const q = searchParams.get("q");
    if (!q || q.length < 2 || q.length > 200) {
      return NextResponse.json([]);
    }
    const results = await searchAll(q, provider);
    return NextResponse.json(results);
  } catch {
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}
