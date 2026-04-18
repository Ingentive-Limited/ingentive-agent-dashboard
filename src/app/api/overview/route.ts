import { NextResponse } from "next/server";
import { getOverview, parseProvider } from "@/lib/agent-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = parseProvider(searchParams.get("provider"));
    const overview = await getOverview(provider);
    return NextResponse.json(overview);
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch overview" },
      { status: 500 }
    );
  }
}
