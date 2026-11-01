/**
 * THE SCORECARD'S RULES — ONE MODULE THE BUILD CHECK, THE MONDAY RUN, THE EMAIL AND THE PAGE READ
 * (owner ruling, 1 Nov 2026: "nothing runs unmeasured"; plan https://claude.ai/artifact/NA78ECyBGeB5aHfWkeGqZe).
 *
 * The list is src/shared/boss/scorecard/manifest.json. Each row is an initiative with the result that
 * counts, a code-readable source per floor (a reader id, implemented in scripts/ops/lib/scorecard-readers.mjs),
 * a first floor (day 30) and a real floor (day 60; slow channels say longer), a version B written at
 * build time and an owner. Pure: no I/O here.
 *
 * THE FIVE STATES (judge):
 *   On track          the floor being judged is met
 *   Too early         before the row's first check date (each row's clock starts at its own start date)
 *   Trying version B  first miss: version B is applied (or recorded where no switch exists), clock restarts
 *   Paused            version B missed too: the owning job's own pause switch, never a deletion; one-tap restart
 *   No number         a source could not be read, or a reading has not moved for 3 weeks: broken, never fine
 *
 * THE BUILD CHECK (coverageProblems): every job in the Schedule manifest is in exactly one row's `jobs`
 * or in `exempt` with a kind and a reason. A new job with neither fails tests/scorecard.test.ts.
 */

export const STATES = Object.freeze(["On track", "Too early", "Trying version B", "Paused", "No number"]);
/** Reader ids a row may name. scripts/ops/lib/scorecard-readers.mjs implements exactly these (pinned by the test). */
export const READER_IDS = Object.freeze(["d1", "gsc", "gumroad", "stripe", "airtable", "repo-json", "lp-outcomes", "t2r", "kdp-units", "sum"]);
export const EXEMPT_KINDS = Object.freeze(["system", "helper", "excluded", "parked"]);
export const FLOOR_OPS = Object.freeze([">=", "rising"]);
export const DAY_MS = 86_400_000;

// ─── Dates, on her clock ──────────────────────────────────────────────────────────────────────────

/** "YYYY-MM-DD" in Central time. */
export function centralDay(t = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
}
export function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY_MS);
/** The Monday on or after `day`. */
export function mondayOnOrAfter(day) {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, (8 - dow) % 7);
}
export const isMonday = (day) => new Date(`${day}T12:00:00Z`).getUTCDay() === 1;
/** "29 Dec" — how dates read in her email and on the page. */
export function shortDate(day) {
  if (!day) return "";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}
/** A floor's date: `by` is days from the row's start, or a fixed "YYYY-MM-DD". */
export function floorDate(by, start) {
  if (typeof by === "string") return by;
  return start ? addDays(start, by) : null;
}

// ─── Shape and coverage (the build check) ─────────────────────────────────────────────────────────

function metricProblems(id, key, m) {
  const out = [];
  if (!m || typeof m !== "object") return [`${id}: ${key} floor is missing`];
  if (typeof m.label !== "string" || !m.label.trim()) out.push(`${id}: ${key} has no label (what the number is, in plain words)`);
  if (!READER_IDS.includes(m.reader)) out.push(`${id}: ${key} reader "${m.reader}" is not a reader (one of ${READER_IDS.join(", ")})`);
  if (!(typeof m.by === "number" && m.by > 0) && !(typeof m.by === "string" && /^\d{4}-\d\d-\d\d$/.test(m.by))) out.push(`${id}: ${key} has no check date ("by": days from start, or a date)`);
  if (!m.floor || !FLOOR_OPS.includes(m.floor.op)) out.push(`${id}: ${key} has no floor`);
  else if (m.floor.op === ">=" && typeof m.floor.value !== "number") out.push(`${id}: ${key} floor has no number`);
  if (m.reader === "sum") {
    const parts = m.params?.of;
    if (!Array.isArray(parts) || parts.length < 2) out.push(`${id}: ${key} sums fewer than two sources`);
    else for (const p of parts) if (!READER_IDS.includes(p?.reader) || p.reader === "sum") out.push(`${id}: ${key} sums an unknown source "${p?.reader}"`);
  }
  for (const sql of sqlOf(m)) {
    if (!/^SELECT\b/i.test(sql) || /;|\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH|PRAGMA)\b/i.test(sql)) out.push(`${id}: ${key} SQL must be one read-only SELECT`);
    if (!/\bAS n\b/.test(sql)) out.push(`${id}: ${key} SQL must return one number named n (counts only, never a name)`);
  }
  return out;
}
/** Every SQL string a metric runs (its own and its summed parts). */
export function sqlOf(m) {
  if (m?.reader === "d1") return [String(m.params?.sql ?? "")];
  if (m?.reader === "sum") return (m.params?.of ?? []).flatMap(sqlOf);
  return [];
}

