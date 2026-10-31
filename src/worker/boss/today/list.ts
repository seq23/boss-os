import type { Env } from "../env";
import { dayIdInZone, wallClock } from "../../../shared/boss/timezone";
import { readRunOfShow } from "./runOfShow";
import { secondBlockVehicle } from "../spirit/arcs";
import { pendingApprovals } from "../approvals/pending";

/**
 * TODAY'S LIST — ONE LIST, ONE COUNT (owner approved the mock-up, 31 Oct 2026).
 *
 * The page used to be fifteen cards and three tiles that described the same day twice and
 * contradicted itself four times ("0 failed runs" beside "4 tasks failed", "Nothing is waiting on
 * you" beside a decision). This is the single source now: the gates as the first, middle and last
 * rows, every Decide item, the Wealth block with the LP reply and the leads, approvals and open
 * loops as rows, the day's other blocks in time order. Every "needs you" number anywhere — the
 * summary line, the Today tab's badge — is `needsYou` from this function, and nothing else.
 *
 * Nothing an employee can fix is ever a row (CLAUDE.md, "Anything an employee can fix is a done
 * line"): alerts, duties and team health live on Systems and Team.
 */

export type GateName = "morning" | "midday" | "night";

export type GateItemKind =
  | "coach" | "gratitude" | "practice" | "law" | "move" | "water" | "agree"
  | "water_mid" | "meal" | "stand" | "law_check" | "what_changed"
  | "coach_evening" | "floors" | "attention" | "law_reflect" | "grateful" | "tomorrow"
  | "custom";

export interface GateItem {
  key: string;
  kind: GateItemKind;
  label: string;
  /** The form's own fields: cannot be removed, because the gate cannot be recorded without them. */
  required?: boolean;
}

/** Boss OS's default gates, editable by her (`gate_templates`, `gate_days`). The order is the spec's. */
export const GATE_DEFAULTS: Record<GateName, readonly GateItem[]> = {
  morning: [
    { key: "coach", kind: "coach", label: "☀ Morning coaching, 5 min talk" },
    { key: "gratitude", kind: "gratitude", label: "Say the gratitude sentence aloud" },
    { key: "practice", kind: "practice", label: "20-minute practice (7 steps)" },
    { key: "law", kind: "law", label: "Read today's coaching law aloud" },
    { key: "move", kind: "move", label: "Move 10 min: 5 bed moves + somatic rotation" },
    { key: "water", kind: "water", label: "Water + BP medicine in the first hour" },
    { key: "agree", kind: "agree", label: "Agree the day: priorities, identity cue, state, body floor, revenue reality, commitment", required: true },
  ],
  midday: [
    { key: "water_mid", kind: "water_mid", label: "Water: half a Stanley cup by now (one full is the floor)" },
    { key: "meal", kind: "meal", label: "Food guardrail: one keto meal, from a safe lane" },
    { key: "stand", kind: "stand", label: "Movement break: stand up, 2 minutes" },
    { key: "law_check", kind: "law_check", label: "Did you hold today's law?" },
    { key: "what_changed", kind: "what_changed", label: "What changed, then Reset", required: true },
  ],
  night: [
    { key: "coach_evening", kind: "coach_evening", label: "🌙 Evening coaching, 5 min wrap-up" },
    { key: "floors", kind: "floors", label: "The five floors: met or missed" },
    { key: "attention", kind: "attention", label: "Where the attention went", required: true },
    { key: "law_reflect", kind: "law_reflect", label: "Today's law: where did you break or keep it?" },
    { key: "grateful", kind: "grateful", label: "Grateful for today (about the day, never body or food)" },
    { key: "tomorrow", kind: "tomorrow", label: "Tomorrow's priorities, then Close the day", required: true },
  ],
};

export const GATE_NAMES: readonly GateName[] = ["morning", "midday", "night"];
export const GATE_TITLE: Record<GateName, string> = { morning: "Morning gate", midday: "Midday gate", night: "Night gate" };
const KNOWN_KEYS = new Set(GATE_NAMES.flatMap((g) => GATE_DEFAULTS[g].map((i) => i.key)));
export const MAX_GATE_ITEMS = 12;
export const MAX_CUSTOM_CHECKS = 3;

