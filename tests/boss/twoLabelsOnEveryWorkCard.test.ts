import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { classify, classifyAudience, classifyModelAccess } from "../../src/worker/boss/intake/classify";
import {
  AMBIGUOUS_TERM_PATTERNS,
  DEAL_TERM_PATTERNS,
  FUND_INSTRUMENT_PATTERNS,
  privateLexicon,
  scanForModelAccess,
} from "../../src/worker/boss/router/modelAccess";
import { evaluateModel, type ModelRow, type PolicyContext } from "../../src/worker/boss/router/policy";
import { costPolicy } from "../../src/shared/boss/governance";
import { admitTask } from "../../src/worker/boss/tasks/admit";
import { row } from "./helpers";

/**
 * TWO LABELS ON EVERY WORK CARD, AND NEITHER IS READ OFF THE OTHER.
 *
 *   "WE NEED TO CLASSIFY ON EACH WORK CARD GOING FORWARD — CONFIDENTIAL VS NOT, AND INTERNAL VS
 *    EXTERNAL, SO THERE IS NO CONFUSION. MOST WORK IS INTERNAL AND NOT-CONFIDENTIAL SO CAN USE FREE
 *    TRAINING MODELS WITH REASONING AND CLOSE TO $0."
 *
 *   "I'D ALSO LIKE TO CHANGE THE TERMINOLOGY FROM CONFIDENTIAL / NOT — MAYBE JUST LABEL IT
 *    PUBLIC MODEL APPROVED / PRIVATE MODEL ONLY"
 *
 * `scripts/validate/two-axes-are-independent.mjs` proves independence by exhaustion over a matrix
 * and carries the negative proofs. This suite covers the parts a build-time guard cannot reach: the
 * database round trip, and the eligibility rule as `evaluateModel` actually applies it.
 */

const CLEAN_LEXICON = { names: [], established: true, note: "" };
const msg = (content: string) => [{ role: "user" as const, content }];

function model(over: Partial<ModelRow> = {}): ModelRow {
  return {
    id: "mdl_x", slug: "x", provider_id: "prv_x", display_name: "X",
    in_micros_1k: 0, out_micros_1k: 0, base_url: "", api_key_var: "",
    enabled: 1, privacy_class: "cloud", capability_tier: "general",
    benchmark_status: "benchmarked", approved_task_kinds: null, forbidden_task_kinds: null,
    max_risk: "high", data_use: "TRAINS_ON_PROMPTS", ...over,
  };
}

function ctx(over: Partial<PolicyContext> = {}): PolicyContext {
  return {
    policy: costPolicy("NORMAL"), risk: "low", sensitivity: "internal", intakeKind: "drafting",
    requireBenchmarkHighRisk: true, cloudForRestrictedAllowed: false,
    modelAccess: "public_model_approved", modelAccessReason: "", ...over,
  };
}

describe("1 · the axes are two, and the router only reads one of them", () => {
  /**
   * THE SIBLING'S BUG, ASKED DIRECTLY OF THE RULE THAT WOULD HAVE HAD TO CARRY IT.
   *
   * An internal recipient with nothing private in the content must leave a training-permitting
   * route eligible. If this ever goes red, "a partner is reading this" has started to mean "no
   * model may train on this" again.
   */
  it("leaves a training-permitting route eligible for internal, public-model-approved work", () => {
    const verdict = evaluateModel(
      model({ data_use: "TRAINS_ON_PROMPTS" }),
      ctx({ sensitivity: "internal", modelAccess: "public_model_approved" }),
    );
    expect(verdict.eligible).toBe(true);
  });

  it("refuses the same route the moment the work is private model only, and no approval lifts it", () => {
    const verdict = evaluateModel(
      model({ data_use: "TRAINS_ON_PROMPTS" }),
      ctx({ modelAccess: "private_model_only", modelAccessReason: "this content carries capital-call language" }),
    );
    expect(verdict.eligible).toBe(false);
    expect(verdict.stage).toBe("privacy");
    expect(verdict.approvable).toBe(false);
  });

  it("lets private-model-only work through on a route whose terms forbid training", () => {
    const verdict = evaluateModel(
      model({ data_use: "NO_TRAINING_CONTRACTUAL" }),
      ctx({ modelAccess: "private_model_only" }),
    );
    expect(verdict.eligible).toBe(true);
  });

  /** A column nobody selected must not be the reason something was allowed. */
  it("treats a missing data-use column as a route that may train", () => {
    const bare = model();
    delete (bare as { data_use?: string | null }).data_use;
    expect(evaluateModel(bare, ctx({ modelAccess: "private_model_only" })).eligible).toBe(false);
  });

  /**
   * THE AXIS THE ROUTER MAY NOT SEE.
   *
   * `PolicyContext` has no audience field, so this is asserted the only way a type can be: by
   * showing the verdict is identical for work whose only difference is who reads it.
   */
  it("gives the same verdict whoever the output is for", () => {
    const internal = classifyAudience({ text: "Write this up for Sequoia." }).audience;
    const external = classifyAudience({ text: "Send the invite to every guest and founder." }).audience;
    expect([internal, external]).toEqual(["internal", "external"]);
    const a = evaluateModel(model(), ctx());
    const b = evaluateModel(model(), ctx());
    expect(a).toEqual(b);
  });
});

