/**
 * MEANING IS READ BY A MODEL; KEYWORDS ARE THE LOGGED FALLBACK (eng sweep row 7, 22 Nov 2026).
 *
 * A door that must know what a reply MEANS (her answer to a prospect-email draft, a venue's answer to
 * her booking) asks here, with the meanings it can act on and what its keywords read. One schema, one
 * free ladder (`freeLadder` in firstRead.ts: Gemini's free rows, then Workers AI; never Claude, Codex
 * or a paid API), one record of both readings (`logReplyDecision`).
 *
 *   · UNSURE IS AN ANSWER. The model may say "unsure", and must when the words do not plainly say one
 *     meaning. Unsure never acts: the door asks her (or leaves it hers to decide).
 *   · A MEANING MUST QUOTE THE TEXT. Any answer but "unsure" carries the words that say it, and words
 *     that are not in the text pass the answer over, so a model cannot invent an approval.
 *   · MODEL DOWN: the keywords act, and the record says so ("first read absent: keyword fallback"),
 *     at warn level. Never silently.
 */
import type { Env } from "../env";
import { logEvent } from "../lib/log";
import { readJsonObject } from "../router/types";
import { freeLadder, logReplyDecision, type FirstRead, type Rung } from "./firstRead";
import { quoteStands } from "../../../shared/boss/text/wholeSentence.mjs";

export const UNSURE = "unsure" as const;
/** Short doors get a short ladder: the reply waits on it. */
export const MEANING_BUDGET_MS = 15_000;

export interface MeaningAsk<T extends string> {
  /** What is being read, in the log ("her reply to the prospect email"). */
  what: string;
  /** One line: what the text is and who wrote it. */
  about: string;
  /** Each meaning the door can act on, and what it means. */
  options: Readonly<Record<T, string>>;
  text: string;
  /**
   * The meanings that ACT (send, approve, book). Their quote must stand in her sentence (`quoteStands`, the
   * shared whole-sentence judge): a quote she negated, conditioned, reported or asked is read as unsure.
   */
  acts?: readonly T[];
  /** What the door's keywords read, used and logged when no model answers. */
  keyword: T | typeof UNSURE;
  mailId?: string | null;
  now?: number;
}

export interface Meaning<T extends string> {
  value: T | typeof UNSURE;
  by: "model" | "keywords";
  reader: string | null;
  quote: string | null;
}

