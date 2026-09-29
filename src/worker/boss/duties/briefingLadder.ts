import { orderCandidates, vendorFamily } from "@shared/boss/router/candidateOrder.mjs";
import { isPlanSpent, untilWords } from "../backends/spent";
import { isPrivateModelRoute, privateLexicon, scanForModelAccess, type PrivateLexicon } from "../router/modelAccess";

/**
 * THE LADDER THE EXECUTIVE BRIEFING WALKS: HER TWO $0 SEATS, THEN THE FREE RUNGS, THEN PAID.
 *
 * ─── The owner's question, 19 September 2026 ──────────────────────────────
 *
 *   "the Boss OS briefing is run using my two $0 lanes first, right — Claude and OpenAI? The ladder
 *    is working?"
 *
 * THE HONEST ANSWER BEFORE THIS FILE WAS NO. The duty row carried `backend_id: "bk_claude_code"`
 * and `queue/consumer.ts` dispatched to that one backend and stopped: a refusal from the guard
 * (ceiling spent, backend disabled) FAILED the task with "Change the backend on the duty", and a run
 * parked for `bk_claude_code` could be claimed only by the Claude Code seat — `/claim` filters on
 * `r.backend_id = ?`. `bk_codex` was enabled on 17 September, priced, proven with a real generation
 * (PR #25) and could never be reached by this duty by any path. Second on the ladder in the
 * documentation; unreachable in the code.
 *
 * ─── What this module is ───────────────────────────────────────────────────
 *
 * ONE ordered list, built from the rows the router already reads, that three places consume:
 *
 *   · `materialise.ts` stamps `backend_ladder` on the task from `BRIEFING_SEATS`, so the consumer
 *     walks the seats in order and falls through to the cloud router when both refuse;
 *   · `/claim` lets a seat take a run parked for an EARLIER seat on the same ladder when the Mac
 *     reports that earlier seat cannot authenticate;
 *   · `scripts/ops/briefing-ladder.mjs` and the on-par validator print and pin the order.
 *
 * The cloud rungs below the seats are `models.ladder_rung` (migration 0256), ordered by the shipped
 * comparator, and are NOT a second copy: they are read from the same table the router walks.
 */

export interface BriefingSeat {
  backend_id: string;
  /** The model the seat runs for this duty. Null means the CLI's own default on her seat. */
  model: string | null;
  label: string;
  /** What the seat costs this system. Both are subscription seats: $0 in API dollars. */
  cost: "plan_equivalent";
}

/**
 * The two $0 seats, in the order she named them: Claude, then OpenAI.
 *
 * `bk_codex` carries no model: Codex CLI runs whatever her ChatGPT Plus seat's default is, and
 * passing a Claude model id to it — which is what a single `requested.model` did — is a run that
 * cannot start.
 */
export const BRIEFING_SEATS: BriefingSeat[] = [
  { backend_id: "bk_claude_code", model: "claude-sonnet-4-5-20250929", label: "Claude Code on her Max seat", cost: "plan_equivalent" },
  { backend_id: "bk_codex", model: null, label: "Codex CLI on her ChatGPT Plus seat", cost: "plan_equivalent" },
];

export const BRIEFING_LADDER_IDS = BRIEFING_SEATS.map((s) => s.backend_id);

/** `requested.model_by_backend`, so `/claim` hands each seat its own model. */
export function modelBySeat(): Record<string, string | null> {
  return Object.fromEntries(BRIEFING_SEATS.map((s) => [s.backend_id, s.model]));
}

export interface BackendRow {
  id: string;
  status: string;
  class: string;
  monthly_ceiling_micros: number | null;
  spent_micros?: number | null;
  window_started_at?: number | null;
  /** 0274. A seat reported out of usage until this time. */
  exhausted_until?: number | null;
  exhausted_reason?: string | null;
}

export interface ModelRow {
  id: string;
  provider_id: string;
  backend_id?: string | null;
  slug: string;
  display_name: string;
  capability_tier: string;
  enabled: number;
  provider_enabled: number;
  in_micros_1k: number;
  out_micros_1k: number;
  ladder_rung: number | null;
  data_use?: string | null;
}

export interface Candidate {
  position: number;
  kind: "seat" | "free_rung" | "paid_rung";
  backend_id: string;
  model: string | null;
  label: string;
  /** What one run costs this system in API dollars, in words. */
  cost: string;
  eligible: boolean;
  why: string;
}

