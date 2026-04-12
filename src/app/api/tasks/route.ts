import { NextResponse } from "next/server";
import { getScheduledTasks } from "@/lib/claude-data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const tasks = await getScheduledTasks();
    return NextResponse.json(tasks);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch tasks" },
      { status: 500 }
    );
  }
}
