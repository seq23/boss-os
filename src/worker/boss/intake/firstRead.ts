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
 *   · THE LADDER IS FREE, AND ONLY FREE: each free model in turn (the OpenRouter `:free` rows and
 *     Google's free Gemini rows in D1, `routeIsBilled` false), then Workers AI capped at
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
}

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
export type Rung = { id: string; call: (prompt: string, signal: AbortSignal) => Promise<string>; workersAi?: boolean };

const norm = (s: string): string => s.toLowerCase().replace(/[“”"'‘’`]/g, "").replace(/\s+/g, " ").trim().replace(/^[\s\-–—•*:.,;!?]+|[\s\-–—•*:.,;!?]+$/g, "");
const unquote = (s: string) => s.trim().replace(/^["“]|["”]$/g, "").trim();

/** The prompt. Pure. */
export function briefPrompt(input: { subject: string; words: string; files: readonly string[] }): string {
  return [
    "Sequoia, the owner, just emailed the work below to her assistant. Read it and list, line by line:",
    "ASK: <her EXACT words> — one line per separate thing she asks for, copied unchanged (a phrase or sentence of hers, no rewording).",
    "HOLD: <her EXACT words> — one line per real constraint: something that must NOT happen yet or must wait for her (only if she says so).",
    "QUESTION: <her EXACT words> — one line per question she asks that the result must answer.",
    "UNCLEAR: <her EXACT words> :: <the one question to ask her, written TO her as \"you\" (never \"she\"), ending in ?> :: <your best reading of what she means> — only when the work cannot be done right without asking her.",
    ...(input.files.length ? ["FILE: <file name> :: <what it is for, from her email, under 15 words>", `Files: ${input.files.join(", ")}`] : []),
    "A greeting, thanks or remark is not an ask. Never invent, merge or summarise. If she asks for nothing, answer exactly: NONE",
    "",
    `Subject: ${input.subject}`,
    "Email:",
    input.words.slice(0, 24_000),
  ].join("\n");
}

/** The brief, keeping only lines that quote her (and files that are really attached). Pure. */
export function parseBrief(text: string, words: string, files: readonly string[] = []): Brief | null {
  const body = norm(words);
  const lines = String(text ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").split(/\r?\n/).map((l) => l.trim().replace(/^[-*•\d.)\s]+(?=[A-Z]+\s*:)/, "")).filter(Boolean);
  const hers = (s: string) => s.length >= 3 && body.includes(norm(s));
  const pick = (label: string) => {
    const out: string[] = [];
    for (const l of lines) {
      const v = new RegExp(`^${label}\\s*:\\s*(.+)$`, "i").exec(l)?.[1];
      const w = v ? unquote(v) : "";
      if (w && hers(w) && !out.some((o) => norm(o) === norm(w))) out.push(w);
    }
    return out.slice(0, MAX_ITEMS);
  };
  const unclear: Brief["unclear"] = [];
  for (const l of lines) {
    const m = /^UNCLEAR\s*:\s*(.+?)\s*::\s*(.+?)(?:\s*::\s*(.+))?$/i.exec(l);
    if (!m) continue;
    const w = unquote(m[1]!);
    if (hers(w) && !unclear.some((u) => norm(u.words) === norm(w))) unclear.push({ words: w, missing: m[2]!.trim().slice(0, 200), best: m[3]?.trim().slice(0, 200) || null });
  }
  const filesOut: Brief["files"] = [];
  for (const l of lines) {
    const m = /^FILE\s*:\s*(.+?)\s*::\s*(.+)$/i.exec(l);
    const name = m ? files.find((f) => f.toLowerCase() === unquote(m[1]!).toLowerCase()) : undefined;
    if (m && name && !filesOut.some((f) => f.filename === name)) filesOut.push({ filename: name, purpose: m[2]!.trim().slice(0, 200) });
  }
  const brief = { asks: pick("ASK"), holds: pick("HOLD"), questions: pick("QUESTION"), unclear: unclear.slice(0, MAX_ITEMS), files: filesOut };
  const none = lines.some((l) => /^NONE\b/i.test(l));
  if (!brief.asks.length && !brief.holds.length && !brief.questions.length && !brief.unclear.length && !none) return null;
  return brief;
}

/** The free rungs, in order: D1's enabled free rows (never Claude, never OpenAI), then Workers AI. */
export async function freeRungs(env: Env): Promise<Rung[]> {
  const rows = (await env.DB.prepare(
    `SELECT id, slug, provider_id FROM models WHERE enabled = 1 AND provider_id IN ('prv_openrouter', 'prv_gemini') ORDER BY CASE capability_tier WHEN 'general' THEN 0 ELSE 1 END, id`,
  ).all<{ id: string; slug: string; provider_id: string }>().catch(() => ({ results: [] as Array<{ id: string; slug: string; provider_id: string }> }))).results ?? [];
  const rungs: Rung[] = [];
  for (const r of rows) {
    const wiring = WIRING_BY_PROVIDER.get(r.provider_id);
    if (!wiring || routeIsBilled(wiring.backendId, r.slug) || /^(?:anthropic|openai)\//i.test(r.slug)) continue;
    const cred = adapterCredential(env, wiring);
    if (!cred.available) continue;
    rungs.push({
      id: r.slug,
      call: async (prompt, signal) => (await wiring.adapter.complete(
        { modelSlug: r.slug, messages: [{ role: "user", content: prompt }], maxOutputTokens: 1200, temperature: 0, signal } as never,
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
      call: async (prompt, signal) => (await wa.adapter.complete(
        { modelSlug: WORKERS_AI_FIRST_READ_MODEL, messages: [{ role: "user", content: prompt }], maxOutputTokens: 1200, temperature: 0, signal } as never,
        { baseUrl: wa.baseUrl, ai: waCred.ai },
      )).text,
    });
  }
  return rungs;
}

const withDeadline = async <T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> => {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(ctl.signal),
      new Promise<T>((_, reject) => { timer = setTimeout(() => { ctl.abort(); reject(new Error(`no answer in ${Math.round(ms / 1000)} s`)); }, ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

let rungsOverride: Rung[] | null = null;
/** Tests swap in their own rungs (the invitations seam's shape); null restores the real ladder. */
export function setFirstReadRungs(r: Rung[] | null): void { rungsOverride = r; }

/**
 * Walk the free ladder once. `dry` reads without claiming a Workers AI slot (it peeks at the count,
 * so the dry run writes nothing). Never throws.
 */
export async function firstRead(
  env: Env,
  input: { subject: string; words: string; files?: readonly string[]; now?: number; dry?: boolean; mailId?: string | null },
  rungs?: Rung[],
): Promise<FirstRead> {
  const now = input.now ?? Date.now();
  const out: FirstRead = { brief: null, reader: null, tried: [], stop: null };
  if (!input.words.trim()) return out;
  const files = input.files ?? [];
  const prompt = briefPrompt({ subject: input.subject, words: input.words, files });
  const started = Date.now();
  let ladder: Rung[];
  try { ladder = rungs ?? rungsOverride ?? await freeRungs(env); } catch { ladder = []; }
  /*
   * TIME IS KEPT FOR WORKERS AI (15 Nov 2026 production dry run: four free rungs each ran to their
   * deadline and the Workers AI rung, the one that answers reliably, was "out of time"). A free rung
   * before it may only spend what leaves WORKERS_AI_RESERVE_MS for it.
   */
  const waAt = ladder.findIndex((r) => r.workersAi);
  for (const [at, rung] of ladder.entries()) {
    const left = FIRST_READ_BUDGET_MS - (Date.now() - started);
    const usable = waAt > at ? left - WORKERS_AI_RESERVE_MS : left;
    if (usable < 1500) {
      out.tried.push(`${rung.id}: out of time${waAt > at ? " (kept for Workers AI)" : ""}`);
      if (waAt > at) continue;
      break;
    }
    if (rung.workersAi) {
      const cap = input.dry ? await peekCap(env, now) : await claimFreeSearch(env.DB, FIRST_READ_SERVICE, now).catch(() => ({ ok: false, used: 0, cap: 0 }));
      if (!cap.ok) {
        out.stop = `NAMED STOP [${FIRST_READ_STOP}] Workers AI's free first reads for today are used (${cap.used} of ${cap.cap}); nothing is paid past them, so the rules read this email.`;
        out.tried.push(`${rung.id}: at the free cap`);
        continue;
      }
    }
    try {
      const text = await withDeadline(Math.min(FIRST_READ_ATTEMPT_MS, usable), (signal) => rung.call(prompt, signal));
      const brief = parseBrief(text, input.words, files);
      if (!brief) { out.tried.push(`${rung.id}: no line quoted her`); continue; }
      out.brief = brief;
      out.reader = rung.id;
      out.tried.push(`${rung.id}: read`);
      break;
    } catch (err) {
      out.tried.push(`${rung.id}: ${(err instanceof Error ? err.message : String(err)).slice(0, 120)}`);
    }
  }
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
