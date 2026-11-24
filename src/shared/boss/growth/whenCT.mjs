/** A queued post's time as she reads it: "Mon, Nov 30, 6:00 PM" in Central, or the day alone for a day-only post. */
const CT = "America/Chicago";
export function whenCT(at) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(at);
  const d = new Date(day ? `${at}T12:00:00Z` : at);
  if (!Number.isFinite(d.getTime())) return String(at).slice(0, 25);
  const date = new Intl.DateTimeFormat("en-US", { timeZone: day ? "UTC" : CT, weekday: "short", day: "numeric", month: "short" }).format(d);
  return day ? date : `${date}, ${new Intl.DateTimeFormat("en-US", { timeZone: CT, hour: "numeric", minute: "2-digit" }).format(d)}`;
}
