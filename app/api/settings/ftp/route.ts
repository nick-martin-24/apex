import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const { rows } = await pool.query("select ftp_watts from athlete_settings where id = true");
  return NextResponse.json({ ftp_watts: rows[0]?.ftp_watts ?? null });
}

// POST { "ftp_watts": 250 } to set/update your FTP
export async function POST(req: NextRequest) {
  const body = await req.json();
  const ftp = Number(body.ftp_watts);
  if (!ftp || ftp <= 0) {
    return NextResponse.json({ error: "ftp_watts must be a positive number" }, { status: 400 });
  }

  await pool.query(
    `insert into athlete_settings (id, ftp_watts, updated_at)
     values (true, $1, now())
     on conflict (id) do update set ftp_watts = excluded.ftp_watts, updated_at = now()`,
    [ftp]
  );

  return NextResponse.json({ ftp_watts: ftp });
}
