import { NextResponse } from "next/server";
import crypto from "crypto";
import { buildStravaAuthUrl } from "@/lib/strava";

export async function GET() {
  // Simple CSRF-protection token; for a single-user app this can be static-ish,
  // but generating fresh each time costs nothing.
  const state = crypto.randomBytes(16).toString("hex");
  const url = buildStravaAuthUrl(state);
  return NextResponse.redirect(url);
}