/** What is wrong with the scorecard list, by name. `[]` = clean. Zero rows is a problem. */
export function shapeProblems(sc) {
  const out = [];
  if (!sc || !Array.isArray(sc.rows) || sc.rows.length === 0) return ["NAMED STOP [SCORECARD_EMPTY] the scorecard has no rows: the guard cannot see anything"];
  const businesses = new Set((sc.businesses ?? []).map((b) => b.key));
  const ids = new Set();
  for (const r of sc.rows) {
    const id = r?.id ?? "(no id)";
    if (ids.has(id)) out.push(`${id}: duplicate id`);
    ids.add(id);
    for (const f of ["initiative", "result", "owner"]) if (typeof r[f] !== "string" || !r[f].trim()) out.push(`${id}: ${f} is empty`);
    if (!businesses.has(r.business)) out.push(`${id}: business ${r.business} is not one of the scorecard's businesses`);
    if (!Array.isArray(r.jobs)) out.push(`${id}: jobs must be a list (may be empty)`);
    if (r.start == null && !r.startWhen) out.push(`${id}: no start date and no start condition`);
    if (r.start != null && !/^\d{4}-\d\d-\d\d$/.test(r.start)) out.push(`${id}: start is not a date`);
    if (r.startWhen) out.push(...metricProblems(id, "startWhen", { ...r.startWhen, by: 1, floor: { op: ">=", value: 0 } }));
    out.push(...metricProblems(id, "first", r.first), ...metricProblems(id, "real", r.real));
    if (typeof r.versionB?.text !== "string" || r.versionB.text.trim().length < 8) out.push(`${id}: version B is not written (it is decided at build time)`);
    if (/\b(sent|posted|published|emails? sent|pins? made)\b/i.test(r.result) && !/\bthen\b/i.test(r.result)) out.push(`${id}: the result counts activity, not an outcome`);
  }
  return out;
}

/**
 * THE BUILD CHECK: every Schedule job is in exactly one row's jobs or exempt with a reason; nothing
 * stale. `schedule` is src/shared/boss/schedule/manifest.json. Zero schedule rows is a problem.
 */
export function coverageProblems(sc, schedule) {
  const out = [];
  const jobs = (schedule?.rows ?? []).map((r) => r.id);
  if (jobs.length === 0) return ["NAMED STOP [SCHEDULE_EMPTY] the Schedule has no jobs: the build check cannot see anything"];
  const known = new Set(jobs);
  const owner = new Map();
  for (const r of sc.rows ?? []) for (const j of r.jobs ?? []) {
    if (!known.has(j)) out.push(`${r.id}: names job ${j}, which is not in the Schedule (stale)`);
    if (owner.has(j)) out.push(`${j}: is in two rows (${owner.get(j)} and ${r.id})`);
    owner.set(j, r.id);
  }
  const exempt = sc.exempt ?? {};
  for (const [j, e] of Object.entries(exempt)) {
    if (!known.has(j)) out.push(`exempt ${j}: not in the Schedule any more (stale exemption)`);
    if (owner.has(j)) out.push(`exempt ${j}: is also in row ${owner.get(j)}`);
    if (!EXEMPT_KINDS.includes(e?.kind)) out.push(`exempt ${j}: kind "${e?.kind}" is not one of ${EXEMPT_KINDS.join(", ")}`);
    if (typeof e?.why !== "string" || e.why.trim().length < 20) out.push(`exempt ${j}: no reason written`);
  }
  for (const j of jobs) if (!owner.has(j) && !exempt[j]) out.push(`${j}: runs with no scorecard row and no exemption — add a row (result, source, floors, version B) or an exempt reason to src/shared/boss/scorecard/manifest.json`);
  for (const r of sc.rows ?? []) for (const p of r.pause ?? []) if (typeof p === "string" && !known.has(p)) out.push(`${r.id}: pauses ${p}, which is not in the Schedule`);
  return out;
}

// ─── Pause switches (derived from the Schedule, never a second list) ──────────────────────────────

