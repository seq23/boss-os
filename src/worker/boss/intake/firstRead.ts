/**
 * EVERY EMAIL OF HERS GETS A FIRST READ (15 Nov 2026, the West Peek OS #460 rule brought to Boss OS).
 *
 * Before the job is filed, a model reads her email and writes a BRIEF onto it: each thing she asked
 * (her exact words), each hold (what must not happen yet), each question of hers the result must
 * answer, each item that is unclear (her words, and what is missing), and each file with what it is
 * for. The brief is a reading aid, nothing more:
 *
 *   · THE MODEL NEVER PICKS THE SEAT. Routing stays the rules in inboundMail.ts (tag, handoff,
 *     triage). The brief is written onto jobs the rules already chose.
 *   · EVERY LINE IS CHECKED AGAINST HER TEXT. An ask, hold, question or unclear item the model wrote
 *     that is not in her own words is dropped (`parseBrief`), so the brief can only quote her.
 *   · THE LADDER IS FREE, AND ONLY FREE, IN HER ORDER (19 Nov 2026): Google's free Gemini rows in D1
 *     (`routeIsBilled` false), then Workers AI capped at
 *     `FIRST_READ_DAILY_CAP` reads a day (claimed in D1 before the call: NAMED STOP
 *     [FIRST_READ_FREE_CAP] at the cap, never paid past it), then no first read at all: the rules
 *     read her email exactly as before. Never a Claude or Codex seat, never a paid API.
 *   · IT IS NOT BLOCKED BY THE PRIVATE-TERM CHECK. Her ruling, 15 Nov 2026: Boss OS ignores the
 *     private-email rules (they are West Peek OS's; LP names in Boss OS are prospects). So this calls
 *     the free adapters directly instead of going through `routeCompletion`, whose content scan would
 *     move an email naming a prospect off every free route. The repo-level "no LP names in the repo"
 *     checks are untouched: nothing here writes to the repo.
 *   · INSIDE THE WORKER, NO WAIT. One bounded pass in the same run that answers her
 *     (`FIRST_READ_BUDGET_MS` in all), so the Got it can list the brief's asks and questions.
 */
import type { Env } from "../env";
import { logEvent } from "../lib/log";
import { WIRING_BY_PROVIDER, adapterCredential } from "../router/backends";
import { routeIsBilled } from "../backends/guard";
import { claimFreeSearch, centralDay } from "../research/searchQuota";
import { freeDayStartedAt, recordOutcome } from "../router/experience";
import { READ_MODES, type ReplyMode } from "../../../shared/boss/repoChange/lane.mjs";
import { readJsonObject, type JsonOutput } from "../router/types";
import { privateLexicon, scanForModelAccess } from "../router/modelAccess";
import { INTAKE_KINDS, type IntakeKind, type RiskLevel } from "../../../shared/boss/governance";
import { quoteStands } from "../../../shared/boss/text/wholeSentence.mjs";

export const FIRST_READ_SERVICE = "svc_workers_ai_first_read";
/** Workers AI first reads a day (Central). Also in FREE_ROUTES; the two are pinned together by test. */
export const FIRST_READ_DAILY_CAP = 40;
export const FIRST_READ_STOP = "FIRST_READ_FREE_CAP";
/** The whole ladder, wall clock. */
export const FIRST_READ_BUDGET_MS = 30_000;
/** One rung at most. */
export const FIRST_READ_ATTEMPT_MS = 12_000;
/** What the free rungs before Workers AI must leave it. */
export const WORKERS_AI_RESERVE_MS = 10_000;
/** Free rungs asked at once: a hanging rung no longer holds the ones behind it. */
export const FREE_AT_ONCE = 3;
/** The least time a free rung is given (a good free read took 3 s in the 15 Nov dry run). */
export const MIN_RUNG_MS = 4_000;
/** The outcome kind that remembers a free rung's spent quota (model_job_outcome, nothing new stored). */
export const QUOTA_KIND = "first_read_quota";
/** The Workers AI rung's model: the general one already provisioned for this account. */
export const WORKERS_AI_FIRST_READ_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
/** More unclear items than this and she is given the best reading of each to correct, not a quiz. */
export const MAX_PLAIN_QUESTIONS = 5;
const MAX_ITEMS = 12;

