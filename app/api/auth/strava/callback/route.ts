import { NextRequest, NextResponse } from "next/server";
import { exchangeStravaCode } from "@/lib/strava";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.json({ error: `Strava denied access: ${error}` }, { status: 400 });
  }
  if (!code) {
    return NextResponse.json({ error: "Missing code param" }, { status: 400 });
  }

  await exchangeStravaCode(code);

  return NextResponse.redirect(new URL("/dashboard?connected=strava", req.url));
}
