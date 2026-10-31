import type { Env } from "../env";
import { dayIdInZone, wallClock } from "../../../shared/boss/timezone";
import { readRunOfShow } from "./runOfShow";
import { pendingApprovals } from "../approvals/pending";
import { waitingOnYou, type WaitingItem } from "./waiting";
import { sideBusinessToday, type SidePick } from "./sideBusiness";
import { foodToday, type FoodToday } from "./food";
import { chooseQuestion, coachSignals, type CoachQuestion } from "./coachQuestion";

/**
 * TODAY'S CONTRACT — ONE LIST, ONE COUNT (owner approved the mock-up, 31 Oct 2026; renamed from
 * "Today's list" in Today v4, the same day).
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
  | "coach" | "gratitude" | "practice" | "law" | "move" | "water" | "bp_tea" | "agree"
  | "water_mid" | "meal" | "stand" | "law_check" | "what_changed"
  | "coach_evening" | "floors" | "attention" | "law_reflect" | "grateful" | "tomorrow"
  | "custom";

export interface GateItem {
  key: string;
  kind: GateItemKind;
  label: string;
  /** The few words the gate's row shows ("1 Gratitude sentence aloud · 2 Meditation · …"). */
  short?: string;
  /** The form's own fields: cannot be removed, because the gate cannot be recorded without them. */
  required?: boolean;
}

/**
 * Boss OS's default gates, editable by her (`gate_templates`, `gate_days`).
 *
 * THE MORNING ORDER IS HERS (owner, Today v4, 31 Oct 2026): 1 the gratitude sentence aloud, 2
 * meditation, 3 movement, 4 medicine, then the blood pressure tea (owner, same day: "her blood
 * pressure tea is a MORNING gate item, not night"), and morning coaching ALWAYS LAST — even when she
 * adds or moves steps (`normaliseGate`). "Agree the day" is the form that records the gate.
 *
 * FOOD LIVES ON ITS OWN ROW (the 15:00 food guardrail check), never inside a gate.
 */