export interface Brief {
  asks: string[];
  holds: string[];
  /** Her own questions: the result answers each. */
  questions: string[];
  /** What is unclear: her words, what is missing, and the best reading of it. */
  unclear: Array<{ words: string; missing: string; best: string | null }>;
  files: Array<{ filename: string; purpose: string }>;
  /** What her reply decides (her DECISION line), or null when the read gave none. */
  decision?: ReplyDecision | null;
  /**
   * ONE READ PER EMAIL ANSWERS EVERY DOOR (eng sweep row 7b, #514 review). The code found these changes in her words
   * (a list edit, a duty edit, a deadline: `BriefInput.checks`, numbered from 1); the model says of each whether her
   * words ASK for it. "asks" holds only with a quote that stands in her sentence (else it is read "unsure"); a check the
   * model left out is absent, which every door reads as unsure.
   */
  checks?: Record<number, { meaning: CheckMeaning; quote: string | null }>;
  /** Her words that send the result outside her team, or null. Tighten-only: it can make work external, never internal. */
  outside?: string | null;
  /** The kind of work and its risk, by the model. Read tighten-only by `admitTask`. */
  kind?: IntakeKind | null;
  risk?: RiskLevel | null;
}
export type CheckMeaning = "asks" | "not" | "unsure";
const CHECK_MEANINGS = ["asks", "not", "unsure"] as const;
const RISKS = ["low", "medium", "high"] as const;

/**
 * WHAT HER REPLY DECIDES, BY THE FIRST READ (owner ruling, 19 Nov 2026). `reply` is what her reply to an approval
 * email means (a plan, a preview, a Kindle ask, any one-word approval): approved, preview, forced (her named "approved
 * to production"), held, or answers (her own words carry the decision). `answers` are her answers to numbered items
 * ("2: send it Monday"). The reply doors act on this; their keywords are the logged last resort.
 */
export interface ReplyDecision {
  reply: ReplyMode | null;
  answers: Array<{ n: number; text: string }>;
  /**
   * Her plain-word commands, each quoting her (`text`): the morning email's drop / gate / grateful / public / rule, the
   * one LP nudge (text = the address), and a comment digest's per-number instruction (`comment`, n = the comment) or
   * "your call" for all of it. An empty list is a reading too: she gave no command, so no keyword acts.
   */
  commands: ReplyCommand[];
}
export const COMMAND_KINDS = ["drop", "gate", "grateful", "public", "rule", "nudge", "comment", "your_call"] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];
const COMMENT_ACTIONS = ["approve", "hide", "ignore", "reply_as_drafted", "reply"] as const;
/** `action` only on a comment: one of approve, hide, ignore, reply_as_drafted, reply (commentWatch READ_ACTIONS). */
export interface ReplyCommand { kind: CommandKind; n: number | null; text: string; action?: string | null }

export interface FirstRead {
  brief: Brief | null;
  /** The model that wrote it, or null. */
  reader: string | null;
  /** Each rung tried, and what happened. */
  tried: string[];
  /** A named stop, when the free ladder ran out (the cap). */
  stop: string | null;
}

/** What a model is: one call, the text back. Tests pass their own. */
export type Rung = { id: string; call: (prompt: string, signal: AbortSignal, json?: JsonOutput) => Promise<string>; workersAi?: boolean; /** The `models` row, so a spent quota is remembered. */ modelId?: string };

