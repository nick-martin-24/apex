// Vercel's serverless functions run in UTC by default, which made "today"
// roll over ~4-5 hours before actual Eastern midnight (e.g. 8pm ET already
// showing as the next day). This returns the calendar date in America/New_York
// for a given instant (defaults to now), which everywhere server-side "today"
// logic should use instead of new Date().toISOString().
export function getEasternDateString(d: Date = new Date()): string {
  // en-CA locale formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
