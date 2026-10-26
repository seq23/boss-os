#!/usr/bin/env node
/**
 * EVERY SCHEDULE IN THE INSTALLER IS CENTRAL TIME, WHATEVER ZONE THE MAC IS IN (26 Oct 2026).
 *
 * launchd reads StartCalendarInterval in the Mac's own zone. Her Mac runs on Eastern, so every job
 * written "06:40 Central" fired at 05:40 Central, an hour early, and the Worker's staleness rule had to
 * learn to forgive early runs. The installer still writes Central hours (they are what every comment,
 * duty row and screen says); `lint_plist` runs this on each plist before it is loaded, and it moves
 * each Hour (and the Weekday or Day, when the move crosses midnight) to the Mac's zone.
 *
 *   node scripts/ops/plist-central.mjs <file.plist>     # rewrite in place; prints the shift
 */
import fs from "node:fs";

/** Hours to add to a Central hour to get the Mac's local hour, now (both zones' DST included). */
export function centralToLocalOffset(now = new Date(), localTz = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const off = (tz) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(now);
    const g = (t) => Number(p.find((x) => x.type === t)?.value);
    return (Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute")) - now.getTime()) / 3_600_000;
  };
  return Math.round(off(localTz) - off("America/Chicago"));
}

/** The plist text with each StartCalendarInterval Hour shifted by `offset` hours. Pure. */
export function shiftPlist(text, offset) {
  if (!offset) return text;
  const start = text.indexOf("<key>StartCalendarInterval</key>");
  if (start === -1) return text;
  const head = text.slice(0, start);
  let rest = text.slice(start);
  // The interval is either an <array> of <dict>s or one <dict>: the block ends where that closes.
  const isArray = /^<key>StartCalendarInterval<\/key>\s*<array>/.test(rest);
  const close = isArray ? rest.indexOf("</array>") : rest.indexOf("</dict>") + "</dict>".length;
  const end = close < 0 ? -1 : close;
  const block = end === -1 ? rest : rest.slice(0, end);
  const shifted = block.replace(/<dict>([\s\S]*?)<\/dict>/g, (whole, inner) => {
    const h = /<key>Hour<\/key>\s*<integer>(\d+)<\/integer>/.exec(inner);
    if (!h) return whole;
    let hour = Number(h[1]) + offset;
    let dayShift = 0;
    if (hour >= 24) { hour -= 24; dayShift = 1; }
    if (hour < 0) { hour += 24; dayShift = -1; }
    let out = inner.replace(h[0], `<key>Hour</key><integer>${hour}</integer>`);
    if (dayShift) {
      out = out.replace(/<key>Weekday<\/key>\s*<integer>(\d+)<\/integer>/, (_, w) => `<key>Weekday</key><integer>${(Number(w) + dayShift + 7) % 7}</integer>`);
      out = out.replace(/<key>Day<\/key>\s*<integer>(\d+)<\/integer>/, (_, d) => `<key>Day</key><integer>${Math.max(1, Number(d) + dayShift)}</integer>`);
    }
    return `<dict>${out}</dict>`;
  });
  return head + shifted + (end === -1 ? "" : rest.slice(end));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  const offset = centralToLocalOffset();
  const before = fs.readFileSync(file, "utf8");
  if (before.includes("<!-- central-shifted -->")) process.exit(0);
  const after = shiftPlist(before, offset).replace("<plist version=\"1.0\">", "<!-- central-shifted -->\n<plist version=\"1.0\">");
  fs.writeFileSync(file, after);
  if (offset) console.log(`  (Central hours moved ${offset > 0 ? "+" : ""}${offset}h to this Mac's zone)`);
}
