/**
 * THE FUND-SIDE CHASSIS SENDERS, NAMED ONCE.
 *
 * Boss OS carries West Peek chassis code by copy (capital, buyer-hunt, people, LP). Those scripts do
 * the fund's work, so when the Boss OS sender is refused their mail falls back to the fund's own
 * Resend team (RESEND_API_KEY, westpeek.ventures) — that is West Peek mail on a West Peek account,
 * and it stays exactly as it was.
 *
 * Boss OS's own mail never does that (owner, 12 Oct 2026): its fallback is The Industry Guides team
 * (BOSS_OS_FALLBACK_MAIL_KEY, hello@theindustryguides.com), built in notify.mjs.
 *
 * Two tests read this list: tests/outboundEmailMap.test.ts (these files are not on the Boss OS map)
 * and tests/bossMailFallback.test.ts (only these files, and this one, may name a West Peek From).
 * A script added here is a claim that its mail is the fund's, not Boss OS's.
 */
export const FUND_SIDE_CHASSIS_SENDERS = [
  "scripts/ops/buyer-hunt.mjs",
  "scripts/ops/interest-match.mjs",
  "scripts/ops/ledger-hunt.mjs",
  "scripts/ops/lp-outcomes.mjs",
  "scripts/ops/lp-positive.mjs",
  "scripts/ops/people-worth-a-call.mjs",
];

/** This file, which holds the fund's fallback sender below. */
export const FUND_SIDE_CHASSIS_MODULE = "scripts/ops/fund-side-chassis.mjs";

/**
 * The fund-side fallback: pass as `sendersFor(who, { fallback: westPeekFallback })` from a script on
 * FUND_SIDE_CHASSIS_SENDERS only. Unchanged from the sender notify.mjs used to hold for everyone.
 */
export function westPeekFallback({ label, local, tag }) {
  return { from: `${label} <${local}@westpeek.ventures>`, key: process.env.RESEND_API_KEY, reply_to: `${local}@sequoiataylor.com`, tag };
}
