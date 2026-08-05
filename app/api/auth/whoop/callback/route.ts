import { NextRequest, NextResponse } from "next/server";
import { exchangeWhoopCode } from "@/lib/whoop";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.json({ error: `WHOOP denied access: ${error}` }, { status: 400 });
  }
  if (!code) {
    return NextResponse.json({ error: "Missing code param" }, { status: 400 });
  }

  await exchangeWhoopCode(code);

  return NextResponse.redirect(new URL("/dashboard?connected=whoop", req.url));
}
