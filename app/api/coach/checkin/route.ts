import { NextResponse } from "next/server";
import { getCoachCheckin } from "@/lib/aiCoach";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await getCoachCheckin();
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed to generate check-in" }, { status: 500 });
  }
}
