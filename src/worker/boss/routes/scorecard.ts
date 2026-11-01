import { Hono } from "hono";
import type { Context } from "hono";
import type { Env, Vars } from "../env";
import { ok, badRequest } from "../lib/http";
import { getSetting, setSetting } from "../lib/settings";
import { audit } from "../lib/audit";
import { pauseDuty } from "../duties/ownerEdits";
import scorecard from "../../../shared/boss/scorecard/manifest.json";
import schedule from "../../../shared/boss/schedule/manifest.json";
import { STATES, centralDay, pauseTargets } from "../../../shared/boss/scorecard/scorecard.mjs";

/**
 * THE SCORECARD'S RECORD (owner ruling, 1 Nov 2026: "nothing runs unmeasured").
 *
 * The rows are src/shared/boss/scorecard/manifest.json. What each row has done — its state, its
 * clock, version B, a pause, and its weekly history — is kept here (setting `scorecard_state`),
 * written by the Monday run on her Mac (scripts/ops/scorecard-monday.mjs) and read by the Scorecard
 * page (☰ More → Scorecard).
 *
 *   GET  /         { state, strays }          state null when no run has been recorded
 *   POST /run      the Monday run's results (refused when a row is unknown or a value is not a number)
 *   POST /strays   Kendra's monthly sweep: things running with no row get a default row here
 *   POST /restarted  the Mac switched a restarted row's workflows back on
 *
 * RESTART is a one-tap link in her email (`/tap/sc…`, routes/lpTap.ts → scorecardTap*): a GET only
 * shows a page that posts itself; the POST un-pauses the row's duties and outreach here and leaves
 * its GitHub workflows for the Mac's next daily run (the Worker holds no GitHub key).
 */
export const scorecardRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

export const STATE_KEY = "scorecard_state";
export const STRAYS_KEY = "scorecard_strays";
const MAX_BYTES = 600_000;
const ROW_IDS = new Set((scorecard as any).rows.map((r: any) => r.id));

type Rec = Record<string, any>;
export interface ScorecardState { at: number; week: string; rows: Record<string, { state: string; note: string; next: string | null; record: Rec }> }

export async function loadState(db: D1Database): Promise<ScorecardState | null> {
  const raw = await getSetting(db, STATE_KEY);
  try { return raw ? (JSON.parse(raw) as ScorecardState) : null; } catch { return null; }
}

const isNumOrNull = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v));

/** What is wrong with a run the Mac posted, by name. Numbers only: a string with an @ never gets in. */
export function runProblems(body: any): string[] {
  const p: string[] = [];
  if (!body || typeof body !== "object") return ["not an object"];
  if (!/^\d{4}-\d\d-\d\d$/.test(String(body.week))) p.push("no week");
  if (!Array.isArray(body.results) || body.results.length === 0) return [...p, "no results (a run that read nothing is a named stop, not a record)"];
  for (const r of body.results) {
    if (!ROW_IDS.has(r?.id)) p.push(`unknown row ${r?.id}`);
    if (!STATES.includes(r?.state)) p.push(`${r?.id}: unknown state`);
    for (const h of r?.record?.history ?? []) for (const k of ["first", "real", "firstRaw", "realRaw"]) if (!isNumOrNull(h[k]) && !(k.endsWith("Raw") && typeof h[k] === "string" && /^\d{4}-/.test(h[k]))) p.push(`${r.id}: history ${k} is not a number`);
    if (JSON.stringify(r ?? {}).includes("@")) p.push(`${r?.id}: carries an address`);
  }
  return p;
}

const token = () => `sc${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "").slice(0, 4)}`;
export const isScorecardToken = (t: string) => /^sc[a-f0-9]{36}$/.test(t);

scorecardRoutes.get("/", async (c) => {
  const state = await loadState(c.env.DB);
  const raw = await getSetting(c.env.DB, STRAYS_KEY);
  let strays: unknown[] = [];
  try { strays = raw ? JSON.parse(raw).items ?? [] : []; } catch { strays = []; }
  return ok(c, { state, strays });
});

scorecardRoutes.post("/run", async (c) => {
  const body = await c.req.json().catch(() => null);
  const problems = runProblems(body);
  if (problems.length) throw badRequest("That is not a scorecard run", problems.slice(0, 3).join("; "));
  const prev = await loadState(c.env.DB);
  const rows: ScorecardState["rows"] = { ...(prev?.rows ?? {}) };
  const tokens: Record<string, string> = {};
  for (const r of body.results) {
    const record = { ...r.record };
    // A paused row keeps one restart link until it is used.
    if (r.state === "Paused") { record.restartToken = prev?.rows?.[r.id]?.record?.restartToken ?? record.restartToken ?? token(); tokens[r.id] = record.restartToken; }
    rows[r.id] = { state: r.state, note: String(r.note ?? "").slice(0, 600), next: r.next ?? null, record };
  }
  const rec: ScorecardState = { at: Date.now(), week: body.week, rows };
  const text = JSON.stringify(rec);
  if (text.length > MAX_BYTES) throw badRequest("The scorecard record is too big to keep");
  await setSetting(c.env.DB, STATE_KEY, text);
  const counts: Record<string, number> = {};
  for (const r of body.results) counts[r.state] = (counts[r.state] ?? 0) + 1;
  await audit(c.env.DB, { actor: "mac", lane: "ops", entityType: "scorecard", entityId: body.week, action: "scorecard_run_recorded", detail: { counts, actions: body.results.filter((r: any) => r.actions?.length).map((r: any) => ({ id: r.id, actions: r.actions.map((a: any) => a.kind) })) } });
  return ok(c, { recorded: body.results.length, tokens });
});

