import { NextResponse, NextRequest } from "next/server";
import { getStravaActivityStreams, upsertStravaStreams } from "@/lib/strava";
import { pool } from "@/lib/db";

// Visit /api/backfill/strava-streams?limit=50 to fetch full-resolution
// power/HR/etc streams for rides that are already in `activities` but don't
// have a matching row in `activity_streams` yet.
// One API call per ride, so keep `limit` modest per run to stay well within
// Strava's rate limits (100 req/15min) and Vercel's function timeout.
export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "50");

  const { rows } = await pool.query(
    `select a.id from activities a
     left join activity_streams s on s.activity_id = a.id
     where s.activity_id is null
     order by a.start_date desc
     limit $1`,
    [limit]
  );

  let imported = 0;
  const failed: string[] = [];

  for (const row of rows) {
    try {
      const streams = await getStravaActivityStreams(row.id);
      await upsertStravaStreams(row.id, streams);
      imported++;
    } catch {
      failed.push(row.id);
    }
  }

  return NextResponse.json({ imported, remaining: rows.length - imported, failed });
}
