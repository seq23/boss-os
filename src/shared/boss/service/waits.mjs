/**
 * EVERY WAIT A BOSS OS EMPLOYEE MAY PUT IN FRONT OF HER, IN ONE PLACE (6 Oct 2026).
 *
 * Copied from West Peek OS's `porterWaits.ts` and diverged (docs/SERVICE_RULES.md names how). The
 * owner, 6 Oct 2026: "if there is a block it needs to come with a plain english explanation of the
 * block and what the partner can do the unbloock it. and it should be able to be handled all over
 * email."
 *
 * A wait has THREE PARTS and this file is the only way to write one, so none can be left out:
 *
 *   waiting — what the employee is waiting on, in plain words;
 *   why     — why, in one sentence with no machinery in it;
 *   clear   — the exact REPLY or EMAIL that clears it. Never "open Boss OS", never "on the task",
 *             never "in Diagnostics": everything is handled over email.
 *
 * ONE KIND IS ALLOWED TO NAME BOSS OS, AND IT SAYS WHY: `TIER2_DECISION`. docs/AUTHORITY_MODEL.md
 * reserves a Tier 2 action (irreversible, external, moves money, binds her) to her own hand in the
 * Approval Inbox, and `validate:notice-not-approval` forbids an email from standing in for it.
 * That is a deliberate divergence from West Peek OS's "a reply is permission", recorded in the rules
 * doc, and `inBossOs: true` is the flag `validate:service-rules` checks for — on that kind and no other.
 */
import { SERVICE_INTAKE_ADDRESS } from "./practices.mjs";

const q = (s) => `"${s}"`;

/** The template per kind. A function, so the specifics ride in; the SHAPE is fixed here. */
export const BOSS_WAITS = {
  PLAN_APPROVAL: (f) => ({
    waiting: "your word on the plan",
    why: f.why?.trim() || "the plan carries a question only you can settle (brand, the meaning of copy, money, legal wording, image rights or a public claim)",
    clear: `reply ${q("approved")} to take every recommendation, or ${q("changes: <what to change>")}; one word is enough`,
  }),
  PREVIEW_APPROVAL: (f) => ({
    waiting: `your word on the preview${f.what ? ` at ${f.what}` : ""}`,
    why: "this change previews before it goes live, so nothing lands until you have seen it",
    clear: `reply ${q("approved")} to publish it, ${q("changes: <what to change>")} to adjust it, or ${q("stop")} to hold it`,
  }),
  HELD_BY_YOU: (f) => ({
    waiting: "your word to carry on",
    why: `you said ${q(String(f.what ?? "stop").slice(0, 200))}, so nothing moves until you say otherwise`,
    clear: `reply ${q("approved")} to carry on, ${q("changes: <what to change>")} to re-plan, or ${q("drop it")} to close it`,
  }),
  WHICH_ONE: (f) => ({
    waiting: "which one you mean",
    why: `more than one thing fits what you wrote${f.what ? ` (${String(f.what).slice(0, 200)})` : ""}, and guessing would act on the wrong one`,
    clear: "reply with the one you mean, in its own words, and it goes ahead",
  }),
  QUESTION_NOT_A_JOB: (f) => ({
    waiting: "what you would like done",
    why: `this reads like a question rather than something to do${f.why ? ` (${String(f.why).slice(0, 200)})` : ""}`,
    clear: "reply with what you would like done, or with the answer, and it starts from there",
  }),
  MISSING_SECRET: (f) => ({
    waiting: `the key ${f.what ?? "named above"}`,
    why: `the vault has no entry for it${f.searched ? ` (looked for: ${f.searched})` : ""}; everything that does not need it is going ahead meanwhile`,
    clear: `email ${q(`SECRET ${f.what ?? "<NAME>"}=<value>`)} to ${SERVICE_INTAKE_ADDRESS} on its own line — it is stored encrypted, moved into the vault, never shown again, and the work that waited resumes on arrival`,
  }),
  MAC_ASLEEP: (f) => ({
    waiting: "your Mac",
    why: `this work runs on your Mac and no machine picked it up — the lid is closed, it is asleep, or it is off power${f.why ? `; ${f.why}` : ""}`,
    clear: `nothing — it resumes by itself when the Mac is open and on power; if it stays stuck, reply ${q("try again")}`,
    selfClearing: true,
  }),
  SEAT_RESET: (f) => ({
    waiting: "the subscription plan to reset",
    why: "both Claude Code and Codex reported their plan is out of usage for now",
    clear: `nothing — it resumes by itself${f.at ? ` at ${f.at}` : " when the plan resets"}; no attempt is charged and nothing is lost`,
    selfClearing: true,
  }),
  DNS_RECORD: (f) => {
    const r = f.record;
    const txt = r?.txtName && r?.txtValue ? `, and TXT ${r.txtName} → ${r.txtValue}` : "";
    return {
      waiting: `a DNS record at your registrar for ${r?.host ?? "the host"}`,
      why: `${r ? r.host.split(".").slice(-2).join(".") : "the domain"} is not a zone Cloudflare can edit for you, so the record has to be added where the domain is registered${r?.liveAt ? `; until then the site is live at ${r.liveAt}` : ""}`,
      clear: `nothing to email — at your DNS provider add ${r?.type ?? "CNAME"} ${r?.name ?? "<name>"} → ${r?.target ?? "<target>"}${txt}; your Mac checks every few minutes for 7 days and emails you the moment it is live, or reply ${q("check now")} to make it look sooner`,
      selfClearing: true,
    };
  },
  DRIVE_EMPTY: (f) => ({
    waiting: `the files in the Drive folder you named${f.what ? ` (${f.what})` : ""}`,
    why: "the folder is still empty, or not yet shared with the Drive account your Mac reads; everything that does not need those files is going ahead",
    clear: "nothing to email — put the files in the folder and they are loaded on your Mac's next pass, no new email needed; if it is the wrong folder, reply with the right link",
    selfClearing: true,
  }),
  TRIED_AND_STOPPED: (f) => ({
    waiting: "a word from you",
    why: `I tried this ${f.what ?? "three times"} and could not finish: ${String(f.why ?? "the run stopped on our side").slice(0, 300)}`,
    clear: `reply ${q("try again")} to run it once more, ${q("changes: <what to change>")} to change the ask, or ${q("drop it")} to close it`,
  }),
  TIER2_DECISION: (f) => ({
    waiting: `your decision${f.what ? ` on ${f.what}` : ""}`,
    why: "it is a Tier 2 action — irreversible, external, moves money or binds you — and those are yours by hand, never delegated (docs/AUTHORITY_MODEL.md)",
    clear: `reply with your decision and it is written on the record; the action itself waits for your own approval in Boss OS's Approval Inbox, because an email is never allowed to stand in for a Tier 2 approval`,
    inBossOs: true,
  }),
};

