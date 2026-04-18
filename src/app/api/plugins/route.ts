import { NextResponse } from "next/server";
import { getInstalledPlugins, parseProvider } from "@/lib/agent-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = parseProvider(searchParams.get("provider"));
    const plugins = await getInstalledPlugins(provider);
    return NextResponse.json(plugins);
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch plugins" },
      { status: 500 }
    );
  }
}