/**
 * Validates an edited gate: every known item keeps Boss OS's own label (she reorders and removes
 * them; her additions are `custom` lines with her words), the required ones stay, nothing is
 * duplicated. Returns the clean list or a sentence saying what is wrong.
 */
export function cleanGateItems(gate: GateName, raw: unknown): GateItem[] | string {
  if (!Array.isArray(raw)) return "A gate is a list of items.";
  const defaults = new Map(GATE_DEFAULTS[gate].map((i) => [i.key, i]));
  const out: GateItem[] = [];
  const seen = new Set<string>();
  for (const r of raw.slice(0, MAX_GATE_ITEMS)) {
    const key = String((r as { key?: unknown })?.key ?? "");
    if (seen.has(key)) continue;
    if (defaults.has(key)) { out.push(defaults.get(key)!); seen.add(key); continue; }
    if (KNOWN_KEYS.has(key)) return `"${key}" belongs to another gate.`;
    const label = String((r as { label?: unknown })?.label ?? "").trim().slice(0, 140);
    if (!label) continue;
    const k = /^custom:[a-z0-9]{4,24}$/.test(key) ? key : `custom:${Math.random().toString(36).slice(2, 10)}`;
    out.push({ key: k, kind: "custom", label });
    seen.add(k);
  }
  for (const req of GATE_DEFAULTS[gate].filter((i) => i.required)) {
    if (!seen.has(req.key)) out.push(req);
  }
  return out;
}

export interface SubItem { key: string; title: string; sub?: string; done_at: number | null; open?: { label: string; href: string } }

export interface ListRow {
  key: string;
  kind: "gate" | "decide" | "wealth" | "block" | "approval" | "loop" | "custom_gate";
  title: string;
  sub: string | null;
  /** Minutes after midnight, Central: the row's place in the day. Rows never move once shown. */
  at: number;
  done_at: number | null;
  needs_you: boolean;
  open?: { label: string; href: string };
  subs?: SubItem[];
  gate?: { name: GateName | string; items: GateItem[]; is_default: boolean; saved_default: boolean; checks?: string[] };
}

export interface TodayList {
  day_id: string;
  rows: ListRow[];
  ticks: Record<string, number>;
  needs_you: number;
  done: number;
  total: number;
  coach: { morning_at: number | null; evening_at: number | null; nudge: "morning" | "evening" | null };
}

const json = <T,>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
};

const isWealthDecision = (d: { title?: string; body?: string }) =>
  /\bLPs?\b|investor|fundrais|capital call|commit(ment)? to (the|our) fund/i.test(`${d.title ?? ""} ${d.body ?? ""}`);

/** The coach nudge: gold, never red, and gone once the talk happened or the gate closed. */
export function coachNudge(now: number, s: { morningCoach: boolean; eveningCoach: boolean; morningGate: boolean; nightGate: boolean }): "morning" | "evening" | null {
  const h = wallClock(now).h;
  if (h >= 19 && !s.eveningCoach && !s.nightGate) return "evening";
  if (h >= 10 && h < 19 && !s.morningCoach && !s.morningGate) return "morning";
  return null;
}

