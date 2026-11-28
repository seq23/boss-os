/**
 * SIMONE PUTS EVERY REAL REPLY IN DECIDE (owner, 28 Nov 2026; rules in
 * src/shared/boss/mail/agentReplies.mjs). On every Simone tick (scripts/ops/simone.mjs) and as the
 * morning catch-up (`npm run agent-replies`), this reads every stored reply to Camille's office
 * outreach from the Porch & Party mailer's copies (GET /api/outreach/replies, read-only) and writes
 * the `agent_replies` morning section: one Decide card per real reply, with their words and a Reply
 * button. Sends nothing, changes no stored reply.
 *
 * Rule 0: a read that fails writes nothing (yesterday's copy stands until it goes stale, and then the
 * morning email names the section as not reported) and ends NAMED STOP [AGENT_REPLIES_UNREAD]; a read
 * with no replies writes an empty section, so absence always means the job did not run.
 */
import { dayOf } from "../../../src/shared/boss/schedule/clock.mjs";
import { writeMorningSection, morningDir } from "../../../src/shared/boss/mail/morning.mjs";
import { replyCards } from "../../../src/shared/boss/mail/agentReplies.mjs";

export const REPLY_LOOKBACK_DAYS = 30;

/** Read, build and write. `client.replies(since)` is the outreach API; `write` the section writer. */
export async function syncAgentReplies({ client, now = Date.now(), write = writeMorningSection, dir = process.env.BOSS_OS_MORNING_DIR ?? morningDir() }) {
  const since = dayOf(now, undefined, -REPLY_LOOKBACK_DAYS);
  let feed;
  try { feed = await client.replies(since); } catch (e) {
    throw new Error(`NAMED STOP [AGENT_REPLIES_UNREAD] The Porch & Party stored replies could not be read (${String(e?.message ?? e).slice(0, 160)}); nothing was written.`);
  }
  if (!feed || !Array.isArray(feed.replies)) throw new Error("NAMED STOP [AGENT_REPLIES_UNREAD] The Porch & Party replies answer had no list; nothing was written.");
  const decide = replyCards(feed.replies);
  write("agent_replies", { decide, lines: [] }, { dir, now });
  return { read: feed.replies.length, cards: decide.length, unread: feed.replies.filter((r) => r.unread).length };
}
