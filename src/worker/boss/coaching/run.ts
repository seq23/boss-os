import type { Env } from "../env";
import { routeCompletion } from "../router/index";
import { FORWARDED_TURNS } from "./session";

/**
 * One coaching exchange, through the router every other model call goes through.
 *
 * NOT A SECOND PATH TO A MODEL. It would have been shorter to call a provider directly from the
 * route — and it would have put the one conversation carrying her interior life outside the cost
 * mode, the spend lever, the privacy screen, the risk ceiling and the decision log that govern
 * everything else. The router is the only door, and this is not the feature that gets a side one.
 *
 * NOTHING IS PERSISTED HERE. The router writes its own usage and decision rows, which record that a
 * call happened, to which model, and what it cost — never what was said. That is the correct split:
 * the ledger needs the shape of the call, and nobody needs the words.
 */

export interface CoachingResult {
  reply: string;
  degraded: boolean;
  model: string | null;
}

export async function runCoachingTurn(
  env: Env,
  backendId: string,
  system: string,
  recent: { role: string; text: string }[],
  text: string,
): Promise<CoachingResult> {
  /*
   * HER WORDS ARE FENCED, and the fence carries fresh randomness per turn so nothing written
   * earlier — by her, or by anything that ever reached her clipboard — can close it and start
   * issuing instructions. The same rule the Claude Code runner enforces, for the same reason, at a
   * moment when what she types is least guarded.
   */
  const fence = `HER_WORDS_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

  const history = recent
    .slice(-FORWARDED_TURNS * 2)
    .map((m) => `${m.role === "coach" ? "You said" : "She said"}: ${m.text}`)
    .join("\n");

  const result = await routeCompletion(env, {
    routeId: "rt_ops_default",
    lane: "ops",
    // Private, not restricted: restricted would refuse every cloud backend outright, and she has
    // consented to exactly one for exactly today. The classification is enforced at the route by
    // the airlock; this is the sensitivity the router screens on.
    sensitivity: "private",
    risk: "low",
    employeeId: "emp_chief",
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content:
          `${history ? `${history}\n\n` : ""}` +
          `<<<${fence}\n${text}\n${fence}>>>\n\n` +
          `Reply with ONE question, or — if she sounds ready — one short line telling her to begin. ` +
          `Never two questions. Never a paragraph.`,
      },
    ],
  });

  return {
    // A degraded route says so to the caller. She is entitled to know a cheaper model answered her,
    // because the answer will read differently and she should not have to wonder why.
    reply: result.text,
    degraded: Boolean((result as { degraded?: boolean }).degraded),
    model: (result as { modelName?: string }).modelName ?? null,
  };
}