export async function buildTodayList(env: Env, now = Date.now()): Promise<TodayList> {
  const today = dayIdInZone(now);
  const db = env.DB;
  // Approvals come from the one function every badge reads (approvals/pending.ts), never a second SQL.
  const pendingP = pendingApprovals(db);
  const [dayR, tplR, daysR, ticksR, engR, digestR, leadsR, loopsR] = await db.batch([
    db.prepare(`SELECT * FROM days WHERE id = ?`).bind(today),
    db.prepare(`SELECT gate, items FROM gate_templates`),
    db.prepare(`SELECT gate, items, name, at_minute, created_at FROM gate_days WHERE day_id = ?`).bind(today),
    db.prepare(`SELECT item_key, done_at FROM today_ticks WHERE day_id = ?`).bind(today),
    db.prepare(`SELECT kind, last_at FROM practice_engagement WHERE day_id = ?`).bind(today),
    db.prepare(`SELECT day, payload FROM morning_digests ORDER BY day DESC LIMIT 1`),
    db.prepare(`SELECT COUNT(*) AS n FROM sourcing_candidates WHERE status = 'new'`),
    db.prepare(`SELECT id, title, kind FROM open_loops WHERE status = 'open' ORDER BY created_at ASC LIMIT 20`),
  ]);
  const day = (dayR?.results?.[0] ?? null) as Record<string, any> | null;
  const templates = new Map(((tplR?.results ?? []) as { gate: string; items: string }[]).map((r) => [r.gate, json<GateItem[]>(r.items, [])]));
  const dayGates = (daysR?.results ?? []) as { gate: string; items: string; name: string | null; at_minute: number | null; created_at: number }[];
  const ticks: Record<string, number> = Object.fromEntries(((ticksR?.results ?? []) as { item_key: string; done_at: number }[]).map((t) => [t.item_key, t.done_at]));
  const eng = new Map(((engR?.results ?? []) as { kind: string; last_at: number }[]).map((r) => [r.kind, r.last_at]));
  const morningCoach = eng.get("coach_morning") ?? null;
  const eveningCoach = eng.get("coach_evening") ?? null;
  if (morningCoach) ticks["morning:coach"] = morningCoach;
  if (eveningCoach) ticks["night:coach_evening"] = eveningCoach;

  const rows: ListRow[] = [];

  // ── The three gates ──
  const gateAt: Record<GateName, number> = { morning: 6 * 60, midday: 12 * 60, night: 21 * 60 };
  for (const g of GATE_NAMES) {
    const forDay = dayGates.find((d) => d.gate === g);
    const saved = templates.get(g);
    const items = forDay ? json<GateItem[]>(forDay.items, []) : saved?.length ? saved : [...GATE_DEFAULTS[g]];
    const doneAt = (day?.[`${g}_completed_at`] as number | null) ?? null;
    rows.push({
      key: `gate:${g}`, kind: "gate", title: GATE_TITLE[g], sub: items.filter((i) => !i.required || i.kind === "agree").map((i) => i.label.replace(/,.*$/, "")).slice(0, 7).join(" · "),
      at: gateAt[g], done_at: doneAt, needs_you: false,
      gate: { name: g, items, is_default: !forDay && !saved?.length, saved_default: Boolean(saved?.length) },
    });
  }

  // ── Gates she created for today ──
  for (const cg of dayGates.filter((d) => d.gate.startsWith("custom:"))) {
    const checks = json<string[]>(cg.items, []);
    const subs: SubItem[] = checks.map((c, i) => ({ key: `${cg.gate}:${i}`, title: c, done_at: ticks[`${cg.gate}:${i}`] ?? null }));
    rows.push({
      key: cg.gate, kind: "custom_gate", title: cg.name ?? "Your gate", sub: null, at: cg.at_minute ?? 13 * 60,
      done_at: subs.length && subs.every((s) => s.done_at) ? Math.max(...subs.map((s) => s.done_at!)) : null,
      needs_you: false, subs, gate: { name: cg.gate, items: [], is_default: false, saved_default: false, checks },
    });
  }

  // ── Every Decide item: the LP replies go in the Wealth block, the rest are rows of their own ──
  const digest = (digestR?.results?.[0] ?? null) as { day: string; payload: string } | null;
  const payload = json<{ decide?: any[] }>(digest?.payload, {});
  const fresh = digest && Math.abs(Date.parse(`${digest.day}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) <= 2 * 86_400_000;
  const decide = fresh ? (payload.decide ?? []).filter((d) => d && !d.answered_at && d.id && d.title) : [];
  const href = (d: any) => `/?morning=${encodeURIComponent(digest!.day)}&item=${encodeURIComponent(d.id)}`;
  const wealthSubs: SubItem[] = [];
  for (const d of decide) {
    const key = `decide:${d.id}`;
    const body = String(d.body ?? "").split(/(?<=[.!?])\s/)[0] ?? "";
    if (isWealthDecision(d)) {
      wealthSubs.push({ key, title: String(d.title), sub: body || undefined, done_at: ticks[key] ?? null, open: { label: "Open ›", href: href(d) } });
    } else {
      rows.push({ key, kind: "decide", title: String(d.title), sub: body || null, at: 7 * 60, done_at: ticks[key] ?? null, needs_you: !ticks[key], open: { label: "Open ›", href: href(d) } });
    }
  }
  const leads = ((leadsR?.results?.[0] ?? {}) as { n?: number }).n ?? 0;
  if (leads > 0) {
    wealthSubs.push({
      key: "wealth:leads", title: `Look at ${leads} buyer lead${leads === 1 ? "" : "s"} Camille found`, sub: "Keep / No thanks / More like this",
      done_at: ticks["wealth:leads"] ?? null, open: { label: "Open ›", href: "/?tab=capital&view=desk" },
    });
  }
  if (wealthSubs.length) {
    rows.push({
      key: "wealth", kind: "wealth", title: "Wealth block", sub: "Tick each, or the block ticks itself when all are done", at: 8 * 60 + 30,
      done_at: wealthSubs.every((s) => s.done_at) ? Math.max(...wealthSubs.map((s) => s.done_at!)) : null,
      needs_you: wealthSubs.some((s) => !s.done_at), subs: wealthSubs,
    });
  }

  // ── Approvals and open loops: rows, never empty cards ──
  const pending = await pendingP;
  for (const a of pending.rows.filter((r) => r.kind !== "notice").slice(0, 20)) {
    rows.push({ key: `approval:${a.id}`, kind: "approval", title: a.title, sub: "Waiting for your word", at: 10 * 60, done_at: null, needs_you: true, open: { label: "Open ›", href: `/?tab=inbox&approval=${encodeURIComponent(a.id)}` } });
  }
  for (const l of (loopsR?.results ?? []) as { id: string; title: string; kind: string }[]) {
    rows.push({ key: `loop:${l.id}`, kind: "loop", title: l.title, sub: "Something you said must not be forgotten", at: 10 * 60 + 30, done_at: null, needs_you: true });
  }

  // ── The day's other blocks, between the gates ──
  const ros = await readRunOfShow(env, today, { dayMode: day?.day_mode ?? null, anchor: day?.morning_contract ?? null });
  const second = secondBlockVehicle(new Date(`${today}T12:00:00Z`).getUTCDay());
  const blockTitle: Record<string, [string, number]> = {
    first_wealth_block: ["Brokerage block", 9 * 60],
    afternoon_wealth_admin: [`${second.name} block`, 14 * 60],
    food_guardrail_check: ["Food guardrail check", 15 * 60],
  };
  for (const b of ros) {
    const t = blockTitle[b.key];
    if (!t) continue; // the gate blocks are the gate rows
    rows.push({ key: `ros:${b.key}`, kind: "block", title: t[0], sub: b.instruction ?? b.intent, at: t[1], done_at: b.done_at, needs_you: false });
  }

  rows.sort((a, b) => a.at - b.at);
  const tickable = rows.filter((r) => r.kind !== "approval" && r.kind !== "loop");
  const needsYou = rows.filter((r) => r.needs_you).reduce((n, r) => n + (r.kind === "wealth" ? (r.subs ?? []).filter((s) => !s.done_at).length : 1), 0);
  return {
    day_id: today,
    rows,
    ticks,
    needs_you: needsYou,
    done: tickable.filter((r) => r.done_at).length,
    total: tickable.length,
    coach: {
      morning_at: morningCoach, evening_at: eveningCoach,
      nudge: coachNudge(now, { morningCoach: Boolean(morningCoach), eveningCoach: Boolean(eveningCoach), morningGate: Boolean(day?.morning_completed_at), nightGate: Boolean(day?.night_completed_at) }),
    },
  };
}
