/**
 * EVERY MEANING THE READER CAN GIVE HER WORDS, IN ONE PLACE (row olp_m81m3hahwqewtq9g, 22 Nov 2026). The first read's
 * schema enums (`worker/boss/intake/firstRead.ts` BRIEF_SCHEMA), the lines of its prompt, the doors that act on a read,
 * the reply forms printed in her emails and the tests all import these lists, so a meaning the model may return is a
 * meaning some door handles and a form her email offers is one the reader knows. Pure data.
 */

/** What her reply to an approval email decides (the read's `decision.reply`; "none" is added by the schema). */
export const REPLY_MODES = Object.freeze([
  { mode: "approved", means: "go ahead as proposed" },
  { mode: "preview", means: "build it but show her before it goes live" },
  { mode: "forced", means: 'only her exact words "approved to production"' },
  { mode: "held", means: "stop, wait, not yet" },
  { mode: "answers", means: "her own words decide, e.g. approved with a change" },
]);
export const READ_MODES = Object.freeze(REPLY_MODES.map((m) => m.mode));

/** A comment digest's per-number actions; `form` is the line her digest email prints (null: not printed). */
export const COMMENT_ACTION_TABLE = Object.freeze([
  { action: "approve", form: null },
  { action: "hide", form: "`1 delete` — hide it (YouTube keeps it under Held for review; reversible)" },
  { action: "reply_as_drafted", form: "`2 reply as drafted` — post Monique's drafted reply as the channel" },
  { action: "reply", form: "`3 reply: <your words>` — post your words instead" },
  { action: "ignore", form: "`4 ignore` — leave it, and never raise it again" },
]);
export const COMMENT_ACTIONS = Object.freeze(COMMENT_ACTION_TABLE.map((a) => a.action));

/** Her plain-word commands (the read's `decision.commands[].kind`), each with what the reader is told it means. */
export const COMMANDS = Object.freeze([
  { kind: "drop", means: "an item leaves her morning email for good; n = its number, else leave n out" },
  { kind: "gate", means: "her morning gate is done" },
  { kind: "grateful", means: "text = what she is grateful for" },
  { kind: "public", means: "text = the company she says is public" },
  { kind: "rule", means: 'a standing rule for the emails of the assistant, e.g. "never prep maybes"' },
  { kind: "nudge", means: "text = the one email address to nudge" },
  { kind: "dismiss", means: 'she dismisses a match by the five letters on its card, e.g. "dismiss k3m9q"; text = those words' },
  { kind: "comment", means: `n = the numbered comment, "action" one of ${COMMENT_ACTIONS.join("|")}, text = her exact words about it; "approve 1 and 3, skip 2" is three commands` },
  { kind: "your_call", means: "text = her words handing every comment to the proposed action" },
]);
export const COMMAND_KINDS = Object.freeze(COMMANDS.map((c) => c.kind));

/** What a numbered check the code found in her words means to the reader. */
export const CHECK_MEANINGS = Object.freeze(["asks", "not", "unsure"]);
