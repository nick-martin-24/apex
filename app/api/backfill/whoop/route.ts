import { NextRequest, NextResponse } from "next/server";
import { listWhoopRecovery, upsertWhoopRecovery } from "@/lib/whoop";

// Visit /api/backfill/whoop?limit=90 to pull existing recovery history in.
// WHOOP paginates via next_token rather than page numbers.
export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "90");
  const pageSize = 25;
  let imported = 0;
  let nextToken: string | undefined;

  while (imported < limit) {
    const batch = await listWhoopRecovery(pageSize, nextToken);
    const records = batch.records ?? [];
    if (records.length === 0) break;

    for (const r of records) {
      await upsertWhoopRecovery(r);
      imported++;
      if (imported >= limit) break;
    }

    nextToken = batch.next_token;
    if (!nextToken) break;
  }

  return NextResponse.json({ imported });
}