const FREE_SLUG = /:free$/;

/**
 * The ordered candidates for the briefing, from the rows as they stand.
 *
 * SEATS FIRST, IN THEIR OWN ORDER — they are not on `models.ladder_rung` because they are not
 * models; they are her subscriptions. Then every live model on the ladder, ordered by the shipped
 * comparator (cost, then rung, then tier, then name), split into free and paid by what it bills.
 *
 * `eligible` says whether the guard would let it run THIS month: a seat that is disabled or whose
 * plan-equivalent ceiling is spent is listed and marked, never dropped, so the printed ladder shows
 * where a walk would actually start today.
 */
export function orderBriefingCandidates(
  rows: { backends: BackendRow[]; models: ModelRow[] },
  now = Date.now(),
  /**
   * THE ROUTER'S OWN PRIVACY VERDICT ON THE BRIEFING'S PROMPT, when the caller has it. The router
   * scans every outgoing prompt for LP names and deal material and, on a hit, refuses every
   * training-permitting lane — and NOTHING A CALLER DECLARES CAN LOWER THAT VERDICT (see
   * `scanForModelAccess`). Measured 19 Sep 2026: the briefing's prompt carries "commitment",
   * "valuation", "allocation" and rate wording, the scan reads that as deal material, and the six
   * `:free` OpenRouter rungs are refused for it. So the printed ladder marks them refused rather
   * than letting a list say "free rung next" about a rung the walk will never reach.
   */
  privacy?: { private_model_only: boolean; why: string } | null,
): Candidate[] {
  const out: Candidate[] = [];
  const monthStart = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1);

  for (const seat of BRIEFING_SEATS) {
    const b = rows.backends.find((x) => x.id === seat.backend_id);
    let eligible = true;
    let why = "runs on her own subscription; this system is billed nothing";
    if (!b) { eligible = false; why = "no execution_backends row"; }
    else if (b.status !== "enabled") { eligible = false; why = `backend is ${b.status}`; }
    else if (isPlanSpent(b, now)) { eligible = false; why = `plan reported out of usage; tried again in about ${untilWords(b.exhausted_until as number, now)}`; }
    else if ((b.monthly_ceiling_micros ?? 0) > 0) {
      const inWindow = (b.window_started_at ?? 0) >= monthStart;
      const spent = inWindow ? (b.spent_micros ?? 0) : 0;
      if (spent >= (b.monthly_ceiling_micros ?? 0)) { eligible = false; why = `plan-equivalent ceiling spent ($${(spent / 1e6).toFixed(2)} of $${((b.monthly_ceiling_micros ?? 0) / 1e6).toFixed(2)})`; }
      else why = `${why}; $${(spent / 1e6).toFixed(2)} of a $${((b.monthly_ceiling_micros ?? 0) / 1e6).toFixed(2)} plan-equivalent ceiling used this month`;
    }
    out.push({ position: out.length + 1, kind: "seat", backend_id: seat.backend_id, model: seat.model, label: seat.label, cost: "$0 (subscription)", eligible, why });
  }

  const live = rows.models.filter((m) => Number(m.enabled) === 1 && Number(m.provider_enabled) === 1 && m.ladder_rung !== null && m.ladder_rung !== undefined);
  // The briefing is strong-model work, so among PAID rungs the Claude family goes first, then OpenAI —
  // the same term the router adds (router/index.ts, `preferStrongVendors`). A free rung costs 0 and keeps its place.
  const costOf = (m: ModelRow) => {
    const price = Number(m.in_micros_1k ?? 0) + Number(m.out_micros_1k ?? 0);
    const free = FREE_SLUG.test(m.slug) || m.provider_id === "prv_workers_ai";
    return price > 0 && !free ? vendorFamily(m) * 100_000_000 + price : price;
  };
  const ordered = orderCandidates(live as any, costOf as any) as unknown as ModelRow[];
  for (const m of ordered) {
    const free = FREE_SLUG.test(m.slug) || m.provider_id === "prv_workers_ai";
    const backend = m.backend_id ?? (m.provider_id === "prv_workers_ai" ? "bk_workers_ai" : m.provider_id === "prv_openrouter" ? "bk_openrouter" : m.provider_id);
    const b = rows.backends.find((x) => x.id === backend);
    const trains = isPrivateModelRoute(m.data_use) === false; // a route that is NOT non-training may keep the prompt
    const refusedForContent = Boolean(privacy?.private_model_only) && trains;
    const eligible = Boolean(b && b.status === "enabled") && !refusedForContent;
    out.push({
      position: out.length + 1,
      kind: free ? "free_rung" : "paid_rung",
      backend_id: backend,
      model: m.slug,
      label: `${m.display_name} — rung ${m.ladder_rung}`,
      cost: free ? "$0 (free tier)" : `paid — ${m.in_micros_1k}/${m.out_micros_1k} micros per 1k`,
      eligible,
      why: !b || b.status !== "enabled"
        ? `backend ${backend} is ${b?.status ?? "missing"}`
        : refusedForContent
          ? `training-permitting (${m.data_use}); the router refuses it for this content — ${privacy?.why}`
          : free ? "free rung, walked by the cloud router if both seats refuse" : `paid rung${trains ? "" : ", non-training"}; the last resort`,
    });
  }
  return out;
}