const norm = (s: string): string => s.toLowerCase().replace(/[“”"'‘’`]/g, "").replace(/\s+/g, " ").trim().replace(/^[\s\-–—•*:.,;!?]+|[\s\-–—•*:.,;!?]+$/g, "");
const unquote = (s: string) => s.trim().replace(/^["“]|["”]$/g, "").trim();

/**
 * THE SHAPE OF A FIRST READ (eng sweep row 8, 22 Nov 2026). The model answers one JSON object held to
 * this schema by its provider's structured output (router/types.ts `json`), so the brief is read from
 * fields, never fished out of `ASK:` / `DECISION:` labels in prose. Each ask says whether she wrote it
 * or pasted it: the model reads that, where a keyword list over its own read used to guess it.
 */
const STR = { type: "string" } as const;
const strList = { type: "array", items: STR } as const;
export const BRIEF_SCHEMA = {
  type: "object",
  properties: {
    asks: {
      type: "array",
      items: { type: "object", properties: { words: STR, from: { type: "string", enum: ["her", "pasted"] } }, required: ["words", "from"] },
    },
    holds: strList,
    questions: strList,
    unclear: {
      type: "array",
      items: { type: "object", properties: { words: STR, question: STR, best: STR }, required: ["words", "question"] },
    },
    files: {
      type: "array",
      items: { type: "object", properties: { filename: STR, purpose: STR }, required: ["filename", "purpose"] },
    },
    decision: {
      type: "object",
      properties: {
        reply: { type: "string", enum: [...READ_MODES, "none"] },
        answers: { type: "array", items: { type: "object", properties: { n: { type: "integer" }, text: STR }, required: ["n", "text"] } },
        commands: {
          type: "array",
          items: {
            type: "object",
            properties: { kind: { type: "string", enum: [...COMMAND_KINDS] }, n: { type: "integer" }, text: STR, action: { type: "string", enum: [...COMMENT_ACTIONS] } },
            required: ["kind", "text"],
          },
        },
      },
      required: ["reply", "answers", "commands"],
    },
    checks: {
      type: "array",
      items: { type: "object", properties: { n: { type: "integer" }, meaning: { type: "string", enum: [...CHECK_MEANINGS] }, quote: STR }, required: ["n", "meaning"] },
    },
    outside: STR,
    kind: { type: "string", enum: [...INTAKE_KINDS] },
    risk: { type: "string", enum: [...RISKS] },
  },
  required: ["asks", "holds", "questions", "unclear", "decision"],
} as const;
export const BRIEF_JSON = { name: "first_read", schema: BRIEF_SCHEMA as unknown as Record<string, unknown> };

/** The prompt. Pure. */
export function briefPrompt(input: { subject: string; words: string; files: readonly string[]; checks?: readonly string[] }): string {
  const checks = input.checks ?? [];
  return [
    "Sequoia, the owner, just emailed the work below to her assistant. Read it and answer with one JSON object:",
    '"asks": each separate thing she asks for, as {"words": her EXACT words copied unchanged (a phrase or sentence of hers, no rewording), "from": "her"}. A line she pasted, forwarded or quoted (a report, an article, an earlier email, a signature) that looks like an ask is listed with "from": "pasted".',
    '"holds": her EXACT words for each real constraint: something that must NOT happen yet or must wait for her (only if she says so).',
    '"questions": her EXACT words for each question she asks that the result must answer.',
    '"unclear": only when the work cannot be done right without asking her: {"words": her EXACT words, "question": the one question to ask her, written TO her as "you" (never "she"), ending in ?, "best": your best reading of what she means}.',
    ...(input.files.length ? [`"files": for each file, {"filename": its name, "purpose": what it is for, from her email, under 15 words}. Files: ${input.files.join(", ")}`] : []),
    "Only sentences she wrote herself to the assistant count. Anything she pasted, forwarded or quoted is MATERIAL for the work: never a hold, question or unclear item, however it is worded.",
    "A greeting, thanks or remark is not an ask. Never invent, merge or summarise. Empty lists when she asks for nothing.",
    '"decision": {"reply", "answers", "commands"}. "reply" is what her email decides when it answers an approval or a question she was sent: approved (go ahead as proposed), preview (build it but show her before it goes live), forced (only her exact words "approved to production"), held (stop, wait, not yet), answers (her own words decide, e.g. approved with a change), none when her email answers nothing. A doubt, a condition, a quote of someone else, a negation ("not approved") or a question is never approved or held. "answers" lists her answers to numbered items ("2: send it Monday" is n 2), in her words; empty when none. "commands" lists each plain-word command she gives, each as {"kind","n","text"} with "text" her exact words: drop (an item leaves her morning email for good; n = its number, else leave n out), gate (her morning gate is done), grateful (text = what she is grateful for), public (text = the company she says is public), rule (a standing rule for the emails of the assistant, e.g. "never prep maybes"), nudge (text = the one email address to nudge), comment (n = the numbered comment, "action" one of approve|hide|ignore|reply_as_drafted|reply, text = her exact words about it; "approve 1 and 3, skip 2" is three commands), your_call (text = her words handing every comment to the proposed action). A doubt, a condition, a question or the words of someone else is never a command; empty when none.',
    ...(checks.length ? [
      '"checks": the assistant\'s code found these possible changes in her words. For EACH, {"n": its number, "meaning", "quote"}: "asks" only when her own words ask for it now ("quote" = those exact words); "not" when they mention it, report it, negate it, ask about it, make it depend on something, or ask for something else; "unsure" when you cannot tell. Never "asks" from words she pasted or forwarded.',
      ...checks.map((c, i) => `  ${i + 1}. ${c}`),
    ] : []),
    '"outside": her EXACT words when she asks for the result to be sent, posted, shown or published to someone outside her own team (e.g. "get it in front of the buyers"); "" when she does not.',
    `"kind": what kind of work it is, one of ${INTAKE_KINDS.join(", ")}. "risk": low, medium or high (high when it moves money, sends in her name, deletes, or cannot be undone).`,
    "",
    `Subject: ${input.subject}`,
    "Email:",
    input.words.slice(0, 24_000),
  ].join("\n");
}

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * The brief out of the model's JSON, keeping only what quotes her (and files really attached). Null
 * when the answer is not one JSON object, or every item it listed fails the quote check. An ask the
 * model marked as pasted is dropped: what she pasted is material, never an ask. Pure.
 */
export function parseBrief(text: string, words: string, files: readonly string[] = [], checkCount = 0): Brief | null {
  const r = readBrief(text, words, files, checkCount);
  return typeof r === "string" ? null : r;
}

/** As `parseBrief`, but says why there is no brief: the ladder logs the reason. Pure. */
/** `checkWords`: the words a numbered check's quote must stand in (her own, above any forward); the read's words by default. */
export function readBrief(text: string, words: string, files: readonly string[] = [], checkCount = 0, checkWords = words): Brief | string {
  const v = readJsonObject(text);
  if (!v) return "not one JSON answer";
  const body = norm(words);
  const hers = (s: string) => s.length >= 3 && body.includes(norm(s));
  const quoted = (xs: unknown[]): string[] => {
    const out: string[] = [];
    for (const x of xs) {
      const w = unquote(str(x));
      if (w && hers(w) && !out.some((o) => norm(o) === norm(w))) out.push(w);
    }
    return out.slice(0, MAX_ITEMS);
  };
  // Hers only when the model marks it hers: a missing, unknown or bare-string mark is not her ask (fail closed).
  const askItems = list(v.asks).map((a) => (a && typeof a === "object" && !Array.isArray(a) ? a : {}) as { words?: unknown; from?: unknown });
  const asks = quoted(askItems.filter((a) => a.from === "her").map((a) => a.words));
  const pastedOnly = askItems.length > 0 && askItems.every((a) => a.from === "pasted");
  const unclear: Brief["unclear"] = [];
  for (const u of list(v.unclear)) {
    const o = (u ?? {}) as { words?: unknown; question?: unknown; best?: unknown };
    const w = unquote(str(o.words));
    const q = str(o.question);
    if (w && q && hers(w) && !unclear.some((x) => norm(x.words) === norm(w))) unclear.push({ words: w, missing: q.slice(0, 200), best: str(o.best).slice(0, 200) || null });
  }
  const filesOut: Brief["files"] = [];
  for (const f of list(v.files)) {
    const o = (f ?? {}) as { filename?: unknown; purpose?: unknown };
    const name = files.find((x) => x.toLowerCase() === unquote(str(o.filename)).toLowerCase());
    if (name && str(o.purpose) && !filesOut.some((x) => x.filename === name)) filesOut.push({ filename: name, purpose: str(o.purpose).slice(0, 200) });
  }
  const brief: Brief = {
    asks, holds: quoted(list(v.holds)), questions: quoted(list(v.questions)), unclear: unclear.slice(0, MAX_ITEMS), files: filesOut, decision: decisionOf(v.decision, words),
    checks: checksOf(v.checks, checkWords, checkCount),
    outside: ((o) => (o && hers(o) && quoteStands(words, o) ? o : null))(unquote(str(v.outside))),
    kind: (INTAKE_KINDS as readonly string[]).includes(str(v.kind)) ? (str(v.kind) as IntakeKind) : null,
    risk: (RISKS as readonly string[]).includes(str(v.risk)) ? (str(v.risk) as RiskLevel) : null,
  };
  const listed = askItems.length + list(v.holds).length + list(v.questions).length + list(v.unclear).length;
  const kept = brief.asks.length + brief.holds.length + brief.questions.length + brief.unclear.length;
  // Only pasted lines listed and nothing decided: passed over, so the next rung reads it. Something listed
  // and nothing of it quotes her: no brief. An empty answer with a decision object is a reading ("nothing decided").
  if (pastedOnly && kept === 0 && !decides(brief.decision)) return "listed only what she pasted";
  if (listed > 0 && kept === 0 && !decides(brief.decision)) return "no line quoted her";
  return brief;
}

/**
 * The model's answer to each numbered check, read strictly. "asks" must quote her words, and the quote must stand in her
 * sentence (not negated, conditioned, reported or asked: wholeSentence.mjs), else it is "unsure". A number that was not
 * asked is dropped. Pure.
 */
export function checksOf(value: unknown, words: string, count: number): NonNullable<Brief["checks"]> {
  const out: NonNullable<Brief["checks"]> = {};
  const body = norm(words);
  for (const c of list(value)) {
    const o = (c ?? {}) as { n?: unknown; meaning?: unknown; quote?: unknown };
    const n = Number(o.n);
    if (!Number.isInteger(n) || n < 1 || n > count || out[n]) continue;
    const meaning = (CHECK_MEANINGS as readonly string[]).includes(str(o.meaning)) ? (str(o.meaning) as CheckMeaning) : "unsure";
    const quote = unquote(str(o.quote)) || null;
    const standing = meaning !== "asks" || (quote !== null && quote.length >= 3 && body.includes(norm(quote)) && quoteStands(words, quote));
    out[n] = { meaning: standing ? meaning : "unsure", quote };
  }
  return out;
}

/** True when a decision says something: a reading, an answer or a command. An empty one is the model saying "nothing decided". */
export const decides = (d: ReplyDecision | null | undefined): boolean => !!d && (d.reply !== null || d.answers.length > 0 || d.commands.length > 0);

/** Her decision, read strictly: an answer or command that does not quote her, or a reading that is not one of five, is dropped. Null only when the answer carried no decision object. Pure. */
export function decisionOf(value: unknown, words: string): ReplyDecision | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const d = value as { reply?: unknown; answers?: unknown; commands?: unknown };
  const reply = typeof d.reply === "string" && (READ_MODES as readonly string[]).includes(d.reply) ? (d.reply as ReplyMode) : null;
  const body = norm(words);
  const answers = list(d.answers)
    .map((a) => ({ n: Number((a as { n?: unknown })?.n), text: str((a as { text?: unknown })?.text) }))
    .filter((a) => Number.isInteger(a.n) && a.n > 0 && a.n < 100 && a.text.length > 0 && body.includes(norm(a.text)))
    .slice(0, MAX_ITEMS);
  const commands = list(d.commands)
    .map((c) => {
      const o = (c ?? {}) as { kind?: unknown; n?: unknown; text?: unknown; action?: unknown };
      const n = o.n === null || o.n === undefined || o.n === "" ? null : Number(o.n);
      const kind = String(o.kind ?? "").toLowerCase() as CommandKind;
      const action = kind === "comment" && typeof o.action === "string" && (COMMENT_ACTIONS as readonly string[]).includes(o.action) ? o.action : null;
      return { kind, n: n !== null && Number.isInteger(n) && n > 0 && n < 1000 ? n : null, text: String(o.text ?? "").trim(), ...(kind === "comment" ? { action } : {}) };
    })
    .filter((c) => (COMMAND_KINDS as readonly string[]).includes(c.kind) && (c.kind === "gate" || (c.text.length > 0 && body.includes(norm(c.text)))) && (c.kind !== "comment" || (c.n !== null && c.action !== null)))
    .slice(0, MAX_ITEMS);
  // A parsed DECISION line is a reading even when it decides nothing: then no keyword acts on this email.
  return { reply, answers, commands };
}

/**
 * BOTH READINGS ON THE RECORD, every time a reply door decides (owner ruling, 19 Nov 2026; the West Peek OS shape):
 * what the first read said, what the keywords said, and which one acted. "first read absent: keyword fallback" when no
 * first read gave this part. Never throws.
 */
export async function logReplyDecision(env: Env, input: { mailId: string; what: string; firstRead: string | null; keyword: string }): Promise<string> {
  const used = input.firstRead === null ? "KEYWORD" : "FIRST_READ";
  const line = input.firstRead === null
    ? `first read absent: keyword fallback (${input.what}: ${input.keyword}).`
    : input.firstRead === input.keyword
      ? `First read decides ${input.what}: ${input.firstRead} (the keywords agree).`
      : `First read decides ${input.what}: ${input.firstRead}; the keywords read ${input.keyword} and were overruled.`;
  await logEvent(env.DB, { level: "info", scope: "intake", event: "first_read_decides", lane: "ops", entityId: input.mailId, detail: { what: input.what, used, first_read: input.firstRead, keyword: input.keyword, line } }).catch(() => undefined);
  return line;
}

/**
 * The free rungs, in HER order (owner ruling, 19 Nov 2026): Google's free Gemini rows, then Workers AI. Never Claude or
 * Codex, never a paid API, never masked in Boss OS.
 */
export async function freeRungs(env: Env): Promise<Rung[]> {
  const rows = (await env.DB.prepare(
    `SELECT id, slug, provider_id FROM models WHERE enabled = 1 AND provider_id = 'prv_gemini' ORDER BY CASE capability_tier WHEN 'general' THEN 0 ELSE 1 END, id`,
  ).all<{ id: string; slug: string; provider_id: string }>().catch(() => ({ results: [] as Array<{ id: string; slug: string; provider_id: string }> }))).results ?? [];
  const rungs: Rung[] = [];
  for (const r of rows) {
    const wiring = WIRING_BY_PROVIDER.get(r.provider_id);
    if (!wiring || routeIsBilled(wiring.backendId, r.slug) || /^(?:anthropic|openai)\//i.test(r.slug)) continue;
    const cred = adapterCredential(env, wiring);
    if (!cred.available) continue;
    rungs.push({
      id: r.slug,
      modelId: r.id,
      call: async (prompt, signal, json = BRIEF_JSON) => (await wiring.adapter.complete(
        { modelSlug: r.slug, messages: [{ role: "user", content: prompt }], maxOutputTokens: 1200, temperature: 0, json, signal } as never,
        { baseUrl: wiring.baseUrl, apiKey: cred.apiKey, ai: cred.ai },
      )).text,
    });
  }
  const wa = WIRING_BY_PROVIDER.get("prv_workers_ai");
  const waCred = wa ? adapterCredential(env, wa) : null;
  if (wa && waCred?.available) {
    rungs.push({
      id: WORKERS_AI_FIRST_READ_MODEL,
      workersAi: true,
      call: async (prompt, signal, json = BRIEF_JSON) => (await wa.adapter.complete(
        { modelSlug: WORKERS_AI_FIRST_READ_MODEL, messages: [{ role: "user", content: prompt }], maxOutputTokens: 1200, temperature: 0, json, signal } as never,
        { baseUrl: wa.baseUrl, ai: waCred.ai },
      )).text,
    });
  }
  return rungs;
}

const withDeadline = async <T>(ms: number, run: (signal: AbortSignal) => Promise<T>, stop?: AbortSignal): Promise<T> => {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onStop = () => ctl.abort();
  stop?.addEventListener("abort", onStop);
  try {
    return await Promise.race([
      run(ctl.signal),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => { ctl.abort(); reject(new Error(`no answer in ${Math.round(ms / 1000)} s`)); }, ms);
        stop?.addEventListener("abort", () => reject(new Error("stopped: another rung read it first")));
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    stop?.removeEventListener("abort", onStop);
  }
};

/**
 * A SPENT FREE QUOTA COSTS NO TIME (15 Nov 2026 production dry run: gemini-2.5-flash answered 429 on
 * two emails in a row and was asked again each time). A 429 is remembered on the model's row until the
 * window the provider named ("retry in 33s"), or, when it names none, until the free day resets; the
 * rung is skipped before any call until then. Pure: when the rung may be asked again.
 */
export function quotaUntil(message: string, now: number): number | null {
  // A free slug OpenRouter no longer serves free ("unavailable for free", 15 Nov 2026) is out for the day too.
  if (/\b404\b/.test(message) && /unavailable for free/i.test(message)) return freeDayStartedAt(now) + 24 * 3600_000;
  if (!/\b429\b|quota|rate.?limit/i.test(message)) return null;
  const retry = /\[quota: retry in (\d+)s\]/.exec(message);
  if (retry && !/\[quota: daily\]/.test(message)) return now + Number(retry[1]) * 1000;
  return freeDayStartedAt(now) + 24 * 3600_000;
}

/** The free rungs whose quota is spent right now, with when each comes back. Unreadable: none. */
export async function spentRungs(env: Env, now: number): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const rows = await env.DB.prepare(`SELECT model_id, note FROM model_job_outcome WHERE task_kind = ? AND ts > ?`).bind(QUOTA_KIND, now - 24 * 3600_000).all<{ model_id: string; note: string | null }>();
    for (const r of rows.results ?? []) {
      const until = Number(/^until=(\d+)/.exec(String(r.note ?? ""))?.[1] ?? 0);
      if (until > now && until > (out.get(r.model_id) ?? 0)) out.set(r.model_id, until);
    }
  } catch { /* an unreadable log skips nothing: every rung is asked */ }
  return out;
}

const clock = (ms: number) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }).format(new Date(ms));

