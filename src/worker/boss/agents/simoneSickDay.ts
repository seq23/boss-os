/**
 * THE SICK-DAY SWITCH, READ BY A MODEL (her yes "both can send", 25 Nov 2026; #582 review finding 4,
 * 27 Nov 2026). spry.vc and sequoia@westpeek.ventures mail stays off for Simone until the owner's own
 * email asks her to cover one of them for a set time. Whether an email asks that, which inbox and until
 * when, is MEANING, so a model reads it from her own words; it replaced a `cover <mailbox> until <ISO>`
 * pattern she would never type.
 *
 * CODE KEEPS THE HARD STOPS (inboundMail.ts runs this only on direct, DKIM- and SPF-passing owner mail
 * that is not forwarded, on her own words with quotes and signature taken off):
 *   - the inbox is one of the fixed restricted addresses, never one the model or the mail names;
 *   - the end is in the future and at most seven days away; none named → 72 hours;
 *   - a model that does not answer, or answers in any other shape, switches nothing on (unsure → off);
 *   - an email that asks for more than the cover still goes on to Simone, so nothing she asked is dropped.
 * The acknowledgement says the end in her zone (ownerTime), never UTC.
 */
import type { Env } from "../env";
import { getSetting } from "../lib/settings";
import { ownerTime, ownerZone, OWNER_TZ_KEY } from "../../../shared/boss/ownerTime.mjs";
import { SICK_DAY_MAILBOXES } from "./simoneAccounts";

const DAY = 86_400_000;
export const SICK_DAY_DEFAULT_MS = 3 * DAY;
export const SICK_DAY_MAX_MS = 7 * DAY;

/** What the model reads: only her own direct words, and the clock in her zone. */
export type SickDayInput = { words: string; nowText: string; mailboxes: readonly string[] };
/** The model's answer: an ask to cover one listed inbox, with an optional end, or no ask. */
export type SickDayReading = { cover: boolean; mailbox?: string | null; until?: string | null; also?: boolean } | null;
type Reader = (env: Env, input: SickDayInput) => Promise<SickDayReading>;

const SYSTEM = [
  "You read one email the owner wrote to her chief of staff, Simone. Decide only whether the owner is asking Simone,",
  "now, to look after (read and handle) one of these inboxes for a while: {MAILBOXES}. A question about an inbox, a",
  "report, a past or hypothetical ask, or a request to switch access off is not an ask.",
  'Answer with JSON only: {"cover": true|false, "mailbox": one address from the list or null, "until": ISO 8601',
  'timestamp with offset or null, "also": true|false}. "until" is the end she gave, in her zone (for a day with no',
  'time, 23:59 that day); null when she gave no end. "also" is true when the email asks for anything besides the cover.',
].join(" ");

const routerReader: Reader = async (env, input) => {
  const { routeCompletion } = await import("../router");
  try {
    const r = await routeCompletion(env, {
      routeId: "rt_ops_default", lane: "ops", intakeKind: "drafting", risk: "low", employeeId: "emp_chief",
      freeOnly: true,
      messages: [
        { role: "system", content: SYSTEM.replace("{MAILBOXES}", input.mailboxes.join(", ")) },
        { role: "user", content: `Now: ${input.nowText}\n\nHer email:\n${input.words}` },
      ],
    } as any);
    const j = JSON.parse(/\{[\s\S]*\}/.exec(r.text)?.[0] ?? "null");
    return j && typeof j.cover === "boolean" ? j : null;
  } catch { return null; }
};
let readerImpl: Reader = routerReader;
/** Tests swap in a fake model; null restores the router. */
export function setSickDayReader(f: Reader | null): void { readerImpl = f ?? routerReader; }

export type SickDayAsk =
  | { kind: "none" }
  | { kind: "grant"; address: string; until: number; reply: string; alsoAsks: boolean }
  | { kind: "refuse"; address: string; reply: string; alsoAsks: boolean };

/** Her words only, from direct verified owner mail (the caller's check). Never throws. */
export async function readSickDayAsk(env: Env, words: string, now: number): Promise<SickDayAsk> {
  const text = words.trim();
  if (!text || text.length > 4_000) return { kind: "none" };
  const tz = ownerZone(await getSetting(env.DB, OWNER_TZ_KEY).catch(() => null));
  const reading = await readerImpl(env, { words: text, nowText: `${new Date(now).toISOString()} (${whenText(now, tz)})`,
    mailboxes: SICK_DAY_MAILBOXES }).catch(() => null);
  if (!reading?.cover) return { kind: "none" };
  const address = typeof reading.mailbox === "string" ? reading.mailbox.trim().toLowerCase() : "";
  if (!SICK_DAY_MAILBOXES.includes(address)) return { kind: "none" };
  // Anything else she asked goes on to Simone; only a model sure it is the whole email answers it here.
  const alsoAsks = reading.also !== false;
  const named = typeof reading.until === "string" && reading.until ? Date.parse(reading.until) : null;
  const until = named ?? now + SICK_DAY_DEFAULT_MS;
  if (!Number.isFinite(until) || until <= now || until > now + SICK_DAY_MAX_MS) {
    return { kind: "refuse", address, alsoAsks,
      reply: `I have not switched on ${address}. Tell me an end within seven days (by ${whenText(now + SICK_DAY_MAX_MS, tz)}) and I will.` };
  }
  return { kind: "grant", address, until, alsoAsks,
    reply: `Simone can read ${address} until ${whenText(until, tz)}. It switches off by itself then.` };
}

/** "Friday, December 4, 5:00 PM CT" in her zone, Central in brackets when different. */
export function whenText(at: number, tz: string) {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" }).format(new Date(at));
  return `${day}, ${ownerTime(at, { tz })}`;
}
