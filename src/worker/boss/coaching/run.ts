import type { Env } from "../env";
import { routeCompletion } from "../router/index";
import { WIRING_BY_BACKEND } from "../router/backends";
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
  /** True only when something OTHER than the backend she approved answered her. */
  degraded: boolean;
  /** The router's own flag: the route's declared primary was not what ran. Kept for the ledger. */
  off_route: boolean;
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

  /*
   * THE CONSENT IS TURNED INTO A CONSTRAINT HERE, and until it was, it was not one.
   *
   * She approves ONE backend for the day, and the endpoint recorded that faithfully — but the call
   * below screens every model the ops route can reach, so a provider she never named could have
   * answered her. It did not, only because the other one had no key. That is the shape this
   * repository names: a guard that cannot reach the thing it governs.
   *
   * An unknown backend id confines the run to a provider that matches nothing, and the router
   * refuses by name. Falling back to "anything" on an id we do not recognise would turn a typo
   * into open routing at the exact moment she was being promised the opposite.
   */
  const wiring = WIRING_BY_BACKEND.get(backendId);
  const onlyProviderId = wiring ? wiring.providerId : `unknown:${backendId}`;

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
    /*
     * THE TASK KIND, WITHOUT WHICH NOTHING RUNS — and this is where the whole feature was broken.
     *
     * `checkBackend` refuses an unnamed kind by design: "an unmapped kind is an absent input, and
     * there is no default." This call named none, so every model was rejected at the availability
     * stage with "the request named no task kind", and a conversation that passed the airlock, the
     * consent gate and the confinement still could not reach a model. `coaching` maps to the
     * backend kind `document` in INTAKE_KIND_TO_BACKEND_KIND, which is in Workers AI's allowed list.
     *
     * The guard was right and the caller was wrong, which is why it failed closed rather than
     * quietly picking a kind on the caller's behalf.
     */
    intakeKind: "coaching",
    onlyProviderId,
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

  /*
   * "DEGRADED" MEANS SOMETHING ELSE ANSWERED, AND UNDER CONFINEMENT NOTHING ELSE CAN.
   *
   * The router flags a run as degraded whenever the route's declared primary was not what ran, and
   * on this route the declared models are both Fireworks — which has no key, so a coaching turn
   * ALWAYS arrives via the continuity tier. Reported raw, that put a "degraded" badge on every
   * morning conversation forever, for the normal, correct, deliberately chosen state of the system.
   * A warning that is always on is one she learns to ignore, and then it cannot warn her.
   *
   * So the honest question here is not "was this the route default?" but "did she get the backend
   * she approved?" If the model that answered belongs to the provider she consented to, that is
   * compliance, not degradation. Anything else genuinely is, and still says so.
   *
   * The router's own flag is preserved as `off_route` for anyone reading the ledger, because the
   * routing decision and this screen should not disagree about what happened.
   */
  const offRoute = Boolean((result as { degraded?: boolean }).degraded);
  const ranOnApproved = result.providerId === onlyProviderId;

  return {
    reply: result.text,
    degraded: offRoute && !ranOnApproved,
    off_route: offRoute,
    model: (result as { modelName?: string }).modelName ?? null,
  };
}
