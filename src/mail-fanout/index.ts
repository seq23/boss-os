/**
 * INDUSTRY GUIDES MAIL FAN-OUT (owner, 13 Oct 2026). A second, tiny Worker, deployed on its own
 * (workers/industry-guides-mail-fanout/wrangler.toml; no bindings, no secrets, no HTTP surface).
 *
 * Cloudflare Email Routing allows one destination per rule, and hello@theindustryguides.com must
 * reach TWO: the owner's inbox (always; never removed) and st@time-2-read.com, the mailbox Monique's
 * outreach engine reads, so a guide prospect's "stop" reply is suppressed exactly as it is for the
 * side businesses. The hello@ routing rule points at this Worker; it forwards every message to both.
 *
 * Each forward is attempted independently: one failing never blocks the other. Only when EVERY
 * forward fails does it reject, so the sender gets a bounce instead of silent loss.
 */

/** The owner's inbox first. Both are verified Email Routing destinations on the account. */
export const OWNER_INBOX = "cryptoclearr@gmail.com";
export const OUTREACH_MAILBOX = "st@time-2-read.com";
export const FANOUT_ADDRESS = "hello@theindustryguides.com";
export const DESTINATIONS = [OWNER_INBOX, OUTREACH_MAILBOX] as const;

export interface Forwardable {
  to: string;
  forward(rcptTo: string, headers?: Headers): Promise<unknown>;
  setReject(reason: string): void;
}

export interface FanoutResult {
  delivered: string[];
  failed: Array<{ to: string; error: string }>;
}

/**
 * Forward to every destination for the fan-out address; anything else that reaches this Worker
 * (a mis-pointed rule) goes to the owner's inbox only.
 */
export async function fanout(message: Forwardable): Promise<FanoutResult> {
  const targets = message.to.trim().toLowerCase() === FANOUT_ADDRESS ? [...DESTINATIONS] : [OWNER_INBOX];
  const settled = await Promise.allSettled(targets.map((t) => message.forward(t)));
  const out: FanoutResult = { delivered: [], failed: [] };
  settled.forEach((s, i) => {
    const to = targets[i]!;
    if (s.status === "fulfilled") out.delivered.push(to);
    else out.failed.push({ to, error: String((s.reason as Error)?.message ?? s.reason) });
  });
  if (out.failed.length) console.error(JSON.stringify({ event: "fanout_partial_failure", ...out }));
  if (!out.delivered.length) message.setReject("Temporary delivery failure; please try again later.");
  return out;
}

export default {
  async email(message: ForwardableEmailMessage): Promise<void> {
    await fanout(message);
  },
};