describe("2 · the detector does not misfire on ordinary firm writing", () => {
  /**
   * THE FIXTURE THAT ACTUALLY BROKE IT, KEPT.
   *
   * Notice 8's first draft said "a commitment made". `\bcommitment\b` was sufficient on its own,
   * the notices ride in front of every prompt, and every employee run firm-wide scanned as LP
   * material. Under the two tiers, one ambiguous word with nothing corroborating it is not a
   * finding — and the seed is still held to the stricter union by
   * `scripts/validate/a-notice-reaches-the-employee.mjs`.
   */
  it("does not take the whole firm private over the word \"commitment\" in a notice", () => {
    const verdict = scanForModelAccess(
      msg("Nothing consequential — money moved, a commitment made — leaves this firm without a person deciding it."),
      CLEAN_LEXICON,
    );
    expect(verdict.access).toBe("public_model_approved");
  });

  it.each([
    ["a salary band in a hiring search", "Draft a hiring search for an ops associate. Compensation band $70k-$90k."],
    ["seat allocation in an event kit", "Build the event kit: run of show, room layout, and the allocation of seats."],
    ["page ownership in a site audit", "Audit the site and say who has ownership of each orphaned page."],
    ["a bounce rate in a community note", "Open rate was 41% and the rota is full for October."],
  ])("routes %s to a free lane", (_label, text) => {
    expect(scanForModelAccess(msg(text), CLEAN_LEXICON).access).toBe("public_model_approved");
  });

  it.each([
    ["a capital call", "The capital call goes out Friday and the drawdown follows."],
    ["a side letter", "Their side letter asks for MFN against the limited partnership agreement."],
    ["cap-table detail", "Pre-money is $12m, post-money $15m, fully diluted."],
    ["a data room", "Open the data room and file the diligence request list."],
    ["a figure next to commitment wording", "Her commitment is $5m, payable in two tranches."],
    ["a rate next to fund vocabulary", "Their carry is 20% over the hurdle."],
  ])("holds %s to a no-training route", (_label, text) => {
    expect(scanForModelAccess(msg(text), CLEAN_LEXICON).access).toBe("private_model_only");
  });

  /** One ambiguous signal is not a finding; two distinct ones are. That is the whole rule. */
  it("needs two distinct ambiguous signals, and does not count one signal twice", () => {
    expect(scanForModelAccess(msg("Budget lines: $40k, $90k and $250k."), CLEAN_LEXICON).access)
      .toBe("public_model_approved");
    expect(scanForModelAccess(msg("The allocation is $250k."), CLEAN_LEXICON).access)
      .toBe("private_model_only");
  });

  it("keeps every pattern the flat list had, split across the two tiers", () => {
    expect(DEAL_TERM_PATTERNS.length).toBe(FUND_INSTRUMENT_PATTERNS.length + AMBIGUOUS_TERM_PATTERNS.length);
    expect(FUND_INSTRUMENT_PATTERNS.length).toBeGreaterThan(0);
    expect(AMBIGUOUS_TERM_PATTERNS.length).toBeGreaterThan(0);
  });
});

