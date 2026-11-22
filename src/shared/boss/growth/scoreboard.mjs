/**
 * THE GROWTH SCOREBOARD — one way to count across her six growth businesses (Growth Director,
 * 21 Nov 2026; plan: the Shoestring Growth Plan).
 *
 * The measures live in the Scorecard's own list (src/shared/boss/scorecard/manifest.json
 * `scoreboard`); each names a Scorecard reader (scripts/ops/lib/scorecard-readers.mjs), so there is
 * ONE counting stack. scripts/ops/growth-scoreboard.mjs reads them daily in the cloud and posts here
 * shaped readings to D1 (growth_readings, migration 0372). This file is pure: the rules, the shape
 * check, and the one summary the Director, the page and the email all read.
 *
 * RULE 0 SHAPES:
 *   - a measure that could not be read is stored with value NULL and `unread: "not read: <reason>"`,
 *     never 0, never last week's number;
 *   - a business whose every measure is unread is `state: "no data"`, and the Director holds it;
 *   - a business with too few visits to judge a format is `state: "too little data"` (under
 *     MIN_VISITS_FOR_TESTS a month), a separate hold.
 *
 * PRIVACY PROMISES BEAT THE COUNT. KeepMyProof promises no analytics (spry brain, 6 Nov 2026): it is
 * counted only from store numbers (RevenueCat), Google's own search report and the in-app "How did you
 * hear about us?" answer — never a site visit counter, never a tagged link (NO_TRACKING). Peace Be
 * Still's app has no analytics SDK; its site counts visits in totals (its privacy page says so).
 */
import { READER_IDS } from "../scorecard/scorecard.mjs";

export const KINDS = Object.freeze(["money", "sales", "installs", "requests", "visits"]);
/** No format test on a channel under this many visits a month (hostile review: "no tests on noise"). */
export const MIN_VISITS_FOR_TESTS = 50;
/** Businesses whose privacy promise forbids visit tracking and tagged links, and the readers they may use. */
export const NO_TRACKING = Object.freeze({ keepmyproof: Object.freeze(["revenuecat", "gsc", "none"]) });
export const UNREAD_PREFIX = "not read: ";

const slug = (s) => typeof s === "string" && /^[a-z0-9][a-z0-9-]*$/.test(s);

/** What is wrong with the scoreboard block, by name. `[]` = clean. Zero measures is a problem. */
export function scoreboardProblems(manifest) {
  const sb = manifest?.scoreboard;
  if (!sb) return ["NAMED STOP [SCOREBOARD_MISSING] the Scorecard manifest has no scoreboard block"];
  const out = [];
  const biz = new Map((sb.businesses ?? []).map((b) => [b.key, b]));
  if (!biz.size) out.push("the scoreboard lists no business");
  const measures = sb.measures ?? [];
  if (!measures.length) out.push("NAMED STOP [SCOREBOARD_EMPTY] the scoreboard has no measures: it would count nothing");
  const seen = new Set();
  for (const m of measures) {
    const id = m?.id ?? "(no id)";
    if (!slug(m?.id)) out.push(`${id}: id is not a slug`);
    if (seen.has(m?.id)) out.push(`${id}: listed twice`);
    seen.add(m?.id);
    const b = biz.get(m?.business);
    if (!b) out.push(`${id}: business "${m?.business}" is not on the scoreboard`);
    else if (b.paused) out.push(`${id}: ${b.label} is paused, so nothing is measured or queued for it`);
    if (!KINDS.includes(m?.kind)) out.push(`${id}: kind "${m?.kind}" is not one of ${KINDS.join(", ")}`);
    if (!slug(m?.channel)) out.push(`${id}: no channel`);
    if (!/^(all|[a-z]{2})$/.test(String(m?.language))) out.push(`${id}: language must be "all" or a two-letter code`);
    if (m?.reader === "none") { if (!m?.why) out.push(`${id}: an uncounted measure must say why`); }
    else if (!READER_IDS.includes(m?.reader) || m?.reader === "sum") out.push(`${id}: reader "${m?.reader}" is not a Scorecard reader`);
    const allowed = NO_TRACKING[m?.business];
    if (allowed && !allowed.includes(m?.reader)) out.push(`${id}: ${m?.business} promises no analytics; reader "${m?.reader}" is not allowed (only ${allowed.join(", ")})`);
    if (JSON.stringify(m ?? {}).includes("@")) out.push(`${id}: carries an address`);
  }
  // Porch & Party's requests are counted first (the Christmas season ends mid-December).
  if (measures[0] && !(measures[0].business === "porch-and-party" && measures[0].kind === "requests")) out.push("Porch & Party's requests must be the first measure");
  return out;
}

