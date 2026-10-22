/**
 * THE FUND-SIDE CHASSIS SENDERS, NAMED ONCE.
 *
 * Boss OS carries West Peek chassis code by copy (capital, buyer-hunt, people, LP). What these
 * scripts report on is fund-shaped work, so their rows are kept OFF the Boss OS email map
 * (tests/outboundEmailMap.test.ts reads this list for that exemption).
 *
 * THEY SEND THROUGH BOSS OS'S OWN TEAM. Until 22 Oct 2026 they fell back to the fund's Resend team
 * (RESEND_API_KEY, westpeek.ventures) whenever the Boss OS sender was refused, because `vault:run`
 * injected every key in the shared Mac vault. The owner's rule: Boss OS only ever gets its own
 * team's key. They now use `sendersFor`'s default — BOSS_OS_MAIL_KEY, then The Industry Guides
 * fallback — `vault:run` strips the fund's key before any Boss OS process starts
 * (scripts/lib/vault-env.mjs bossOsProcessEnv), and tests/bossKeySeparation.test.ts fails if any
 * file here reads a West Peek key or names a West Peek From again.
 */
export const FUND_SIDE_CHASSIS_SENDERS = [
  "scripts/ops/buyer-hunt.mjs",
  "scripts/ops/interest-match.mjs",
  "scripts/ops/ledger-hunt.mjs",
  "scripts/ops/lp-outcomes.mjs",
  "scripts/ops/lp-positive.mjs",
  "scripts/ops/people-worth-a-call.mjs",
];

/** This file. */
export const FUND_SIDE_CHASSIS_MODULE = "scripts/ops/fund-side-chassis.mjs";
