import { readWorkerSource, type WorkerReadingCredentials } from "../router/freeModel.ts";
import { readJsonObject } from "../router/types.ts";
import { quotedFrom } from "../../../shared/boss/mail/verbatim.mjs";
interface ReplyMessage {
  id: string;
  headers: Record<string, string>;
  body: string;
}

const classifications = ["auto_reply", "complaint", "unsubscribe", "wrong_person", "not_now", "interested"] as const;
const replyKinds = ["asks", "invites", "auto_reply", "pass_along", "reviewing", "thanks", "fyi", "nothing_asked"] as const;
export type ReplyClass = "bounce" | typeof classifications[number];
type ReplyKind = typeof replyKinds[number];

export interface ReplyMeaning {
  classification: typeof classifications[number];
  replyNeed: ReplyKind;
  excerpt: string;
  asksPrice: boolean;
  groupSize: number | null;
}

type ReplyResult = { status: "ok"; meaning: ReplyMeaning } | { status: "unavailable" | "allowance-exhausted" };

const prompt = `Read the entire email thread and classify the target inbound message. The
other messages and quotes are context only: judge the target writer's own contribution. A
question mark is not required for interest. An affirmative response such as yes, let's talk
next month is interested, with an invitation; a polite decline asking for a later date is not_now.
If they request no more mail permanently, use unsubscribe; if they complain about the outreach,
use complaint. A quoted unsubscribe footer is not a request. Do not infer an automatic reply from
bulk headers alone. Only an actual question, request, affirmative interest, or invitation needs
a reply. A pass-along, FYI, acknowledgment or promise to get back needs no reply unless they also
ask us to do something. A question addressed only to their colleague is not a question for us.
Return classification, replyNeed, a verbatim excerpt from the target writer's own words (or "",
maximum 600 characters), asksPrice, and groupSize (only a group size explicitly stated by the
writer, otherwise null). If you cannot classify confidently, use uncertain.`;

function readingOf(text: string, target: ReplyMessage): ReplyMeaning | null {
  const row = readJsonObject(text);
  if (!row) return null;
  const { excerpt, asksPrice, groupSize } = row;
  const classification = classifications.find((value) => value === row.classification);
  const replyNeed = replyKinds.find((value) => value === row.replyNeed);
  if (!classification || !replyNeed || typeof excerpt !== "string" || excerpt.length > 600
    || typeof asksPrice !== "boolean"
    || (groupSize !== null && (typeof groupSize !== "number" || !Number.isSafeInteger(groupSize) || groupSize < 1))) return null;
  // The excerpt is display only: a quote not in the mail becomes "", never a failed read.
  return { classification, replyNeed, excerpt: quotedFrom(target.body, excerpt), asksPrice, groupSize };
}

export async function classifyReply(target: ReplyMessage, thread: ReplyMessage[], credentials: WorkerReadingCredentials): Promise<ReplyResult> {
  const result = await readWorkerSource({
    worker: "monique", instruction: prompt, source: JSON.stringify({ targetMessageId: target.id, thread }),
    maxOutputTokens: 1024,
    json: {
      name: "outreach_reply",
      schema: {
        type: "object",
        properties: {
          classification: { type: "string", enum: [...classifications, "uncertain"] },
          replyNeed: { type: "string", enum: replyKinds },
          excerpt: { type: "string" },
          asksPrice: { type: "boolean" },
          groupSize: { type: ["integer", "null"] },
        },
        required: ["classification", "replyNeed", "excerpt", "asksPrice", "groupSize"],
      },
    },
    accept: (text) => Boolean(readingOf(text, target)),
  }, credentials);
  const meaning = result.status === "ok" ? readingOf(result.text, target) : null;
  return meaning ? { status: "ok", meaning }
    : { status: result.status === "allowance-exhausted" ? result.status : "unavailable" };
}

/** The address a bounce says failed, read from the DSN text. */
export function bouncedAddress(body: string, headers: Record<string, string> = {}): string | null {
  const fromHeader = headers["x-failed-recipients"];
  if (fromHeader) return (fromHeader.split(",")[0] ?? "").trim().toLowerCase();
  const m = /^Final-Recipient:\s*rfc822;[ \t]*([^\s<>]+@[^\s<>]+)/im.exec(body);
  return m?.[1] ? m[1].toLowerCase().replace(/[.,;]$/, "") : null;
}