/** The measures to read: every measure of every business that is not paused. */
export function activeMeasures(manifest) {
  const paused = new Set((manifest?.scoreboard?.businesses ?? []).filter((b) => b.paused).map((b) => b.key));
  return (manifest?.scoreboard?.measures ?? []).filter((m) => !paused.has(m.business));
}

/** One stored reading from a reader's result ({ raw, error, note }). An error is "not read", never 0. */
export function toReading(m, result, day) {
  const base = { day, measure: m.id, business: m.business, kind: m.kind, channel: m.channel, language: m.language };
  if (m.reader === "none") return { ...base, value: null, unread: UNREAD_PREFIX + String(m.why).slice(0, 200) };
  const err = result?.error ? String(result.error).replace(/^NAMED STOP \[[A-Z0-9_]+\]\s*/, "") : null;
  const v = result?.raw;
  if (err || v == null || !Number.isFinite(Number(v))) return { ...base, value: null, unread: UNREAD_PREFIX + (err ?? "the source answered without a number").slice(0, 200) };
  return { ...base, value: Number(v), unread: result?.note ? String(result.note).slice(0, 200) : null };
}

/** What is wrong with posted readings, by name (the Worker refuses on any). */
export function readingProblems(body, manifest) {
  const ids = new Map((manifest?.scoreboard?.measures ?? []).map((m) => [m.id, m]));
  const out = [];
  if (!/^\d{4}-\d\d-\d\d$/.test(String(body?.day))) out.push("no day");
  if (!Array.isArray(body?.readings) || !body.readings.length) return [...out, "no readings (a run that read nothing is a named stop, not a record)"];
  for (const r of body.readings) {
    const m = ids.get(r?.measure);
    if (!m) { out.push(`unknown measure ${r?.measure}`); continue; }
    if (r.business !== m.business) out.push(`${r.measure}: business does not match the list`);
    if (r.value === null) { if (!String(r.unread ?? "").startsWith(UNREAD_PREFIX)) out.push(`${r.measure}: no number and no "not read" reason`); }
    else if (typeof r.value !== "number" || !Number.isFinite(r.value)) out.push(`${r.measure}: value is not a number`);
    if (JSON.stringify(r).includes("@")) out.push(`${r.measure}: carries an address`);
  }
  return out;
}

/**
 * The one summary per business, from the newest reading of each measure (and, when given, the
 * readings from about 28 days before). Every reader — Director, page, email — uses this.
 *   { key, label, paused, state: "read" | "no data" | "too little data" | "paused", totals: {kind: n|null},
 *     channels: [{ channel, language, kind, value, before, unread }], unread: [measure ids] }
 */
export function summarize(manifest, latest, before = []) {
  const prev = new Map(before.map((r) => [r.measure, r]));
  const now = new Map(latest.map((r) => [r.measure, r]));
  return (manifest?.scoreboard?.businesses ?? []).map((b) => {
    if (b.paused) return { key: b.key, label: b.label, paused: b.paused, state: "paused", totals: {}, channels: [], unread: [] };
    const ms = (manifest.scoreboard.measures ?? []).filter((m) => m.business === b.key);
    const channels = ms.map((m) => {
      const r = now.get(m.id);
      return { measure: m.id, label: m.label, channel: m.channel, language: m.language, kind: m.kind, value: r ? r.value : null,
        before: prev.get(m.id)?.value ?? null, unread: r ? r.unread && r.value === null ? r.unread : null : `${UNREAD_PREFIX}no reading yet` };
    });
    const totals = {};
    for (const k of KINDS) {
      const read = channels.filter((c) => c.kind === k && c.value !== null && c.channel !== "untagged");
      // An "all" channel is the total; otherwise the channels add up.
      const all = read.find((c) => c.channel === "all");
      totals[k] = all ? all.value : read.length ? read.reduce((a, c) => a + c.value, 0) : null;
    }
    const readAny = channels.some((c) => c.value !== null);
    const visits = totals.visits ?? 0;
    const state = !readAny ? "no data" : visits < MIN_VISITS_FOR_TESTS ? "too little data" : "read";
    return { key: b.key, label: b.label, paused: null, state, totals, channels, unread: channels.filter((c) => c.value === null).map((c) => c.measure) };
  });
}
