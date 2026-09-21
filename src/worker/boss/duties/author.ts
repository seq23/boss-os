import type { Env } from "../env";
import { dutyProblems, hourIn, pickSlot, scriptIn, weekdayIn } from "../../../shared/boss/duties/lane.mjs";

/**
 * SHE DESCRIBES A DUTY IN HER OWN WORDS; THIS DRAFTS THE PROPER VERSION.
 *
 * ─── What she asked for ────────────────────────────────────────────────────
 *
 *   "is there an area where i can see all employees pre-set duties? and i can add duties? and maybe
 *    the system can help me prompt that. like for instance if i say 'simone - handle all KDP and
 *    ebook publishing stuff' then a proper prompt builds for simone to own everything related to
 *    that"
 *
 * So the input is an employee, a domain, and an expectation of ownership. Everything else is this
 * file's job.
 *
 * ─── WHERE A MODEL WOULD HELP, AND WHERE IT WOULD LIE ──────────────────────
 *
 * Turning her phrase into readable prose is model work. Deciding the CADENCE, the MODEL TIER, the
 * EXECUTOR and the DELIVERY ROUTE is not — those are lookups against rules this system already
 * enforces, and a model asked for them returns something plausible-sounding and occasionally wrong.
 * A plausible wrong cadence is a duty that fires at the wrong time for ever; a plausible wrong
 * executor is a duty that cannot run at all.
 *
 * So the draft is DERIVED, every field is shown to her before anything is created, and she can
 * override any of it. The one genuinely generative part — the task prompt — is composed from a
 * template that carries her standing rules, because those rules are the same every time and a model
 * rewriting them each week is how they drift.
 *
 * ─── THE INVARIANTS ARE CHECKED AT AUTHORING TIME, NOT AT 6AM ──────────────
 *
 * Every one of these already has a validator that catches it AFTER THE FACT. Catching them here is
 * the point: a duty that cannot work should be impossible to create rather than discovered on its
 * first run, when the failure lands on whoever opened the screen.
 *
 *   · A `delivers` key with no handler is an inert duty. `duty_practice_week` had one and ran every
 *     Sunday for eleven weeks into a handler that did not exist.
 *   · A duty that names no model silently runs the most expensive one available — the defect that
 *     made a single briefing cost $3.88.
 *   · Anything needing her mailbox, the vault or `gh` cannot be an agent: the Claude Code runner
 *     strips those credentials on purpose. It has to be a local job or it will fail silently.
 *   · A new duty changes the monthly total, and she gets that figure against the ceiling BEFORE she
 *     confirms rather than in a bill afterwards.
 */

/** Everything the Worker can actually deliver into. A key not here makes an inert duty. */
export const DELIVERABLE_KEYS = [
  "executive_reports",
  "sourcing_candidates",
  "link_prospects",
  "tool_suggestions",
  "practice_week",
] as const;

/**
 * Words that mean "this needs a credential the runner strips".
 *
 * DELIBERATELY GENEROUS. A false positive makes a duty a local job that could have been an agent —
 * mildly inconvenient. A false negative makes a duty that fails at its first tool call every morning
 * and reports success, which is the failure this system spent the day removing.
 */
const NEEDS_LOCAL = /\b(mail|inbox|email|gmail|calendar|vault|secret|password|search console|analytics|github|gh |repo|publish|kdp|amazon|spreadsheet|sheet|drive)\b/i;

/** Words that mean the work is judgement rather than summarising, and worth the better model. */
const NEEDS_JUDGEMENT = /\b(decide|judge|assess|evaluate|negotiat|recommend|match|qualify|diligence|strateg)\b/i;

export interface DutyDraft {
  employee_id: string;
  employee_name: string;
  /** False when the seat is retired, merged or suspended — a duty cannot be given to her. */
  employee_active: boolean;
  name: string;
  cadence: "daily" | "weekly";
  weekday: number | null;
  local_hour: number;
  local_minute: number;
  timezone: string;
  executor: "agent" | "local_job";
  model: string;
  model_reason: string;
  executor_reason: string;
  cadence_reason: string;
  delivers: string | null;
  delivers_reason: string;
  local_job: string | null;
  task_prompt: string;
  success_criteria: string;
  estimated_per_run_usd: number;
  estimated_per_month_usd: number;
  /** What the whole schedule would cost with this one added, against the ceiling. */
  monthly_total_after_usd: number;
  ceiling_usd: number;
  over_ceiling: boolean;
  /** Anything that would make this duty inert, in words. Non-empty means it cannot be created. */
  refusals: string[];
}