/**
 * The switches that pause a row: its `pause` list when it has one (job ids, or { outreach: key }),
 * else every job in `jobs`. A job pauses through its OWN switch: a Boss OS duty → the duty's pause; a
 * GitHub workflow → disable the workflow (enable restarts it); anything else → recorded, by hand.
 * Never a deletion.
 */
export function pauseTargets(row, schedule) {
  const byId = new Map((schedule?.rows ?? []).map((r) => [r.id, r]));
  const out = [];
  for (const p of row.pause ?? row.jobs ?? []) {
    if (p && typeof p === "object" && p.outreach) { out.push({ kind: "outreach", key: p.outreach, name: `outreach for ${p.outreach}` }); continue; }
    const j = byId.get(p);
    if (!j) continue;
    const t = j.trigger ?? {};
    if (t.duty && !(t.repo && t.file)) out.push({ kind: "duty", duty: t.duty, job: j.id, name: j.name });
    else if (t.repo && /^\.github\/workflows\//.test(t.file ?? "")) out.push({ kind: "workflow", repo: t.repo, file: t.file.replace(/^\.github\/workflows\//, ""), job: j.id, name: j.name });
    else out.push({ kind: "record", job: j.id, name: j.name });
  }
  return out;
}

// ─── Judging ──────────────────────────────────────────────────────────────────────────────────────

/** A stop's sentence without its code (the code stays in the run's log and on the record). */
export const plainStop = (e) => String(e ?? "").replace(/^NAMED STOP \[[A-Z_]+\]\s*/, "");

/** Why a row has no number, in words for her email: never a code, a key name or a path. */
export function noNumberWords(result) {
  const v = result.values ?? {};
  if (["first", "real"].some((k) => v[k]?.stuck)) return "its number has not moved in three weeks, so the measuring is probably broken";
  if (["first", "real"].some((k) => /\[KEY_MISSING\]|\[KEY_REFUSED\]/.test(v[k]?.error ?? ""))) return "a key it needs is missing or refused";
  return "the number could not be read this week";
}

export function emptyRecord() {
  return { start: null, bOn: null, missed: null, pausedOn: null, restartToken: null, restartedOn: null, history: [] };
}

/** A metric's judged value: the reading, or its change over `delta` days from the recorded history. */
export function metricValue(metric, key, raw, history, today) {
  if (raw == null || !Number.isFinite(raw)) return { value: null };
  if (!metric.delta) return { value: raw };
  const cutoff = addDays(today, -metric.delta);
  const past = [...(history ?? [])].reverse().find((h) => h.week <= cutoff && Number.isFinite(h[`${key}Raw`]));
  if (!past) return { value: null, note: `needs ${Math.round(metric.delta / 7)} weeks of readings` };
  return { value: Math.round((raw - past[`${key}Raw`]) * 10) / 10 };
}

/** Is `value` at or above the floor? `rising` compares with the value four weeks earlier. null = cannot tell. */
export function meets(metric, key, value, history, today) {
  if (value == null) return null;
  if (metric.floor.op === ">=") return value >= metric.floor.value;
  const cutoff = addDays(today, -28);
  const past = [...(history ?? [])].reverse().find((h) => h.week <= cutoff && Number.isFinite(h[key]));
  if (!past) return null;
  return value > past[key];
}

/**
 * A reading that has not moved for `weeks` weekly readings in a row means the measuring broke.
 * A rolling-window count sitting at 0 is "nothing happened" — the floor judges that, so it is not
 * "stuck"; a snapshot or a non-zero count that never moves is.
 */
export function isStuck(metric, key, raw, history, weeks = 3) {
  if (raw == null || (!metric.delta && raw === 0)) return false;
  const last = (history ?? []).slice(-weeks);
  return last.length >= weeks && last.every((h) => h[`${key}Raw`] === raw);
}

export function floorWords(metric) {
  if (metric.floor.op === "rising") return "rising";
  return `${metric.floor.value}${metric.unit ?? ""}`;
}
export function valueWords(metric, v) {
  if (v == null) return "—";
  return `${v}${metric.unit ?? ""}`;
}

/**
 * Judge one row on `today`. `reading` = { first: { raw, error? }, real: { raw, error? }, started?: { raw, error? } }.
 * Returns { state, note, next, actions[], record } — `record` is what Boss OS keeps for next week
 * (history gains this week's line). Pure.
 */
export function judge({ row, record, reading, today, defaults = {} }) {
  const bDays = defaults.versionBDays ?? 30;
  const stuckWeeks = defaults.stuckWeeks ?? 3;
  const rec = { ...emptyRecord(), ...(record ?? {}), history: [...(record?.history ?? [])] };
  if (!rec.start) {
    if (row.startWhen) {
      const s = reading.started;
      if (s?.raw && /^\d{4}-\d\d-\d\d/.test(String(s.raw))) rec.start = String(s.raw).slice(0, 10);
    } else rec.start = row.start;
  }
  const actions = [];
  const vals = {};
  for (const key of ["first", "real"]) {
    const m = row[key];
    const r = reading[key] ?? {};
    const mv = r.error ? { value: null } : metricValue(m, key, r.raw, rec.history, today);
    vals[key] = { raw: r.raw ?? null, value: mv.value, error: r.error ?? null, note: mv.note ?? null, stuck: !r.error && isStuck(m, key, r.raw ?? null, rec.history, stuckWeeks) };
  }
  let state; let note = ""; let next = null;
  const firstBy = floorDate(row.first.by, rec.start);
  const realBy = floorDate(row.real.by, rec.start);

  if (!rec.start) {
    if (reading.started?.error) { state = "No number"; note = `Could not tell whether it has started: ${plainStop(reading.started.error)}`; }
    else { state = "Too early"; note = `Too early until ${row.startWhen?.label ?? "it starts"}.`; }
  } else if (rec.pausedOn) {
    state = "Paused"; note = `Paused on ${shortDate(rec.pausedOn)}; nothing deleted.`;
  } else {
    const broken = ["first", "real"].filter((k) => vals[k].error || vals[k].stuck);
    if (broken.length) {
      state = "No number";
      note = broken.map((k) => (vals[k].error ? `${row[k].label}: ${plainStop(vals[k].error)}` : `${row[k].label} has not changed in ${stuckWeeks} weeks`)).join("; ");
    } else {
      // Which floor is being judged today, and by when.
      let key = null; let due = null;
      if (rec.bOn) { key = rec.missed ?? "first"; due = addDays(rec.bOn, bDays); }
      else if (today >= realBy) { key = "real"; due = realBy; }
      else if (today >= firstBy) { key = "first"; due = firstBy; }
      if (!key) { state = "Too early"; next = firstBy; note = `First judged ${shortDate(firstBy)}.`; }
      else if (rec.bOn && today < due) { state = "Trying version B"; next = due; note = `Version B since ${shortDate(rec.bOn)}; judged again ${shortDate(due)}.`; }
      else {
        const v = vals[key].value;
        const ok = meets(row[key], key, v, rec.history, today);
        if (ok === null) {
          state = "No number";
          note = `${row[key].label}: ${vals[key].note ?? "nothing to measure in the window"}`;
        } else if (ok) {
          state = "On track"; next = mondayOnOrAfter(addDays(today, 1));
          if (rec.bOn) { note = `Version B worked (${valueWords(row[key], v)} ${row[key].label}).`; rec.missed = null; rec.bOn = null; rec.keptB = today; }
        } else if (!rec.bOn) {
          state = "Trying version B"; rec.bOn = today; rec.missed = key; next = addDays(today, bDays);
          note = `${valueWords(row[key], v)} ${row[key].label} (floor ${floorWords(row[key])}). Switched to version B today: ${row.versionB.text} Judged again ${shortDate(next)}.`;
          actions.push({ kind: "versionB", text: row.versionB.text, switch: row.versionB.switch ?? "record" });
        } else {
          state = "Paused"; rec.pausedOn = today;
          note = `${valueWords(row[key], v)} ${row[key].label} (floor ${floorWords(row[key])}), after version B. Paused, nothing deleted.`;
          actions.push({ kind: "pause" });
        }
      }
    }
  }
  const line = { week: today, state, first: vals.first.value, real: vals.real.value, firstRaw: vals.first.raw, realRaw: vals.real.raw, note };
  rec.history = [...rec.history.filter((h) => h.week !== today), line].slice(-26);
  return { id: row.id, state, note, next, actions, values: vals, record: rec };
}

// ─── The Monday email section (owner-email: one section in Simone's morning email) ───────────────

/** Rows that need a look this week: a switch or a pause made today, or no number. */
export function needsLook(results, today) {
  return results.filter((r) => r.state === "No number" || (r.actions?.length && r.record?.history?.at(-1)?.week === today));
}

/**
 * `{ title, lines }` for the morning section. Quiet weeks are one line. `links(row)` gives
 * { open, restart? } absolute URLs. Lines name the initiative, the number against its floor and
 * what the system did; never a code, a path or an id.
 */
export function emailSection(results, rows, { today, links }) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const look = needsLook(results, today);
  const onTrack = results.filter((r) => r.state === "On track").length;
  const early = results.filter((r) => r.state === "Too early").length;
  const trying = results.filter((r) => r.state === "Trying version B" && !look.includes(r)).length;
  const paused = results.filter((r) => r.state === "Paused" && !look.includes(r)).length;
  const counts = [`${onTrack} on track`];
  if (look.length) counts.push(`${look.length} need${look.length === 1 ? "s" : ""} a look`);
  const title = `📊 Scorecard: ${counts.join(", ")}`;
  const rest = [early ? `${early} too early to judge` : null, trying ? `${trying} trying version B` : null, paused ? `${paused} paused` : null].filter(Boolean);
  if (!look.length) return { title, lines: [`Nothing needs a look this week${rest.length ? ` (${rest.join(", ")})` : ""}. Full list on the Scorecard page.`] };
  const lines = look.map((r) => {
    const row = byId.get(r.id);
    const l = links(row);
    if (r.state === "Paused") return { text: `Paused · ${row.initiative}: ${r.note}`, links: [...(l.restart ? [{ label: "Restart it", url: l.restart }] : []), { label: "Open", url: l.open }] };
    if (r.state === "No number") return { text: `No number · ${row.initiative}: ${noNumberWords(r)}. Sent to repairs.`, links: [{ label: "Open", url: l.open }] };
    return { text: `Trying version B · ${row.initiative}: ${r.note}`, links: [{ label: "Open on Scorecard", url: l.open }] };
  });
  if (rest.length || onTrack) lines.push(`Everything else is on track or too early to judge${rest.length ? ` (${rest.join(", ")})` : ""}. Full list on the Scorecard page.`);
  return { title, lines };
}

