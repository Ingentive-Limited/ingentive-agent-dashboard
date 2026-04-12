import { NextResponse } from "next/server";
import { getInstalledPlugins } from "@/lib/claude-data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const plugins = await getInstalledPlugins();
    return NextResponse.json(plugins);
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch plugins" },
      { status: 500 }
    );
  }
}