/**
 * Her standing rules, carried on every duty this produces rather than rewritten each time.
 *
 * A GENERATED PROMPT THAT RESTATES THE RULES IN ITS OWN WORDS IS HOW THEY DRIFT. These are the four
 * that govern every employee and they are pasted verbatim, so a duty written in November says what a
 * duty written today says.
 */
export const STANDING_RULES = [
  "You own this. If something blocks it, say so immediately and keep saying so until it clears — you",
  "cannot quietly drop it, and silence is treated as the alarm rather than as calm.",
  "",
  "Report completion when the work is actually TRUE in the world, not when you have finished acting.",
  "A button pressed is not a result; go and check, and say which parts are done and which are not.",
  "",
  "Decide and fix. Do not hand back a list of things you noticed. Where two options exist, take the",
  "better one and say what you chose and why. The only legitimate stop is something only she can",
  "supply, and that is reported as a named stop with the exact steps rather than as a failure.",
  "",
  "A run that examined nothing has not succeeded. If there was nothing to do, say that plainly —",
  "it is a different fact from a run that could not happen, and both must be distinguishable.",
].join("\n");

const CEILING_USD = 25;

/**
 * Draft a duty from a sentence.
 *
 * `phrase` is hers — "handle all KDP and ebook publishing stuff". `employeeId` is who she named.
 */
