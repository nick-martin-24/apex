import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { computeTimeInZones } from "@/lib/zones";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const [{ rows: settingsRows }, { rows: streamRows }] = await Promise.all([
    pool.query("select ftp_watts from athlete_settings where id = true"),
    pool.query("select time_s, watts from activity_streams where activity_id = $1", [params.id]),
  ]);

  const ftp = settingsRows[0]?.ftp_watts;
  if (!ftp) {
    return NextResponse.json(
      { error: "No FTP set yet — POST to /api/settings/ftp with { ftp_watts: <number> } first" },
      { status: 400 }
    );
  }

  const stream = streamRows[0];
  if (!stream || !stream.time_s || !stream.watts) {
    return NextResponse.json(
      { error: "No power stream stored for this activity — run the streams backfill first" },
      { status: 404 }
    );
  }

  const zones = computeTimeInZones(stream.time_s, stream.watts, ftp);
  return NextResponse.json({ activity_id: params.id, ftp_watts: ftp, zones });
}
