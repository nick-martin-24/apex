import { NextRequest, NextResponse } from "next/server";
import { getLatestWhoopRecovery, upsertWhoopRecovery } from "@/lib/whoop";
import { pool } from "@/lib/db";

// WHOOP signs webhook payloads (X-WHOOP-Signature) — verify this once you have
// your webhook secret from the developer dashboard. Skipped here for brevity.
export async function POST(req: NextRequest) {
  const event = await req.json();

  if (event.type === "recovery.updated" || event.type === "recovery.created") {
    const recovery = await getLatestWhoopRecovery();
    const r = recovery.records?.[0];
    if (r) {
      await upsertWhoopRecovery(r);
    }
  }

  return NextResponse.json({}, { status: 200 });
}
