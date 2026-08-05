import { NextResponse } from "next/server";
import { rematchAllForActivePlan } from "@/lib/planMatching";

export const dynamic = "force-dynamic";

export async function GET() {
  const matched = await rematchAllForActivePlan();
  return NextResponse.json({ matched });
}
