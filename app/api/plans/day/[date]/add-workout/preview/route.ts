import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { previewAdd, ADDABLE_TYPES, AddableType } from "@/lib/planAdjustment";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { date: string } }) {
  const body = await req.json();

  if (!ADDABLE_TYPES.includes(body.workout_type)) {
    return NextResponse.json({ error: `workout_type must be one of: ${ADDABLE_TYPES.join(", ")}` }, { status: 400 });
  }

  const { rows: planRows } = await pool.query(
    "select id from plans where status = 'active' order by created_at desc limit 1"
  );
  if (planRows.length === 0) {
    return NextResponse.json({ error: "No active plan" }, { status: 400 });
  }

  try {
    const preview = await previewAdd(planRows[0].id, params.date, body.workout_type as AddableType, {
      minutes: body.minutes ? Number(body.minutes) : undefined,
    });
    return NextResponse.json(preview);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed to preview" }, { status: 400 });
  }
}
