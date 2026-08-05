import { NextResponse } from "next/server";
import crypto from "crypto";
import { buildWhoopAuthUrl } from "@/lib/whoop";

export async function GET() {
  const state = crypto.randomBytes(16).toString("hex");
  const url = buildWhoopAuthUrl(state);
  return NextResponse.redirect(url);
}
