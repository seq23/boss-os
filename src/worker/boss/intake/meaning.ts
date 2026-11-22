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
import { privateLexicon, scanForModelAccess } from "../router/modelAccess";
import { freeLadder, logReplyDecision, type Rung } from "./firstRead";

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

/** A model's answer, checked. Pure: the value, or why it is passed over. */
export function checkMeaning<T extends string>(raw: unknown, options: readonly T[], text: string): { value: T | typeof UNSURE; quote: string | null } | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "not one JSON answer";
  const m = (raw as Record<string, unknown>).meaning;
  const quote = typeof (raw as Record<string, unknown>).quote === "string" ? ((raw as Record<string, unknown>).quote as string).trim() : "";
  if (m === UNSURE) return { value: UNSURE, quote: null };
  if (typeof m !== "string" || !(options as readonly string[]).includes(m)) return "a meaning it was not offered";
  if (quote.length < 2 || !norm(text).includes(norm(quote))) return "its quote is not in the text";
  return { value: m as T, quote };
}

/** Read what a text means. Never throws: a ladder that cannot answer falls back to the keywords, logged. */
export async function readMeaning<T extends string>(env: Env, ask: MeaningAsk<T>, rungs?: Rung[]): Promise<Meaning<T>> {
  const options = Object.keys(ask.options) as T[];
  let walk: Awaited<ReturnType<typeof freeLadder<{ value: T | typeof UNSURE; quote: string | null }>>> | null = null;
  /*
   * PRIVATE TEXT NEVER REACHES A FREE ROUTE (private-data-routing). Every rung of this ladder may train
   * on what it reads, so text the router's own scan would hold to a private model is not sent at all:
   * the keywords read it, and the record says why. A lexicon that cannot be built counts as a hit.
   */
  const scan = await privateLexicon(env.DB).then((lex) => scanForModelAccess([{ role: "user", content: ask.text }], lex)).catch(() => ({ privateOnly: true, kinds: ["the private scan could not run"] }));
  if (scan.privateOnly) walk = { value: null, reader: null, tried: [], stop: `kept off the free models: ${scan.kinds.join(", ")}` };
  else if (ask.text.trim()) {
    walk = await freeLadder(env, {
      prompt: meaningPrompt(ask), json: meaningJson(options), budgetMs: MEANING_BUDGET_MS, now: ask.now,
      read: (t) => checkMeaning(readJsonObject(t), options, ask.text),
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