export async function draftDuty(
  env: Env,
  employeeId: string,
  phrase: string,
  overrides: Partial<DutyDraft> = {},
): Promise<DutyDraft> {
  const employee = await env.DB
    .prepare(`SELECT id, name, role, lane, charter, status, lifecycle FROM employees WHERE id = ?`)
    .bind(employeeId)
    .first<{ id: string; name: string; role: string; lane: string; charter: string | null; status: string; lifecycle: string }>();
  const employeeActive = Boolean(employee && employee.status === "active" && ["active", "provisional"].includes(employee.lifecycle));

  const refusals: string[] = [];
  if (!employee) refusals.push(`There is no employee ${employeeId}, so nobody would own this.`);

  const text = phrase.trim();
  if (text.length < 8) {
    refusals.push("The description is too short to write a duty from. A phrase like \"handle all KDP and ebook publishing\" is enough; two words is not.");
  }

  /*
   * ── EXECUTOR: A LOOKUP, NOT A GUESS ──────────────────────────────────────
   *
   * The Claude Code runner strips every variable matching KEY, TOKEN, SECRET or PASSCODE before the
   * process starts. That is deliberate and it is not negotiable, so anything touching her accounts
   * runs from launchd on her Mac. Getting this wrong produces a duty that fails at its first tool
   * call every morning — and reports success, because a duty's success criterion is that it fired.
   */
  const local = NEEDS_LOCAL.test(text);
  const executor: "agent" | "local_job" = overrides.executor ?? (local ? "local_job" : "agent");
  const executorReason = local
    ? "This needs one of your accounts — mail, a calendar, the vault, a repository — and an agent has none of those: the runner strips every credential before it starts. So it runs as a job on your Mac, which is the only thing that can do the work. You own it; the job is how it executes."
    : "This is open-web research and drafting, which an agent can do. Nothing here needs a credential of yours.";

  /*
   * ── MODEL: NAMED, ALWAYS, AND CHEAP UNLESS THE WORK IS JUDGEMENT ─────────
   *
   * A duty that names no model inherits the default, which is the most expensive one available. That
   * is what made one briefing cost $3.88. Classification and summarising get Haiku; deciding whether
   * a firm buys at her size gets the better model, because a wrong yes costs her a phone call and
   * some credibility.
   */
  const judgement = NEEDS_JUDGEMENT.test(text);
  const model = overrides.model ?? (judgement ? "claude-sonnet-4-5-20250929" : "claude-haiku-4-5-20251001");
  const modelReason = judgement
    ? "This asks for a judgement rather than a summary, so it gets the better model deliberately — the same reason buyer sourcing keeps it. A wrong call here costs more than the difference in price."
    : "Reading and classifying does not need the expensive model. Named explicitly, because a duty that names none silently runs the dearest one available — that is what made a single briefing cost $3.88.";

  /*
   * ── CADENCE: DERIVED FROM HER WORDS, DEFAULTING TO WEEKLY ────────────────
   *
   * Weekly rather than daily by default, because the cost of a duty that fires too often is
   * measured in both money and in her attention, and the cheapest correction is her changing it
   * before confirming.
   */
  const wantsDaily = /\b(daily|every day|each day|each morning|every morning)\b/i.test(text);
  const cadence: "daily" | "weekly" = overrides.cadence ?? (wantsDaily ? "daily" : "weekly");
  const namedDay = weekdayIn(text);
  const weekday = cadence === "weekly" ? (overrides.weekday ?? namedDay ?? 1) : null;
  const dayReason = cadence === "weekly"
    ? (overrides.weekday !== undefined ? `On ${DAY_NAMES[weekday!]}, as you changed it.` : namedDay !== null ? `On ${DAY_NAMES[weekday!]}, because you said so.` : "On Monday, because you named no day; say one and it moves.")
    : "";
  const cadenceWhy = wantsDaily
    ? "You said daily, so daily."
    : "Weekly unless you say otherwise. A duty that fires more often than the work changes costs money and attention, and it is easier to make this daily now than to notice later that it should not have been.";

  /*
   * ── THE SLOT: AN EMPTY HOUR, NEVER A GUESS AT ONE ─────────────────────────
   *
   * Her phrase usually gives a day and not an hour. The hour is chosen against what already fires
   * — every duty row in D1, which is where every launchd duty's time lives too — and against the
   * hours that are hers (the briefing, the Mac's other jobs). The reason is on the draft so she
   * can move it with one line.
   */
  const namedHour = hourIn(text);
  const taken = await existingDuties(env);
  let localHour: number;
  let localMinute: number;
  let slotReason: string;
  if (overrides.local_hour !== undefined) {
    localHour = overrides.local_hour; localMinute = overrides.local_minute ?? 0;
    slotReason = `At ${pad(localHour)}:${pad(localMinute)}, as you changed it.`;
  } else if (namedHour) {
    localHour = namedHour.hour; localMinute = namedHour.minute;
    slotReason = `At ${pad(localHour)}:${pad(localMinute)}, because you said so.`;
  } else {
    const slot = pickSlot(taken, { cadence, weekday });
    localHour = slot.hour; localMinute = slot.minute;
    slotReason = slot.why;
  }
  const cadenceReason = `${cadenceWhy} ${dayReason} ${slotReason}`.replace(/\s+/g, " ").trim();

  /*
   * ── DELIVERY: THE INVARIANT THAT MADE A DUTY RUN FOR ELEVEN WEEKS INTO NOTHING ──
   *
   * A local job posts its own result to its own endpoint, which is why it needs no `delivers` key.
   * An AGENT duty must name one, and it must be a key `deliverReport.ts` actually handles — the
   * whole of `duty_practice_week`'s failure was a key with no handler, delivering into the floor
   * while every signal said it worked.
   */
  const delivers = overrides.delivers ?? (executor === "local_job" ? null : matchDeliverable(text));
  const deliversReason =
    executor === "local_job"
      ? "A local job posts its own result through duty-run.sh, so it needs no delivery key — it needs its script installed on your Mac. If it is not, the refusal below names the script and the steps."
      : delivers
        ? `Its output lands in \`${delivers}\`, which has a handler and a screen already.`
        : "Nothing here matches a delivery route this system has, so its output would land nowhere.";

  /*
   * ── THE OWNER ↔ EXECUTOR ↔ SCRIPT CHECK, AT DRAFT TIME ──────────────────
   *
   * `dutyProblems` in the shared lane is the one rule: an active owner, a named model, an agent
   * duty delivering into a handler that exists, a local job naming a script the installer knows
   * that no other duty claims. `create.ts` runs the same function again at the moment of creation.
   * Anything it returns is a refusal she reads verbatim — a NAMED STOP for a script that does not
   * exist yet, never a duty created inert.
   */
  const localJob = executor === "local_job" ? (overrides.local_job ?? scriptIn(text) ?? `${slug(text)}.sh`) : null;
  refusals.push(...dutyProblems(
    { employee_id: employeeId, employee_name: employee?.name, employee_active: employeeActive, model, executor, delivers, local_job: localJob },
    taken,
    DELIVERABLE_KEYS,
  ));

  /*
   * ── THE COST, BEFORE SHE CONFIRMS RATHER THAN AFTERWARDS ─────────────────
   *
   * Estimates, and named as estimates: a real brokerage sourcing run cost $1.99 against an estimate
   * of $0.30. The arithmetic that CAN be proved is the total against the ceiling, and that is what
   * decides whether this is affordable.
   */
  const perRun = judgement ? 0.3 : 0.05;
  const runsPerMonth = cadence === "daily" ? 30 : 4.3;
  const perMonth = Math.round(perRun * runsPerMonth * 100) / 100;
  const committed = await committedMonthlyUsd(env);
  const after = Math.round((committed + perMonth) * 100) / 100;

  const name = overrides.name ?? titleFor(text, employee?.name ?? employeeId);

  return {
    employee_id: employeeId,
    employee_name: employee?.name ?? employeeId,
    employee_active: employeeActive,
    name,
    cadence,
    weekday,
    local_hour: localHour,
    local_minute: localMinute,
    timezone: "America/Chicago",
    executor,
    model,
    model_reason: modelReason,
    executor_reason: executorReason,
    cadence_reason: cadenceReason,
    delivers,
    delivers_reason: deliversReason,
    local_job: localJob,
    task_prompt: composePrompt(employee?.name ?? employeeId, employee?.role ?? "", text, name),
    success_criteria: successFor(text),
    estimated_per_run_usd: perRun,
    estimated_per_month_usd: perMonth,
    monthly_total_after_usd: after,
    ceiling_usd: CEILING_USD,
    over_ceiling: after > CEILING_USD,
    refusals,
  };
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = (n: number) => String(n).padStart(2, "0");

/** Every duty that exists, with its fire time and its script — what a slot and a script are checked against. */
export async function existingDuties(env: Env): Promise<Array<{ id: string; name: string; cadence: string; weekday: number | null; local_hour: number; local_job: string | null }>> {
  const rows = await env.DB
    .prepare(`SELECT id, name, cadence, weekday, local_hour, json_extract(task_input, '$.local_job') AS local_job FROM standing_duties WHERE suspended = 0`)
    .all<{ id: string; name: string; cadence: string; weekday: number | null; local_hour: number; local_job: string | null }>()
    .catch(() => ({ results: [] as any[] }));
  return ((rows as { results?: any[] }).results ?? []) as any;
}

/** What the schedule already commits to, from the duties that exist. */
async function committedMonthlyUsd(env: Env): Promise<number> {
  const rows = await env.DB
    .prepare(`SELECT cadence, task_input FROM standing_duties WHERE suspended = 0`)
    .all<{ cadence: string; task_input: string | null }>()
    .catch(() => ({ results: [] as any[] }));
  let total = 0;
  for (const d of (rows as { results?: any[] }).results ?? []) {
    let model = "";
    try { model = JSON.parse(d.task_input ?? "{}")?.requested?.model ?? ""; } catch { model = ""; }
    const perRun = model.includes("sonnet") ? 0.3 : 0.05;
    total += perRun * (d.cadence === "daily" ? 30 : 4.3);
  }
  return Math.round(total * 100) / 100;
}

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

function titleFor(phrase: string, who: string): string {
  const trimmed = phrase.replace(/^\s*[a-z]+\s*[-–—:]\s*/i, "").trim();
  const short = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return `${short.slice(0, 90)} — ${who}`;
}

function matchDeliverable(text: string): string | null {
  if (/\b(report|briefing|intelligence|news)\b/i.test(text)) return "executive_reports";
  if (/\b(buyer|acquirer|sourcing|prospect firm|counterpart)\b/i.test(text)) return "sourcing_candidates";
  if (/\b(backlink|link|domain|outreach target)\b/i.test(text)) return "link_prospects";
  if (/\b(tool|software|saas|subscription)\b/i.test(text)) return "tool_suggestions";
  if (/\b(practice|ritual|movement|somatic)\b/i.test(text)) return "practice_week";
  return null;
}

function successFor(text: string): string {
  return (
    `The work described — ${text.trim()} — is actually happening rather than merely being attempted. ` +
    "A run that found nothing to do says so; a run that could not happen says that instead, and the two are never confused. " +
    "Anything blocking it is on her screen the same day, with what it is waiting on and who can clear it."
  );
}

/**
 * The prompt itself.
 *
 * COMPOSED FROM A TEMPLATE RATHER THAN GENERATED, and the standing rules are pasted verbatim. Those
 * rules are the same for every employee every time; a model rewriting them each week is how a rule
 * becomes a suggestion. Her sentence is what varies, and it is quoted rather than paraphrased so the
 * duty says what she asked for rather than what something inferred.
 */
export function composePrompt(who: string, role: string, phrase: string, name: string): string {
  return [
    `${name}.`,
    "",
    `You are ${who}${role ? `, ${role}` : ""}, and this is a standing duty she has given you to own.`,
    "",
    "## What she asked for, in her words",
    "",
    `> ${phrase.trim()}`,
    "",
    "Take that as the whole scope. Where it is ambiguous, take the reading that covers more of what",
    "she plainly meant rather than the narrowest one — she said OWN it.",
    "",
    "## How you work",
    "",
    STANDING_RULES,
    "",
    "## What to report",
    "",
    "One or two sentences about what you found and what you decided, in your own words. Never a",
    "quotation and never an address — anything containing an '@' is refused outright, and a refused",
    "report reads on her screen as a missing one.",
    "",
    "She hears from you in exactly two situations: something needs her judgement or her hands, or",
    "something finished. Never \"I checked today\".",
  ].join("\n");
}
