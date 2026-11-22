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
import os from "node:os";
import { pathToFileURL } from "node:url";

/**
 * Hours to add to a Central hour to get the Mac's local hour (both zones' DST included).
 *
 * NOT AT THE INSTANT ALONE (1 Nov 2026). Eastern leaves daylight time at 06:00 UTC and Central an
 * hour later, so between 06:00 and 07:00 UTC on a clock-change night the two zones read the same
 * hour: an install in that hour wrote every plist unshifted, and each job would have fired an hour
 * early for the whole winter. The offset is read at noon UTC of the day `now` falls in and of the
 * next day, when both zones are settled; if those disagree (a zone that changes on a different
 * date), the next day's wins, because that is the clock the jobs will run under.
 */
export function centralToLocalOffset(now = new Date(), localTz = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const noon = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12));
  const today = rawOffset(noon(now), localTz);
  const tomorrow = rawOffset(noon(new Date(now.getTime() + 86_400_000)), localTz);
  return today === tomorrow ? today : tomorrow;
}

/** The offset at exactly this instant: wrong for the hour between the two zones' clock changes. */
export function rawOffset(now = new Date(), localTz = Intl.DateTimeFormat().resolvedOptions().timeZone) {
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

/**
 * THE MAC'S DAY (her ruling 21 Nov 2026, Central, every day): every job's command runs behind seq-bin's
 * `mac-window`, with the class its Schedule row names (`macWindow`: HEAVY 22:00-06:30 and stopped at
 * 06:55, MORNING and ANY never 07:00-09:59, LIGHT 10:00-21:59). Written here because every installer
 * (boss-os, seq-bin, how-we-know) already passes each plist through this file before launchd reads it,
 * so a new job cannot be installed without its window. A job woken outside its window waits (one
 * pending record, then mac-window catch-up starts it once). Interval and KeepAlive jobs get --no-wait.
 */
export const MAC_CLASSES = ["HEAVY", "MORNING", "LIGHT", "ANY"];
export const ONE_SHOT = /-once$|\.oneshot\./;

/** label -> class from the Schedule manifest's mac rows (`macWindow`, a class or { label: class }). Pure. */
export function macWindows(manifest) {
  const out = new Map();
  for (const r of manifest?.rows ?? []) {
    if (r.system !== "mac" || !r.macWindow) continue;
    for (const l of [].concat(r.trigger?.launchd ?? [])) {
      const c = typeof r.macWindow === "string" ? r.macWindow : r.macWindow[l];
      if (c) out.set(l, c);
    }
  }
  return out;
}

/** The plist text with its command behind `mac-window run <class> <label>`; idempotent. Pure. */
export function guardPlist(text, cls, bin) {
  const label = /<key>Label<\/key>\s*<string>([^<]+)<\/string>/.exec(text)?.[1];
  if (!label || !MAC_CLASSES.includes(cls)) return text;
  const unguarded = text.replace(/(<key>ProgramArguments<\/key>\s*<array>)\s*<string>[^<]*\/mac-window<\/string>[\s\S]*?<string>--<\/string>/, "$1");
  const poll = /<key>(StartInterval|KeepAlive)<\/key>/.test(text) ? "<string>--no-wait</string>" : "";
  const prefix = `\n    <string>${bin}</string><string>run</string><string>${cls}</string><string>${label}</string>${poll}<string>--</string>`;
  return unguarded.replace(/(<key>ProgramArguments<\/key>\s*<array>)/, `$1${prefix}`);
}

// Run as a CLI by its REAL path: a caller reaching it through a symlink (/var -> /private/var, a linked
// checkout) used to fail this test silently, so the plist was loaded unshifted and exit was 0.
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const file = process.argv[2];
  const offset = centralToLocalOffset();
  let text = fs.readFileSync(file, "utf8");
  if (!text.includes("<!-- central-shifted -->")) {
    text = shiftPlist(text, offset).replace("<plist version=\"1.0\">", "<!-- central-shifted -->\n<plist version=\"1.0\">");
    if (offset) console.log(`  (Central hours moved ${offset > 0 ? "+" : ""}${offset}h to this Mac's zone)`);
  }
  const label = /<key>Label<\/key>\s*<string>([^<]+)<\/string>/.exec(text)?.[1] ?? "";
  if (!ONE_SHOT.test(label)) {
    const manifest = JSON.parse(fs.readFileSync(new URL("../../src/shared/boss/schedule/manifest.json", import.meta.url), "utf8"));
    const cls = macWindows(manifest).get(label);
    if (cls) text = guardPlist(text, cls, process.env.MAC_WINDOW_BIN || `${os.homedir()}/bin/mac-window`);
    else console.log(`  NOTE [NO_MAC_WINDOW] ${label} has no macWindow on its Schedule row; it runs unguarded (npm run mac-day:check fails it)`);
  }
  fs.writeFileSync(file, text);
}