let rungsOverride: Rung[] | null = null;
/** Tests swap in their own rungs (the invitations seam's shape); null restores the real ladder. */
export function setFirstReadRungs(r: Rung[] | null): void { rungsOverride = r; }

/** One walk of the free ladder: the first rung whose answer `read` accepts wins. */
export interface Ladder<T> { value: T | null; reader: string | null; tried: string[]; stop: string | null }

/**
 * THE ONE FREE MODEL READER (eng sweep rows 7-8, 22 Nov 2026). Every reading of her words or of a reply
 * to her (the first read, and each door's meaning: `meaning.ts`) walks this ladder with its own schema
 * and its own check. `read` turns an answer into a value, or says why it was passed over. `dry` reads
 * without claiming a Workers AI slot. Never throws.
 *
 * PRIVATE TEXT NEVER REACHES A FREE RUNG, BY DEFAULT (private-data-routing; fresh review of #510, F3). Every
 * rung may train on what it reads, so a prompt the router's own content scan would hold to a private
 * model is not sent at all: the ladder answers nothing and its stop says why, and the caller's keywords
 * read it. A lexicon that cannot be built counts as a hit (fail closed). A caller turns the scan off only
 * by naming the ruling that lets it (`privateScanOff`); the first read is the one that does.
 */
export async function freeLadder<T>(
  env: Env,
  input: { prompt: string; json: JsonOutput; read: (text: string) => T | string; budgetMs?: number; now?: number; dry?: boolean; onlyRung?: string | null; privateScanOff?: string },
  rungs?: Rung[],
): Promise<Ladder<T>> {
  const now = input.now ?? Date.now();
  const budget = input.budgetMs ?? FIRST_READ_BUDGET_MS;
  const out: Ladder<T> = { value: null, reader: null, tried: [], stop: null };
  const { prompt, json } = input;
  if (!input.privateScanOff?.trim()) {
    const scan = await privateLexicon(env.DB)
      .then((lex) => scanForModelAccess([{ role: "user", content: prompt }], lex))
      .catch(() => ({ privateOnly: true, kinds: ["the private scan could not run"] }));
    if (scan.privateOnly) { out.stop = `kept off the free models: ${scan.kinds.join(", ")}`; return out; }
  }
  const started = Date.now();
  let ladder: Rung[];
  try { ladder = rungs ?? rungsOverride ?? await freeRungs(env); } catch { ladder = []; }
  // A dry run may name one rung to prove it alone (the replay endpoint's `rung`); a live read never does.
  if (input.dry && input.onlyRung) ladder = ladder.filter((r) => r.id.includes(input.onlyRung!));
  /*
   * EVERY FREE RUNG GETS A TURN, AND WORKERS AI KEEPS ITS TIME (15 Nov 2026 production dry runs: two
   * Gemini rungs ran to their 8 to 12 s deadlines one after the other and the nine free rungs behind
   * them were "out of time (kept for Workers AI)"). Now: a rung whose quota is spent is skipped at no
   * cost; the rest are asked FREE_AT_ONCE at a time, each with a fair share of the free budget (the
   * whole budget less WORKERS_AI_RESERVE_MS), and the first accepted answer wins and stops the others.
   * Workers AI is the backstop, after them, with what is left.
   */
  const spent = await spentRungs(env, now);
  const free: Rung[] = [];
  for (const r of ladder.filter((x) => !x.workersAi)) {
    const until = r.modelId ? spent.get(r.modelId) : undefined;
    if (until) out.tried.push(`${r.id}: skipped, its free quota is out until ${clock(until)} CT`);
    else free.push(r);
  }
  const backstop = ladder.filter((x) => x.workersAi);
  const reserve = backstop.length ? Math.min(WORKERS_AI_RESERVE_MS, Math.floor(budget / 3)) : 0;
  const freeEnd = started + budget - reserve;
  const share = free.length
    ? Math.min(FIRST_READ_ATTEMPT_MS, Math.max(MIN_RUNG_MS, Math.floor(((freeEnd - Date.now()) * Math.min(FREE_AT_ONCE, free.length)) / free.length)))
    : 0;
  const results: Array<string | null> = free.map(() => null);
  const stop = new AbortController();
  let done = false;
  let next = 0;
  const accept = (rung: Rung, text: string): string => {
    const v = input.read(text);
    if (typeof v === "string") return `${rung.id}: ${v}`;
    out.value = v; out.reader = rung.id; done = true;
    return `${rung.id}: read`;
  };
  const ask = async (): Promise<void> => {
    while (!done && next < free.length) {
      const i = next++;
      const rung = free[i]!;
      const left = freeEnd - Date.now();
      if (left < 1500) { results[i] = `${rung.id}: out of time${backstop.length ? " (kept for Workers AI)" : ""}`; continue; }
      try {
        const text = await withDeadline(Math.min(share, left), (signal) => rung.call(prompt, signal, json), stop.signal);
        if (done) { results[i] = `${rung.id}: answered after another read`; continue; }
        results[i] = accept(rung, text);
        if (done) stop.abort();
      } catch (err) {
        const msg = (err instanceof Error ? err.message : String(err));
        results[i] = `${rung.id}: ${msg.slice(0, 120)}`;
        const until = done ? null : quotaUntil(msg, Date.now());
        if (until && rung.modelId && !input.dry) {
          await recordOutcome(env.DB, { taskKind: QUOTA_KIND, modelId: rung.modelId, outcome: "rejected", source: "router", lane: "ops", note: `until=${until} ${msg.slice(0, 200)}` }).catch(() => false);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(FREE_AT_ONCE, free.length) }, ask));
  out.tried.push(...results.filter((r): r is string => r !== null));
  for (const rung of done ? [] : backstop) {
    const left = started + budget - Date.now();
    if (left < 1500) { out.tried.push(`${rung.id}: out of time`); break; }
    const cap = input.dry ? await peekCap(env, now) : await claimFreeSearch(env.DB, FIRST_READ_SERVICE, now).catch(() => ({ ok: false, used: 0, cap: 0 }));
    if (!cap.ok) {
      out.stop = `NAMED STOP [${FIRST_READ_STOP}] Workers AI's free first reads for today are used (${cap.used} of ${cap.cap}); nothing is paid past them, so the rules read this email.`;
      out.tried.push(`${rung.id}: at the free cap`);
      continue;
    }
    try {
      const text = await withDeadline(Math.min(FIRST_READ_ATTEMPT_MS, left), (signal) => rung.call(prompt, signal, json));
      out.tried.push(accept(rung, text));
      if (done) break;
    } catch (err) {
      out.tried.push(`${rung.id}: ${(err instanceof Error ? err.message : String(err)).slice(0, 120)}`);
    }
  }
  return out;
}

/** Why the first read alone skips the private scan: her ruling, quoted in this file's header ("IT IS NOT BLOCKED BY THE PRIVATE-TERM CHECK"). */
export const FIRST_READ_SCAN_OFF = "owner ruling 15 Nov 2026: Boss OS ignores the private-email rules for its own first read (LP names here are prospects); see firstRead.ts header";

/** Walk the free ladder once for the brief. `dry` reads without claiming a Workers AI slot. Never throws. */
export async function firstRead(
  env: Env,
  input: { subject: string; words: string; checkWords?: string; files?: readonly string[]; checks?: readonly string[]; now?: number; dry?: boolean; mailId?: string | null; onlyRung?: string | null },
  rungs?: Rung[],
): Promise<FirstRead> {
  if (!input.words.trim()) return { brief: null, reader: null, tried: [], stop: null };
  const files = input.files ?? [];
  const walk = await freeLadder(env, {
    prompt: briefPrompt({ subject: input.subject, words: input.words, files, checks: input.checks }), json: BRIEF_JSON, now: input.now, dry: input.dry, onlyRung: input.onlyRung,
    privateScanOff: FIRST_READ_SCAN_OFF,
    read: (text) => {
      const brief = readBrief(text, input.words, files, input.checks?.length ?? 0, input.checkWords ?? input.words);
      if (typeof brief === "string") return brief;
      if (!brief.asks.length && !brief.questions.length && !brief.unclear.length && !brief.holds.length && !brief.decision && !Object.keys(brief.checks ?? {}).length && !brief.outside) return "listed nothing";
      return brief;
    },
  }, rungs);
  const out: FirstRead = { brief: walk.value, reader: walk.reader, tried: walk.tried, stop: walk.stop };
  if (!input.dry) {
    await logEvent(env.DB, {
      level: out.brief ? "info" : "warn", scope: "intake", event: "boss_mail_first_read", lane: "ops", entityId: input.mailId ?? undefined,
      detail: { reader: out.reader, tried: out.tried.slice(0, 20), stop: out.stop, asks: out.brief?.asks.length ?? 0, unclear: out.brief?.unclear.length ?? 0 },
    }).catch(() => undefined);
  }
  return out;
}

async function peekCap(env: Env, now: number): Promise<{ ok: boolean; used: number; cap: number }> {
  const row = await env.DB.prepare(`SELECT used FROM free_search_quota_days WHERE service = ? AND day = ?`).bind(FIRST_READ_SERVICE, centralDay(now)).first<{ used: number }>().catch(() => null);
  const used = Number(row?.used ?? 0);
  return { ok: used < FIRST_READ_DAILY_CAP, used, cap: FIRST_READ_DAILY_CAP };
}

/** The brief as the employee reads it on the job: the lists, then what to do with them. Pure. */
export function briefForTask(b: Brief, reader: string | null): string {
  const list = (label: string, xs: readonly string[]) => (xs.length ? [`${label}:`, ...xs.map((x, i) => `  ${i + 1}. "${x}"`)] : []);
  return [
    `FIRST READ (a free model's list, every line her own words${reader ? `; read by ${reader}` : ""}). The routing was decided by rule, not by this.`,
    ...list("Her asks", b.asks),
    ...list("Holds: must not happen yet", b.holds),
    ...list("Her questions: answer each one in the result", b.questions),
    ...(b.unclear.length ? ["Unclear (already asked in her Got it, numbered; build everything else meanwhile and never guess these):", ...b.unclear.map((u, i) => `  ${i + 1}. "${u.words}" — missing: ${u.missing}`)] : []),
    ...(b.files.length ? ["Her files:", ...b.files.map((f) => `  ${f.filename}: ${f.purpose}`)] : []),
    "If you find anything else unclear: ask every unclear item, numbered, in one email; never merge, drop or guess.",
  ].join("\n");
}

/**
 * Her unclear items as numbered questions, in her Got it (the one reply in her thread: no new sender,
 * one email per email of hers). Every item is asked; none merged or dropped. More than
 * MAX_PLAIN_QUESTIONS and she is told plainly it reads several ways, with the best reading of each
 * for her to correct — every item still listed. Pure.
 */
export function unclearLines(unclear: Brief["unclear"]): string[] {
  if (!unclear.length) return [];
  if (unclear.length > MAX_PLAIN_QUESTIONS) {
    return [
      `Your email reads several ways in ${unclear.length} places. Here is my best reading of each; reply with the number of any I have wrong and what you meant. Everything else is already being built.`,
      ...unclear.map((u, i) => `  ${i + 1}. "${u.words}": I read it as ${u.best ?? `the plain meaning (missing: ${u.missing})`}.`),
    ];
  }
  return [
    `${unclear.length === 1 ? "One thing I need from you" : `${unclear.length} things I need from you`} (reply by number; everything else is already being built):`,
    ...unclear.map((u, i) => `  ${i + 1}. You wrote "${u.words}": ${/[?.]$/.test(u.missing) ? u.missing : `${u.missing}?`}`),
  ];
}

export { centralDay };
