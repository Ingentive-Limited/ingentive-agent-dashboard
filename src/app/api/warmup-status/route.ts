import { NextResponse } from "next/server";
import { getWarmupStatus } from "@/lib/startup-warmup";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getWarmupStatus());
}
