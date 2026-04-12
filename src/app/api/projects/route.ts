import { NextResponse } from "next/server";
import { getProjects } from "@/lib/claude-data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const projects = await getProjects();
    return NextResponse.json(projects);
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch projects" },
      { status: 500 }
    );
  }
}