/** The router's verdict on a prompt, for the ladder printout. */
export async function briefingPrivacyVerdict(db: D1Database, prompt: string, lexicon?: PrivateLexicon): Promise<{ private_model_only: boolean; why: string }> {
  const lex = lexicon ?? (await privateLexicon(db));
  const v = scanForModelAccess([{ role: "user", content: prompt }], lex, { modelAccess: "public_model_approved" });
  return { private_model_only: v.access === "private_model_only", why: v.reason };
}

/** The same list, read from D1; with a prompt, the router's privacy verdict is applied to the rungs. */
export async function resolveBriefingCandidates(db: D1Database, now = Date.now(), prompt?: string | null): Promise<Candidate[]> {
  const backends = (await db.prepare(`SELECT id, status, class, monthly_ceiling_micros, spent_micros, window_started_at, exhausted_until, exhausted_reason FROM execution_backends`).all<BackendRow>()).results ?? [];
  const models = (await db.prepare(
    `SELECT m.id, m.provider_id, m.slug, m.display_name, m.capability_tier, m.enabled,
            m.in_micros_1k, m.out_micros_1k, m.ladder_rung, m.data_use, p.enabled AS provider_enabled
       FROM models m JOIN providers p ON p.id = m.provider_id`,
  ).all<ModelRow>()).results ?? [];
  const privacy = prompt ? await briefingPrivacyVerdict(db, prompt) : null;
  return orderBriefingCandidates({ backends, models }, now, privacy);
}

/** One line per rung, for a terminal or a PR body. */
export function renderLadder(candidates: Candidate[]): string {
  return candidates
    .map((c) => `${String(c.position).padStart(2)}. ${c.eligible ? "✓" : "✗"} ${c.kind.padEnd(9)} ${c.backend_id.padEnd(15)} ${(c.model ?? "(seat default)").padEnd(48)} ${c.cost.padEnd(34)} ${c.why}`)
    .join("\n");
}

/**
 * WHAT THE BRIEFING DECLARES ABOUT ITSELF, SO THE ROUTER DOES NOT HAVE TO GUESS.
 *
 * Measured on 19 Sep 2026, in the first test of the cloud fall-through: intake read the briefing's
 * prompt, matched "trading", "spend" and "private_terms" on its wording, and classified the task
 * `risk: high, model_access: private_model_only`. The cloud router then refused every free rung
 * at privacy (they train on prompts) and every paid rung at capability (cleared to low risk) —
 * "No model on this route satisfied policy: 7 of 14 refused". The ladder below the seats was
 * unreachable, by a guess.
 *
 * The briefing is PUBLIC-MARKET RESEARCH. Its prompt carries no LP name, no deal term and no
 * instruction to spend or send anything; the report is read by her and acted on by nobody in this
 * system. So the duty declares the three axes rather than leaving them to a word match — the same
 * rule PR #22 wrote down: a guessed sensitivity may not decide where work runs. A DECLARED one may.
 *
 * `public_model_approved` is what lets a `:free` rung take it; the LP-name rule the router enforces
 * for genuinely private work is untouched and still refuses those lanes for tasks that carry one.
 */
export const BRIEFING_CLASSIFICATION = {
  risk: "low",
  sensitivity: "public",
  model_access: "public_model_approved",
} as const;
