import { NextResponse } from "next/server";
import { getSessionHistory, parseProvider } from "@/lib/agent-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = parseProvider(searchParams.get("provider"));
    const history = await getSessionHistory(provider);
    return NextResponse.json(history);
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch session history" },
      { status: 500 }
    );
  }
}