const norm = (s: string): string => s.toLowerCase().replace(/[“”"'‘’`]/g, "").replace(/\s+/g, " ").trim();

export function meaningJson(options: readonly string[]) {
  return {
    name: "meaning",
    schema: {
      type: "object",
      properties: {
        meaning: { type: "string", enum: [...options, UNSURE] },
        quote: { type: "string", description: "The exact words of the text that say this meaning. Empty when unsure." },
      },
      required: ["meaning", "quote"],
    } as Record<string, unknown>,
  };
}

export function meaningPrompt<T extends string>(ask: Pick<MeaningAsk<T>, "about" | "options" | "text">): string {
  return [
    `${ask.about} Say what it means, as one of these:`,
    ...Object.entries<string>(ask.options).map(([k, v]) => `- ${k}: ${v}`),
    `- ${UNSURE}: the words do not plainly say one of the above.`,
    "Read the whole text. A negation, a condition or a question is not a yes (\"not approved\", \"approve it if…\", \"approved?\").",
    `Answer "${UNSURE}" when in doubt; never guess. "quote" is the exact words of the text that say the meaning.`,
    "",
    "The text:",
    ask.text.slice(0, 4000),
  ].join("\n");
}

/**
 * A model's answer, checked. Pure: the value, or why it is passed over. The quote must be in the text (a model
 * cannot invent words), and for a meaning that acts it must also stand in her sentence; one that does not is
 * unsure, so the door asks.
 */
export function checkMeaning<T extends string>(raw: unknown, options: readonly T[], text: string, acts: readonly T[] = []): { value: T | typeof UNSURE; quote: string | null } | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "not one JSON answer";
  const m = (raw as Record<string, unknown>).meaning;
  const quote = typeof (raw as Record<string, unknown>).quote === "string" ? ((raw as Record<string, unknown>).quote as string).trim() : "";
  if (m === UNSURE) return { value: UNSURE, quote: null };
  if (typeof m !== "string" || !(options as readonly string[]).includes(m)) return "a meaning it was not offered";
  if (quote.length < 2 || !norm(text).includes(norm(quote))) return "its quote is not in the text";
  if ((acts as readonly string[]).includes(m) && !quoteStands(text, quote)) return { value: UNSURE, quote };
  return { value: m as T, quote };
}

/** Read what a text means. Never throws: a ladder that cannot answer falls back to the keywords, logged. */
export async function readMeaning<T extends string>(env: Env, ask: MeaningAsk<T>, rungs?: Rung[]): Promise<Meaning<T>> {
  const options = Object.keys(ask.options) as T[];
  let walk: Awaited<ReturnType<typeof freeLadder<{ value: T | typeof UNSURE; quote: string | null }>>> | null = null;
  // Private text is held off every free rung inside `freeLadder` itself (its default scan); its stop is logged below.
  if (ask.text.trim()) {
    walk = await freeLadder(env, {
      prompt: meaningPrompt(ask), json: meaningJson(options), budgetMs: MEANING_BUDGET_MS, now: ask.now,
      read: (t) => checkMeaning(readJsonObject(t), options, ask.text, ask.acts ?? []),
    }, rungs).catch(() => null);
  }
  const got = walk?.value ?? null;
  const out: Meaning<T> = got
    ? { value: got.value, by: "model", reader: walk!.reader, quote: got.quote }
    : { value: ask.keyword, by: "keywords", reader: null, quote: null };
  const line = await logReplyDecision(env, { mailId: ask.mailId ?? "", what: ask.what, firstRead: got ? got.value : null, keyword: ask.keyword });
  if (!got) {
    await logEvent(env.DB, { level: "warn", scope: "intake", event: "meaning_keyword_fallback", lane: "ops", entityId: ask.mailId ?? undefined, detail: { what: ask.what, keyword: ask.keyword, tried: walk?.tried.slice(0, 10) ?? [], stop: walk?.stop ?? null, line } }).catch(() => undefined);
  }
  return out;
}

/*
 * DOES SHE ASK FOR THIS? (eng sweep row 7, part b: duty edits, list edits, deadline words). The code finds the
 * structure (which duty, which list and value, which hour) and hands it to the email's ONE first read as a numbered
 * check (`BriefInput.checks`); the model says whether her words ASK for it. "asks" acts and its quote must stand in her
 * sentence (`checksOf`); "not" never acts; unsure, or a check the read left out, never acts either: the door asks her.
 * No brief at all (every free rung down, or the read stopped): the door's keyword reading stands, and that real
 * outage is logged (`meaning_keyword_fallback`). An email with no words of hers is not an outage and logs nothing.
 */
export type Asked = "act" | "skip" | "ask";
/** A door's slice of the email's one read: the read, and where this door's checks start (1-based). */
export interface SharedRead { read: FirstRead; base: number }

export async function askedIn(
  env: Env, shared: SharedRead, i: number, input: { what: string; keyword: "asks" | "not"; mailId?: string | null },
): Promise<Asked> {
  const { read, base } = shared;
  if (read.brief) {
    const c = read.brief.checks?.[base + i];
    return c?.meaning === "asks" ? "act" : c?.meaning === "not" ? "skip" : "ask";
  }
  if (read.tried.length || read.stop) {
    await logEvent(env.DB, {
      level: "warn", scope: "intake", event: "meaning_keyword_fallback", lane: "ops", entityId: input.mailId ?? undefined,
      detail: { what: input.what, keyword: input.keyword, tried: read.tried.slice(0, 10), stop: read.stop },
    }).catch(() => undefined);
  }
  return input.keyword === "asks" ? "act" : "skip";
}
