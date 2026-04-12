import { NextResponse } from "next/server";
import { getProjectDetail } from "@/lib/claude-data";

export const dynamic = "force-dynamic";

const PROJECT_ID_RE = /^[a-zA-Z0-9_-]+$/;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Validate project ID to prevent path traversal
    if (!PROJECT_ID_RE.test(id)) {
      return NextResponse.json(
        { error: "Invalid project ID" },
        { status: 400 }
      );
    }

    const project = await getProjectDetail(id);
    if (!project) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      );
    }
    return NextResponse.json(project);
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch project detail" },
      { status: 500 }
    );
  }
}