describe("3 · a name this system holds is still caught, and never quoted back", () => {
  it("catches a name from the lexicon with no deal vocabulary anywhere near it", async () => {
    /*
     * THE NAME IS PUT THERE BY THIS TEST, because the shipped seed holds no LPs and a scan over an
     * empty lexicon would pass this assertion for a reason that has nothing to do with the rule.
     * `Northgate Partners` appears in no pattern on either tier — the only thing that can catch it
     * is the lexicon, which is exactly what is being proven.
     */
    await env.DB.prepare(`INSERT INTO organizations (id, lane, name, created_at, updated_at) VALUES ('org_test_lex', 'ops', 'Northgate Partners', 1, 1)`).run();
    const lexicon = await privateLexicon(env.DB);
    const name = "northgate partners";
    expect(lexicon.established).toBe(true);
    expect(lexicon.names).toContain(name);
    const verdict = scanForModelAccess(msg(`Please write a friendly note to Northgate Partners about the weather.`), lexicon);
    expect(verdict.access).toBe("private_model_only");
    expect(verdict.reason.toLowerCase()).not.toContain("northgate");
  });

  it("is still private model only when the lexicon could not be read at all", () => {
    const broken = { names: [], established: false, note: "the lexicon could not be read" };
    expect(scanForModelAccess(msg("anything at all"), broken).access).toBe("private_model_only");
  });

  it("believes a caller that declares private, and cannot be talked down by one that declares public", () => {
    expect(scanForModelAccess(msg("hello"), CLEAN_LEXICON, { modelAccess: "private_model_only" }).access)
      .toBe("private_model_only");
    expect(scanForModelAccess(msg("The capital call goes out Friday."), CLEAN_LEXICON, { modelAccess: "public_model_approved" }).access)
      .toBe("private_model_only");
  });

  it("raises a legacy restricted row and ignores every other value on that scale", () => {
    expect(scanForModelAccess(msg("hello"), CLEAN_LEXICON, { sensitivity: "restricted" }).access)
      .toBe("private_model_only");
    for (const s of ["public", "internal", "private", null, undefined]) {
      expect(scanForModelAccess(msg("hello"), CLEAN_LEXICON, { sensitivity: s }).access)
        .toBe("public_model_approved");
    }
  });
});

describe("4 · the labels reach the work card", () => {
  it("writes both axes onto the row, and defaults most work to the free lanes", async () => {
    const admitted = await admitTask(env as never, {
      title: "Build the event kit for the October founder dinner",
      lane: "ops",
      input: { prompt: "Run of show, room layout, name cards, and the allocation of seats." },
    });
    expect(admitted.created).toBe(true);
    const saved = await row<{ model_access: string; audience: string }>(
      `SELECT model_access, audience FROM tasks WHERE id = ?`, admitted.task_id!,
    );
    expect(saved!.model_access).toBe("public_model_approved");
    expect(saved!.audience).toBe("internal");
  });

  it("writes private model only for the fund's own side, without being told", async () => {
    const admitted = await admitTask(env as never, {
      title: "Draft the LP letter",
      lane: "ops",
      input: { prompt: "The capital call goes out Friday." },
    });
    const saved = await row<{ model_access: string; audience: string }>(
      `SELECT model_access, audience FROM tasks WHERE id = ?`, admitted.task_id!,
    );
    expect(saved!.model_access).toBe("private_model_only");
  });

  it("takes an explicit label from the caller over anything it would have inferred", () => {
    const forced = classify({
      title: "Build the event kit", prompt: "Run of show and seating.",
      model_access: "private_model_only", audience: "external",
    });
    expect(forced.modelAccess).toBe("private_model_only");
    expect(forced.audience).toBe("external");
  });

  /**
   * ALL FOUR CORNERS, ON REAL WORK THIS FIRM DOES. Two labels that can only produce two
   * combinations are one label wearing two names.
   */
  it("produces all four corners", () => {
    const corner = (text: string) =>
      `${classifyAudience({ text }).audience}+${classifyModelAccess({ text, intakeKind: "drafting" }).access}`;
    expect(corner("Write up the capital call position for Sequoia."))
      .toBe("internal+private_model_only");
    expect(corner("Draft the run of show for the October dinner."))
      .toBe("internal+public_model_approved");
    expect(corner("Send the event kit to every guest and founder attending."))
      .toBe("external+public_model_approved");
    expect(corner("Send the drawdown notice to the limited partner on the list."))
      .toBe("external+private_model_only");
  });
});