// ─── The page ─────────────────────────────────────────────────────────────────────────────────────

/** Rows grouped by business in the scorecard's order (brokerage first, West Peek Ventures second…). */
export function groupByBusiness(sc) {
  return (sc.businesses ?? []).map((b) => ({ ...b, rows: sc.rows.filter((r) => r.business === b.key) })).filter((g) => g.rows.length);
}

/** The last eight weekly values of a metric, oldest first (null where nothing was read). */
export function trend(record, key = "first", weeks = 8) {
  return (record?.history ?? []).slice(-weeks).map((h) => (Number.isFinite(h[key]) ? h[key] : null));
}

/** The page's one summary line. */
export function summaryLine(states) {
  const n = (s) => states.filter((x) => x === s).length;
  const parts = STATES.map((s) => [s, n(s)]).filter(([, c]) => c > 0).map(([s, c]) => `${c} ${s.toLowerCase()}`);
  return parts.length ? `${states.length} initiatives: ${parts.join(", ")}.` : `${states.length} initiatives, not read yet.`;
}

// ─── Kendra's monthly stray sweep ─────────────────────────────────────────────────────────────────

/**
 * Everything running that the Scorecard does not cover. `labels` = launchd labels on her Mac;
 * `repoFiles` = [{ repo, files: [{ file }] }] scheduled workflows and Worker crons per repo. A thing
 * is a stray when no Schedule row cites it, or its Schedule row is in no scorecard row and not
 * exempt. Returns [{ key, name, where }] — each becomes a default row (No number until wired). Pure.
 */
export function findStrays({ schedule, scorecard, labels = [], repoFiles = [] }) {
  const covered = new Set([...(scorecard.rows ?? []).flatMap((r) => r.jobs ?? []), ...Object.keys(scorecard.exempt ?? {})]);
  const out = [];
  const seen = new Set();
  const add = (key, name, where) => { if (!seen.has(key)) { seen.add(key); out.push({ key, name, where }); } };
  for (const r of schedule.rows ?? []) if (!covered.has(r.id)) add(`schedule:${r.id}`, r.name, "the Schedule");
  for (const l of labels) {
    const row = (schedule.rows ?? []).find((r) => (r.trigger?.launchd ?? []).includes(l));
    if (!row) add(`launchd:${l}`, l, "a job on her Mac");
  }
  for (const { repo, files } of repoFiles) for (const f of files ?? []) {
    const row = (schedule.rows ?? []).find((r) => r.trigger?.repo === repo && r.trigger?.file === f.file);
    if (!row) add(`cron:${repo}:${f.file}`, `${repo} ${f.file.replace(/^\.github\/workflows\//, "")}`, "a scheduled run in a repo");
  }
  return out;
}
