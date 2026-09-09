import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * EVERY SECTION SAYS WHAT IT IS. SHE SHOULD NOT BE THE MECHANISM THAT FINDS THE ONES THAT DO NOT.
 *
 * ─── Three instances in one day, all the same shape ────────────────────────
 *
 *   · The gates: "AND ARE U FIXING THE FACT THAT I HAD TO ASK WHAT MORNING MID DAY AND EVENING
 *     GATES WERE? AND HOW THEY WORK?"
 *   · Coaching: "AND THIS IS THE COACHING SECTION? IT DOESNT LOOK LIKE A COACHING SECTION AT FIRST
 *     GLANCE." — it led with a privacy disclaimer and named a Cloudflare product on its button.
 *   · Spirit Signal, pasted verbatim from her screen:
 *
 *         medium
 *         07
 *         Spirit Signal
 *         08
 *
 * A bare intensity word, two list indices, and a category name. Nothing saying what it is, what it
 * means for her, or what happens if she ignores it.
 *
 * ─── So this is the sweep, expressed as a build failure ────────────────────
 *
 * The instruction was to stop fixing them one at a time as she finds them. A test is the only form
 * of "sweep" that stays done: it fails the moment a block is added without a sentence, rather than
 * waiting for her to open the screen and be confused by it.
 *
 * IT READS BOTH SIDES AS TEXT, AND LIVES IN THE NODE SUITE FOR THAT REASON. Rendering React inside
 * the workerd pool to assert a string would test the framework, and workerd has no filesystem at
 * all. What is actually being asserted is a property of the SOURCE — that every block the server
 * declares has a sentence written for it on the client, and that no internal constant is printed at
 * her. Two files that must agree, checked by reading both, which is also the only way to catch the
 * case where someone adds a block and forgets the other half.
 */

const TODAY = readFileSync(new URL("../src/client/boss/pages/Today.tsx", import.meta.url), "utf8");
const ROUTE = readFileSync(new URL("../src/worker/boss/routes/today.ts", import.meta.url), "utf8");

/** The blocks the server declares, read from `TODAY_BLOCKS` rather than restated here. */
const declared = (() => {
  const block = ROUTE.slice(ROUTE.indexOf("export const TODAY_BLOCKS"), ROUTE.indexOf("] as const;"));
  return [...block.matchAll(/\{\s*key:\s*"([a-z_]+)"/g)].map((m) => m[1]!);
})();
const summarise = TODAY.slice(TODAY.indexOf("function summarise(block: Block)"), TODAY.indexOf("function bold("));

describe("every block on Today", () => {
  it("declares blocks the client knows about at all", () => {
    // Rule 0: a scan that read zero blocks would pass every assertion below while checking nothing.
    expect(declared.length).toBeGreaterThan(5);
  });

  it("has a sentence written for it, so none renders as a bare label", () => {
    /*
     * THE DEFECT THIS CATCHES, EXACTLY. `spirit_signal` had no case, `summarise` returned "", and
     * the card rendered a category name between two list indices. Any block added later would have
     * inherited the same silence without anyone noticing until she opened it.
     */
    const missing = declared.filter((key) => !summarise.includes(`case "${key}"`));
    expect(missing, `these blocks render with no sentence: ${missing.join(", ")}`).toEqual([]);
  });

  it("never falls through to an empty string", () => {
    // A named absence is the floor. "" is what produced a section that said nothing at all.
    expect(summarise).not.toMatch(/default:\s*\n?\s*return "";/);
    expect(summarise).toMatch(/has no summary written for it yet/);
  });

  it("does not print the block index at her", () => {
    /*
     * "07" and "08" are positions in a list she never asked to have ordered — for the system's
     * benefit, not hers. `block.order` is still used to SORT; what changed is that it stopped being
     * rendered.
     */
    expect(TODAY).not.toMatch(/String\(block\.order\)\.padStart/);
  });

  it("keeps the Spirit Signal advisory rather than implying an instruction", () => {
    // The block has carried `advisory: true` since it was built and never showed it. Context for a
    // decision she makes is a different thing from a thing she is being told to do.
    expect(summarise).toMatch(/never an instruction/);
  });
});

describe("the screens she named", () => {
  const coaching = readFileSync(new URL("../src/client/boss/pages/Coaching.tsx", import.meta.url), "utf8");

  it("leads coaching with what it is, not with a privacy disclaimer", () => {
    /*
     * Reassurance is not an introduction: she cannot weigh a promise about her data before she knows
     * what the thing is. The heading and purpose must appear BEFORE the storage note in the source,
     * because in JSX source order is render order.
     */
    const heading = coaching.indexOf("coach-heading");
    const purpose = coaching.indexOf("coach-purpose");
    const storage = coaching.indexOf("state?.storage");
    expect(heading).toBeGreaterThan(-1);
    expect(purpose).toBeGreaterThan(heading);
    expect(storage).toBeGreaterThan(purpose);
  });

  it("names the action on the button rather than a vendor's product", () => {
    // "APPROVE WORKERS AI — FREE" named a Cloudflare inference service — an implementation detail —
    // and made the vendor half the label.
    expect(coaching).not.toMatch(/Approve \{b\.display_name\}/);
    expect(coaching).toMatch(/action_label/);
  });

  it("does not print an internal classification constant at her", () => {
    /*
     * `LOCAL_ONLY` is a residency enum from the airlock, and it was the first thing the coaching
     * screen said to her. It is still true, still enforced, and she is not its audience.
     *
     * COMMENTS ARE STRIPPED BEFORE CHECKING. A developer reading the file SHOULD see the constant
     * named — that is the note explaining why the design is what it is — and a test that banned the
     * word outright would delete the explanation along with the defect.
     */
    const rendered = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(rendered(TODAY)).not.toMatch(/LOCAL_ONLY/);
    expect(rendered(coaching)).not.toMatch(/LOCAL_ONLY/);
    // And the server must not send it either — the string reached the screen from `session.ts`.
    const consent = readFileSync(new URL("../src/worker/boss/coaching/session.ts", import.meta.url), "utf8");
    expect(rendered(consent)).not.toMatch(/LOCAL_ONLY/);
  });
});
