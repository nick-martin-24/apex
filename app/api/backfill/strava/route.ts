import { NextRequest, NextResponse } from "next/server";
import { listStravaActivities, upsertStravaActivity } from "@/lib/strava";

// Visit /api/backfill/strava?limit=100 to pull existing rides in.
// Uses the summary list endpoint (fast, one call per 200 activities) rather
// than fetching full detail per activity, so weighted_average_watts (Normalized
// Power) won't be populated for backfilled rides — only what Strava's summary
// includes (avg watts, avg/max HR, distance, elevation, moving time, speed).
export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "100");
  const perPage = 200;
  let page = 1;
  let imported = 0;
  let skippedNonRide = 0;

  while (imported + skippedNonRide < limit) {
    const batch = await listStravaActivities(page, perPage);
    if (!Array.isArray(batch) || batch.length === 0) break;

    for (const activity of batch) {
      if (activity.type === "Ride" || activity.type === "VirtualRide") {
        await upsertStravaActivity(activity);
        imported++;
      } else {
        skippedNonRide++;
      }
      if (imported + skippedNonRide >= limit) break;
    }

    if (batch.length < perPage) break; // reached the end of the athlete's history
    page++;
  }

  return NextResponse.json({ imported, skippedNonRide });
}