export const GATE_DEFAULTS: Record<GateName, readonly GateItem[]> = {
  morning: [
    { key: "gratitude", kind: "gratitude", label: "Say the gratitude sentence aloud", short: "Gratitude sentence aloud" },
    { key: "practice", kind: "practice", label: "Meditation: the 20-minute practice (7 steps)", short: "Meditation" },
    { key: "move", kind: "move", label: "Movement: 10 min, 5 bed moves + somatic rotation", short: "Movement" },
    { key: "water", kind: "water", label: "Medicine: BP medicine + water in the first hour", short: "Medicine" },
    { key: "bp_tea", kind: "bp_tea", label: "Blood pressure tea", short: "Blood pressure tea" },
    { key: "agree", kind: "agree", label: "Agree the day: priorities, identity cue, state, body floor, revenue reality, commitment", required: true },
    { key: "coach", kind: "coach", label: "☀ Morning coaching, 5 min talk (always last)", short: "Morning coaching (last)" },
  ],
  midday: [
    { key: "water_mid", kind: "water_mid", label: "Water: half a Stanley cup by now (one full is the floor)" },
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

/**
 * Items Boss OS still knows but no longer puts in a default: a gate she saved with them keeps them,
 * with Boss OS's own label. ("law" left the Morning gate for one small line under the Coaching
 * question; "meal" left the Midday gate because food lives on its own row.)
 */
const GATE_OPTIONAL: Record<GateName, readonly GateItem[]> = {
  morning: [{ key: "law", kind: "law", label: "Read today's coaching law aloud", short: "Today's law" }],
  midday: [{ key: "meal", kind: "meal", label: "Food guardrail: one keto meal, from a safe lane" }],
  night: [],
};

export const GATE_NAMES: readonly GateName[] = ["morning", "midday", "night"];
export const GATE_TITLE: Record<GateName, string> = { morning: "Morning gate", midday: "Midday gate", night: "Night gate" };
const known = (g: GateName) => [...GATE_DEFAULTS[g], ...GATE_OPTIONAL[g]];
const KNOWN_KEYS = new Set(GATE_NAMES.flatMap((g) => known(g).map((i) => i.key)));
export const MAX_GATE_ITEMS = 12;
export const MAX_CUSTOM_CHECKS = 3;

/** A line she wrote that is the blood pressure tea: it is the Morning gate's own item now. */
export const BP_TEA_RE = /\b(?:blood[\s-]*pressure|bp|hibiscus)\s+tea\b/i;
/**
 * When the tea moved to the morning (31 Oct 2026). A Morning gate she saved BEFORE this never had the
 * chance to include it, so it is added there; one saved after it is hers, and a removal sticks.
 */
export const BP_TEA_MORNING_SINCE = Date.UTC(2026, 9, 31, 12, 0, 0); // 31 Oct 2026 07:00 Central, the morning she said it

/**
 * Every gate read or saved passes through here, so the rules hold for saved and day gates alike:
 *   - the Night gate never holds the blood pressure tea (any line of hers that names it is dropped);
 *   - the Morning gate holds it as its own item, not as a custom line, and gains it when it was
 *     saved before the tea moved (`savedAt` < BP_TEA_MORNING_SINCE, or unknown);
 *   - morning coaching is ALWAYS the Morning gate's last step.
 */
export function normaliseGate(gate: GateName | string, items: GateItem[], savedAt: number | null = null): GateItem[] {
  if (gate === "night" || gate === "midday") return items.filter((i) => !(i.kind === "custom" && BP_TEA_RE.test(i.label)) && i.kind !== "bp_tea");
  if (gate !== "morning") return items;
  let out = items.filter((i) => !(i.kind === "custom" && BP_TEA_RE.test(i.label)));
  const hadTeaLine = out.length !== items.length;
  if (!out.some((i) => i.key === "bp_tea") && (hadTeaLine || savedAt === null || savedAt < BP_TEA_MORNING_SINCE)) {
    const tea = GATE_DEFAULTS.morning.find((i) => i.key === "bp_tea")!;
    const after = out.findIndex((i) => i.key === "water");
    const at = after >= 0 ? after + 1 : Math.max(0, out.findIndex((i) => i.required || i.kind === "coach"));
    out = [...out.slice(0, at), tea, ...out.slice(at)];
  }
  const coach = out.filter((i) => i.kind === "coach");
  return [...out.filter((i) => i.kind !== "coach"), ...coach];
}

/**
 * Validates an edited gate: every known item keeps Boss OS's own label (she reorders and removes
 * them; her additions are `custom` lines with her words), the required ones stay, nothing is
 * duplicated, and the result is normalised (coaching last, the tea in the morning). Returns the
 * clean list or a sentence saying what is wrong.
 */
export function cleanGateItems(gate: GateName, raw: unknown): GateItem[] | string {
  if (!Array.isArray(raw)) return "A gate is a list of items.";
  const defaults = new Map(known(gate).map((i) => [i.key, i]));
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
  // A list she saves now is hers: the tea is added only when she wrote it as her own line.
  return normaliseGate(gate, out, Date.now() > BP_TEA_MORNING_SINCE ? Date.now() : BP_TEA_MORNING_SINCE);
}


export interface SubItem { key: string; title: string; sub?: string; done_at: number | null; open?: { label: string; href: string }; reply?: ReplyView | null; waiting_id?: string }

/** A held reply as her screen sees it: the words and whether one tap can send them. Never a token. */
export interface ReplyView { text: string | null; can_send: boolean; why: string | null }

/**
 * THE ONE 💰 WEALTH BLOCK (Today v4): Core business in the morning, Side business in the afternoon.
 * Ticking a part ticks its Run of Show block (`ros`), so nothing upstream that reads the Run of Show
 * changes: `first_wealth_block` is Core, `afternoon_wealth_admin` is Side.
 */
export interface WealthPart {
  key: "core" | "side";
  title: string;
  at: number;
  ros: "first_wealth_block" | "afternoon_wealth_admin";
  done_at: number | null;
  subs: SubItem[];
  pick?: SidePick;
}

export interface ListRow {
  key: string;
  kind: "gate" | "decide" | "wealth" | "block" | "food" | "approval" | "loop" | "custom_gate";
  title: string;
  sub: string | null;
  /** Minutes after midnight, Central: the row's place in the day. Rows never move once shown. */
  at: number;
  done_at: number | null;
  needs_you: boolean;
  open?: { label: string; href: string };
  subs?: SubItem[];
  parts?: WealthPart[];
  food?: FoodToday;
  reply?: ReplyView | null;
  waiting_id?: string;
  gate?: { name: GateName | string; items: GateItem[]; is_default: boolean; saved_default: boolean; checks?: string[] };
}

/** "Still waiting on you" as her screen sees it (no tap tokens on the page). */
export interface WaitingView { id: string; title: string; body: string; days: number; first_day: string; href: string; reply: ReplyView | null; lp: boolean }

export interface TodayList {
  day_id: string;
  rows: ListRow[];
  /** Every Decide item from an earlier morning still unanswered: oldest first. */
  waiting: WaitingView[];
  coach_question: CoachQuestion;
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

const replyView = (w: WaitingItem): ReplyView | null => (w.reply ? { text: w.reply.text, can_send: w.reply.can_send, why: w.reply.why } : null);

/** The coach nudge: gold, never red, and gone once the talk happened or the gate closed. */
export function coachNudge(now: number, s: { morningCoach: boolean; eveningCoach: boolean; morningGate: boolean; nightGate: boolean }): "morning" | "evening" | null {
  const h = wallClock(now).h;
  if (h >= 19 && !s.eveningCoach && !s.nightGate) return "evening";
  if (h >= 10 && h < 19 && !s.morningCoach && !s.morningGate) return "morning";
  return null;
}

/** The gate row's one line: "1 Gratitude sentence aloud · 2 Meditation · …" for the morning. */
export function gateLine(g: GateName | string, items: GateItem[]): string {
  if (g === "morning") return items.filter((i) => !i.required).map((i, n) => `${n + 1} ${i.short ?? i.label.replace(/[,:].*$/, "")}`).join(" · ");
  return items.filter((i) => !i.required || i.kind === "agree").map((i) => i.label.replace(/,.*$/, "")).slice(0, 7).join(" · ");
}

export async function buildTodayList(env: Env, now = Date.now()): Promise<TodayList> {
  const today = dayIdInZone(now);
  const db = env.DB;
  // Approvals come from the one function every badge reads (approvals/pending.ts), never a second SQL.
  const pendingP = pendingApprovals(db);
  const [dayR, tplR, daysR, ticksR, engR, leadsR, loopsR] = await db.batch([
    db.prepare(`SELECT * FROM days WHERE id = ?`).bind(today),
    db.prepare(`SELECT gate, items, updated_at FROM gate_templates`),
    db.prepare(`SELECT gate, items, name, at_minute, created_at FROM gate_days WHERE day_id = ?`).bind(today),
    db.prepare(`SELECT item_key, done_at FROM today_ticks WHERE day_id = ?`).bind(today),
    db.prepare(`SELECT kind, last_at FROM practice_engagement WHERE day_id = ?`).bind(today),
    db.prepare(`SELECT COUNT(*) AS n FROM sourcing_candidates WHERE status = 'new'`),
    db.prepare(`SELECT id, title, kind FROM open_loops WHERE status = 'open' ORDER BY created_at ASC LIMIT 20`),
  ]);
  const day = (dayR?.results?.[0] ?? null) as Record<string, any> | null;
  const templates = new Map(((tplR?.results ?? []) as { gate: string; items: string; updated_at: number }[]).map((r) => [r.gate, { items: json<GateItem[]>(r.items, []), at: r.updated_at }]));
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
    const items = forDay
      ? normaliseGate(g, json<GateItem[]>(forDay.items, []), forDay.created_at)
      : saved?.items.length ? normaliseGate(g, saved.items, saved.at) : [...GATE_DEFAULTS[g]];
    const doneAt = (day?.[`${g}_completed_at`] as number | null) ?? null;
    rows.push({
      key: `gate:${g}`, kind: "gate", title: GATE_TITLE[g], sub: gateLine(g, items),
      at: gateAt[g], done_at: doneAt, needs_you: false,
      gate: { name: g, items, is_default: !forDay && !saved?.items.length, saved_default: Boolean(saved?.items.length) },
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

  /*
   * ── Every Decide item, from every morning still unanswered (today/waiting.ts) ──
   * New this morning: an LP / investor item is a Core business line in the Wealth block, any other is
   * a row of its own. From an earlier morning: "Still waiting on you", with "waiting N days".
   */
  const { items: waitingAll, latest } = await waitingOnYou(env, today);
  const isNew = (w: WaitingItem) => latest !== null && w.first_day >= latest && w.days <= 2;
  const coreSubs: SubItem[] = [];
  for (const w of waitingAll.filter(isNew)) {
    const key = `decide:${w.id}`;
    if (w.wealth) {
      coreSubs.push({ key, title: w.title, sub: w.days === 0 ? "today" : undefined, done_at: ticks[key] ?? null, open: { label: "Open ›", href: w.href }, reply: replyView(w), waiting_id: w.id });
    } else {
      rows.push({ key, kind: "decide", title: w.title, sub: w.body || null, at: 7 * 60, done_at: ticks[key] ?? null, needs_you: !ticks[key], open: { label: "Open ›", href: w.href }, reply: replyView(w), waiting_id: w.id });
    }
  }
  const waiting: WaitingView[] = waitingAll.filter((w) => !isNew(w))
    .map((w) => ({ id: w.id, title: w.title, body: w.body, days: w.days, first_day: w.first_day, href: w.href, reply: replyView(w), lp: Boolean(w.reply) }));

  // ── The one 💰 Wealth block: Core business (9:00) and Side business (14:00) ──
  const leads = ((leadsR?.results?.[0] ?? {}) as { n?: number }).n ?? 0;
  if (leads > 0) {
    coreSubs.push({
      key: "wealth:leads", title: `Look at ${leads} buyer lead${leads === 1 ? "" : "s"} Camille found`, sub: "Keep / No thanks / More like this",
      done_at: ticks["wealth:leads"] ?? null, open: { label: "Open ›", href: "/?tab=capital&view=desk" },
    });
  }
  const ros = await readRunOfShow(env, today, { dayMode: day?.day_mode ?? null, anchor: day?.morning_contract ?? null });
  const rosDone = (k: string) => ros.find((b) => b.key === k)?.done_at ?? null;
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const pick = await sideBusinessToday(env, today, weekday, now);
  const parts: WealthPart[] = [
    { key: "core", title: "Core business", at: 9 * 60, ros: "first_wealth_block", done_at: rosDone("first_wealth_block"), subs: coreSubs },
    { key: "side", title: "Side business", at: 14 * 60, ros: "afternoon_wealth_admin", done_at: rosDone("afternoon_wealth_admin"), subs: [], pick },
  ];
  const openSubs = coreSubs.filter((s) => !s.done_at).length;
  rows.push({
    key: "wealth", kind: "wealth", title: "💰 Wealth block", sub: null, at: 9 * 60,
    done_at: parts.every((p) => p.done_at) ? Math.max(...parts.map((p) => p.done_at!)) : null,
    needs_you: openSubs > 0, parts,
  });

  // ── Approvals and open loops: rows, never empty cards ──
  const pending = await pendingP;
  for (const a of pending.rows.filter((r) => r.kind !== "notice").slice(0, 20)) {
    rows.push({ key: `approval:${a.id}`, kind: "approval", title: a.title, sub: "Waiting for your word", at: 10 * 60, done_at: null, needs_you: true, open: { label: "Open ›", href: `/?tab=inbox&approval=${encodeURIComponent(a.id)}` } });
  }
  for (const l of (loopsR?.results ?? []) as { id: string; title: string; kind: string }[]) {
    rows.push({ key: `loop:${l.id}`, kind: "loop", title: l.title, sub: "Something you said must not be forgotten", at: 10 * 60 + 30, done_at: null, needs_you: true });
  }

  // ── 🥑 The food guardrail check (15:00): today's keto order at a restaurant (today/food.ts) ──
  const food = await foodToday(env, today, { now }).catch(() => null);
  rows.push({
    key: "ros:food_guardrail_check", kind: "food", title: "🥑 Food guardrail check", sub: null, at: 15 * 60,
    done_at: rosDone("food_guardrail_check"), needs_you: false, ...(food ? { food } : {}),
  });

  rows.sort((a, b) => a.at - b.at);

  // ── Coaching: the day's question, from counts only (today/coachQuestion.ts) ──
  const longest = waitingAll[0] ?? null;
  const coach_question = chooseQuestion(await coachSignals(env, today, longest ? { days: longest.days, lp: Boolean(longest.reply) || longest.wealth } : null));

  const tickable = rows.filter((r) => r.kind !== "approval" && r.kind !== "loop");
  const needsYou = rows.filter((r) => r.needs_you).reduce((n, r) => n + (r.kind === "wealth" ? openSubs : 1), 0) + waiting.length;
  return {
    day_id: today,
    rows,
    waiting,
    coach_question,
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