scorecardRoutes.post("/strays", async (c) => {
  const body = await c.req.json<{ items?: Array<{ key: string; name: string; business?: string; where: string }> }>().catch(() => null);
  const items = Array.isArray(body?.items) ? body!.items : null;
  if (!items) throw badRequest("Send { items: [...] }");
  if (items.some((i) => typeof i?.key !== "string" || typeof i?.name !== "string" || JSON.stringify(i).includes("@"))) throw badRequest("Each stray needs a key and a name, and no address");
  const today = centralDay();
  const raw = await getSetting(c.env.DB, STRAYS_KEY);
  const have: Array<Record<string, unknown>> = (() => { try { return raw ? JSON.parse(raw).items ?? [] : []; } catch { return []; } })();
  const known = new Set(have.map((h) => h.key));
  const added = items.filter((i) => !known.has(i.key)).map((i) => ({ ...i, found: today, state: "No number", note: "Running with no scorecard row: a default row was added (first floor day 30, real floor day 60); its source still needs wiring." }));
  await setSetting(c.env.DB, STRAYS_KEY, JSON.stringify({ at: Date.now(), items: [...have.filter((h) => items.some((i) => i.key === h.key)), ...added] }));
  await audit(c.env.DB, { actor: "emp_kendra", lane: "ops", entityType: "scorecard", entityId: "strays", action: "scorecard_strays_recorded", detail: { seen: items.length, added: added.map((a) => a.key) } });
  return ok(c, { seen: items.length, added: added.length });
});

scorecardRoutes.post("/restarted", async (c) => {
  const body = await c.req.json<{ id?: string }>().catch(() => null);
  const st = await loadState(c.env.DB);
  const row = body?.id ? st?.rows?.[body.id] : null;
  if (!st || !row) throw badRequest("No such scorecard row");
  row.record.pendingEnable = [];
  await setSetting(c.env.DB, STATE_KEY, JSON.stringify(st));
  return ok(c, { id: body!.id });
});

// ─── The one-tap restart ────────────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
function page(title: string, line: string, form?: { action: string; label: string }) {
  const auto = form ? `<form id="f" method="post" action="${esc(form.action)}"><button type="submit">${esc(form.label)}</button></form><script>document.getElementById("f").submit();</script>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
body{font:17px/1.5 -apple-system,system-ui,sans-serif;background:#faf8f5;color:#222;margin:0;padding:48px 20px;text-align:center}
h1{font-size:22px;margin:0 0 8px}p{margin:0 0 24px;color:#555}button{font:inherit;padding:14px 28px;border-radius:10px;border:0;background:#1f4d3a;color:#fff}
</style></head><body><h1>${esc(title)}</h1><p>${esc(line)}</p>${auto}</body></html>`;
}

async function byToken(db: D1Database, t: string) {
  const st = await loadState(db);
  const id = Object.keys(st?.rows ?? {}).find((k) => st!.rows[k]!.record?.restartToken === t);
  return id && st ? { st, id, row: st.rows[id]!, def: (scorecard as any).rows.find((r: any) => r.id === id) } : null;
}

export async function scorecardTapGet(c: Context<{ Bindings: Env; Variables: Vars }>, t: string) {
  const f = await byToken(c.env.DB, t);
  if (!f) return c.html(page("This link has done its job", "Nothing else to do here."));
  return c.html(page(`Restarting ${f.def?.initiative ?? "it"}…`, "One moment.", { action: "", label: "Tap to restart" }));
}

/** Restart a paused row: its clock starts again today, version B is cleared, its own switches go back on. Never re-creates anything. */
export async function scorecardTapPost(c: Context<{ Bindings: Env; Variables: Vars }>, t: string) {
  const f = await byToken(c.env.DB, t);
  if (!f) return c.html(page("This link has done its job", "Nothing else to do here."));
  const today = centralDay();
  const targets = pauseTargets(f.def, schedule as any);
  for (const x of targets) {
    if (x.kind === "duty") await pauseDuty(c.env, x.duty, false).catch(() => null);
    if (x.kind === "outreach") await c.env.DB.prepare(`UPDATE outreach_domain_state SET paused_at = NULL, pause_reason = NULL, updated_at = ? WHERE business_key = ?`).bind(Date.now(), x.key).run();
  }
  const rec = f.row.record;
  Object.assign(rec, { start: today, bOn: null, missed: null, pausedOn: null, restartToken: null, restartedOn: today, pendingEnable: targets.filter((x: any) => x.kind === "workflow") });
  f.row.state = "Too early";
  f.row.note = `Restarted ${today}; judged again from its first floor.`;
  await setSetting(c.env.DB, STATE_KEY, JSON.stringify(f.st));
  await audit(c.env.DB, { actor: "owner", lane: "ops", entityType: "scorecard", entityId: f.id, action: "scorecard_restarted", detail: { via: "one_tap", targets: targets.map((x: any) => x.kind) } });
  const later = rec.pendingEnable.length ? " Its scheduled runs on GitHub come back on with tomorrow morning's check." : "";
  return c.html(page("Restarted ✓", `${f.def?.initiative ?? "It"} is running again and will be judged from its first floor.${later}`));
}
