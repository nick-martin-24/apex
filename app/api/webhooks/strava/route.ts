import { NextRequest, NextResponse } from "next/server";
import { getStravaActivity, getStravaActivityStreams, upsertStravaActivity, upsertStravaStreams } from "@/lib/strava";
import { matchActivityToPlannedWorkout } from "@/lib/planMatching";

// Strava calls this once when you register the subscription, to verify you own the endpoint
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.OAUTH_STATE_SECRET) {
    return NextResponse.json({ "hub.challenge": challenge });
  }
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

// Strava calls this whenever an activity is created/updated/deleted
export async function POST(req: NextRequest) {
  const event = await req.json();

  // Only care about new/updated activities, and only rides
  if (event.object_type === "activity" && (event.aspect_type === "create" || event.aspect_type === "update")) {
    const activityId = event.object_id;
    const detail = await getStravaActivity(activityId);

    if (detail.type === "Ride" || detail.type === "VirtualRide") {
      await upsertStravaActivity(detail);
      await matchActivityToPlannedWorkout(String(detail.id), detail.start_date);

      const streams = await getStravaActivityStreams(activityId).catch(() => null);
      if (streams) await upsertStravaStreams(activityId, streams);
    }
  }

  // Strava requires a 200 within 2 seconds or it'll retry
  return NextResponse.json({}, { status: 200 });
}