export const BOSS_WAIT_KINDS = Object.keys(BOSS_WAITS);

/** The three parts, filled. */
export function bossWait(kind, fill = {}) {
  const make = BOSS_WAITS[kind];
  if (!make) throw new Error(`unknown wait kind: ${kind}`);
  return make(fill ?? {});
}

const ended = (s) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return /[.?!]$/.test(t) ? t : `${t}.`;
};

/**
 * THE ONE PARAGRAPH a block, a notice and an email all carry for a wait. "Waiting on … Why … To
 * clear it by email: …" — three labelled parts, always in this order, never one missing.
 */
export function waitDetail(kind, fill = {}) {
  return threeParts(bossWait(kind, fill));
}

/** Any `{waiting, why, clear}` as the paragraph. */
export function threeParts(w) {
  return `Waiting on: ${ended(w.waiting)} Why: ${ended(w.why)} To clear it by email: ${ended(w.clear)}`;
}

/** The three parts as three lines, for a labelled section in an email. */
export function waitBullets(kind, fill = {}) {
  const w = bossWait(kind, fill);
  return [`Waiting on: ${w.waiting}`, `Why: ${w.why}`, `To clear it by email: ${w.clear}`];
}

/** The three-part shape every wait reads in — the validator and the tests hold every rendered kind to it. */
export const WAIT_SHAPE = /^Waiting on: .+[.?!] Why: .+[.?!] To clear it by email: .+[.?!]/s;

/** The standing line for every email about work that still lacks a key: the name, where to get one, how to send it. */
export function missingSecretLine(name, vendorUrl, searched) {
  const w = bossWait("MISSING_SECRET", { what: name, searched: searched ?? null });
  return `Still missing: ${name}${vendorUrl ? ` — create one at ${vendorUrl}` : ""}, then ${w.clear}.`;
}

/**
 * What a wait text must NOT contain — the words that send her somewhere other than her inbox. Read
 * by the test and the validator against every rendered kind except the one flagged `inBossOs`.
 */
export const WAIT_TEXT_FORBIDDEN = [
  /\bon the (task|card)\b/i,
  /\bopen (the|your) (task|card)\b/i,
  /\bopen Boss OS\b/i,
  /\bin Diagnostics\b/i,
  /\b(on|in) (the )?(Capital desk|Team|Today|Inbox)\b/,
  /https?:\/\/boss\.sequoiataylor\.com\//i,
  /\brequeue the task\b/i,
];

// ─── R8 / R20: what her email reply does ─────────────────────────────────────

/** The task an email is about: `[tsk_…]` in a subject, or a bare `tsk_…` she typed. */
export function taskTokenIn(text) {
  const m = /\b(tsk_[a-z0-9]{6,40})\b/i.exec(String(text ?? ""));
  return m ? m[1].toLowerCase() : null;
}

/** The subject tag a notice carries so a reply to it names its task. */
export function taskToken(id) {
  return `[${String(id).trim()}]`;
}

/**
 * WHAT HER EMAIL REPLY DOES TO A STOPPED TASK, read from its first words. The notice offers
 * "try again" and "drop it"; a reply that leads with one of those takes it. A short positive reply
 * ("yes", "go ahead", "ok do it") is permission and runs it again too — R20, "a reply is
 * permission". Anything else is her ANSWER, and it runs again with her words added.
 */
export function blockReplyDoor(text) {
  const first = String(text ?? "").replace(/\r/g, "").split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith(">")) ?? "";
  const t = first.toLowerCase().replace(/^["'“#]+/, "").replace(/^#[a-z0-9]+\s*/, "");
  if (/^(drop (it|this)|cancel (it|this)|never ?mind|forget it)\b/.test(t)) return "DROP";
  if (/^(try (it )?again|retry|run it again|go again)\b/.test(t)) return "RETRY";
  if (/^(yes|yep|yeah|ok(ay)?|go( ahead)?|do it|approved?|sounds good|lgtm|please do)\b[\s.!,]*$/.test(t)) return "RETRY";
  return "ANSWER";
}
