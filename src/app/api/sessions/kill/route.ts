import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { pid } = await request.json();

    if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
      return NextResponse.json(
        { error: "pid must be a positive integer" },
        { status: 400 }
      );
    }

    try {
      process.kill(pid, "SIGTERM");
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && err.code === "ESRCH") {
        return NextResponse.json(
          { error: "Process not found" },
          { status: 404 }
        );
      }
      throw err;
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to kill session" },
      { status: 500 }
    );
  }
}
