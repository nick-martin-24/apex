# Apex — Strava + WHOOP integration (milestone 1)

## What's here
- OAuth connect flow for Strava and WHOOP (`/api/auth/strava`, `/api/auth/whoop`)
- Webhook receivers that write new activities/recovery data straight into Postgres
- A bare-bones `/dashboard` page to confirm both connections and see recent data

## Setup

1. **Database**: create a free Postgres instance (Supabase or Neon both work), then run `schema.sql` against it.
2. **Strava app**: register at https://www.strava.com/settings/api. Set the "Authorization Callback Domain" to your domain (e.g. `localhost` for local dev, or your deployed domain).
3. **WHOOP app**: register at https://developer.whoop.com (approval may take a bit). Set the redirect URI to match `WHOOP_REDIRECT_URI`.
4. Copy `.env.example` to `.env.local` and fill in all values. `OAUTH_STATE_SECRET` can be any random string — it's also reused as the Strava webhook verify token below.
5. `npm install`
6. `npm run dev`
7. Visit `/dashboard` and click "Connect" for each provider.

## Registering the Strava webhook subscription (one-time, after deploying)

Strava webhooks require a publicly reachable HTTPS URL — this step won't work against `localhost`, so do it after deploying (e.g. to Vercel).

```bash
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=YOUR_STRAVA_CLIENT_ID \
  -F client_secret=YOUR_STRAVA_CLIENT_SECRET \
  -F callback_url=https://your-domain.com/api/webhooks/strava \
  -F verify_token=YOUR_OAUTH_STATE_SECRET
```

Strava will immediately hit your `/api/webhooks/strava` GET endpoint to verify it — that's already handled in the code. If it succeeds, you'll get back a subscription `id`. From then on, any new/updated ride you upload to Strava will automatically flow into your `activities` table.

## Registering the WHOOP webhook

Configure your webhook URL (`https://your-domain.com/api/webhooks/whoop`) directly in the WHOOP developer dashboard for your app — no curl step needed. Recommended to add signature verification (`X-WHOOP-Signature` header, HMAC-SHA256 with your webhook secret) before going to production; stubbed out for now with a comment in the route.

## What's deliberately not here yet
- Streams (`getStravaActivityStreams`) are fetched on webhook but not persisted — add a table once the plan-assessment feature needs per-second power/HR.
- No auth/login system — this is single-user, so tokens are stored keyed by provider only, not by user.
- No plan engine, AI coach, nutrition, or maintenance tracking — next milestones per the roadmap.

## Deploying
Vercel is the path of least resistance for Next.js + gives you HTTPS for free, which both webhook registrations require.
