import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { apiJson, row } from "./helpers";
import {
  MANIFESTATION_SEQUENCE, HARD_DAY_FLOOR, SEQUENCE_MINUTES, GRATITUDE_THEMES,
  themeFor, fingerprint, similarity, SAME_SENTENCE, buildGratitudePrompt, NO_REPEAT_DAYS,
} from "../../src/worker/boss/spirit/practice";

/**
 * THE SPIRIT SCREEN SHOWED THE SKY AND NONE OF THE PRACTICE.
 *
 * Moon phase, illumination, a contribution counter, an almanac — all correct, all computed, and
 * none of it a thing to do at 6am. Her §8.1 makes Spirit an ACTIVE operating pillar that must be
 * rendered explicitly in the daily agenda, and three things her contract specifies exactly were
 * either missing or invisible: the gratitude sentence, the twenty-minute sequence, and a movement
 * contract that was being computed and written to the database where no screen read it.
 */

describe("§8.3 and §8.4 — the sequences, exactly as written", () => {
  it("is seven steps and twenty minutes", () => {
    expect(MANIFESTATION_SEQUENCE).toHaveLength(7);
    expect(SEQUENCE_MINUTES).toBe(20);
  });

  it("keeps the hard-day floor as a DIFFERENT list, not a shortened one", () => {
    /*
     * Her document lists §8.4 separately from §8.3, and the reason is the last item: a real-world
     * aligned action. §8.2 says manifestation "may not replace evidence, execution, recovery, or
     * real-world action" — and a floor built by truncating the twenty-minute sequence would drop
     * exactly that, on exactly the days it matters most.
     */
    expect(HARD_DAY_FLOOR.some((s) => /real-world/i.test(s.what))).toBe(true);
    expect(MANIFESTATION_SEQUENCE.some((s) => /real-world/i.test(s.what))).toBe(false);
  });
});

describe("§8.5 — the sentence she should not have to invent", () => {
  it("rotates all six of her themes", () => {
    const seen = new Set(Array.from({ length: 12 }, (_, i) =>
      themeFor(new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10))));
    expect(seen.size).toBe(GRATITUDE_THEMES.length);
  });

  it("CATCHES A REPHRASE, not just an exact repeat", () => {
    /*
     * The 90-day rule is about the sentence, not the string. Comparing raw text would let the same
     * gratitude through wearing a different preposition, which is the repetition the rule exists to
     * prevent.
     */
    const a = fingerprint("Grateful my body carried me through this week");
    const b = fingerprint("I am grateful that my body carried me through the week");
    expect(similarity(a, b)).toBeGreaterThanOrEqual(SAME_SENTENCE);

    const c = fingerprint("The raise closed because I kept showing up");
    expect(similarity(a, c)).toBeLessThan(SAME_SENTENCE);
  });

  it("does not call two sentences the same just because they share a common noun", () => {
    const a = fingerprint("Grateful for the quiet hour before the calls start");
    const b = fingerprint("Grateful the deal survived a hard quarter");
    expect(similarity(a, b)).toBeLessThan(SAME_SENTENCE);
  });

  it("carries her prohibitions verbatim, which are sharper than 'write something nice'", () => {
    const p = buildGratitudePrompt({ theme: "momentum and progress", anchor: "Close the raise", openLoops: 2, dayMode: null, avoid: [] });
    for (const banned of ["stiff", "generic", "corny", "filler"]) expect(p).toContain(banned);
    expect(p).toContain("out loud");
    expect(p).toContain("Close the raise");
  });

  it("SEES THE SHAPE OF THE DAY AND NONE OF THE SOVEREIGN MATERIAL", () => {
    // The same list the morning coaching is held to. A gratitude sentence would be more specific
    // with her manifestations and relationship notes in front of it, which is exactly why the line
    // is drawn here rather than argued about later.
    const p = buildGratitudePrompt({ theme: "resilience and survival", anchor: null, openLoops: 0, dayMode: "recovery", avoid: [] }).toLowerCase();
    for (const forbidden of ["manifestation", "dream", "prediction", "relationship note", "promoted memory"]) {
      expect(p).not.toContain(forbidden);
    }
  });

  it("tells the model what she has already had, so the rule can be obeyed", () => {
    const p = buildGratitudePrompt({
      theme: "body and health", anchor: null, openLoops: 0, dayMode: null,
      avoid: ["Grateful my body carried me through this week"],
    });
    expect(p).toContain("carried me through this week");
    expect(NO_REPEAT_DAYS).toBe(90);
  });
});

describe("the day payload — what the screen can actually render", () => {
  it("RETURNS THE BODY CONTRACT, which was computed and shown nowhere", async () => {
    /*
     * THE REGRESSION THIS PINS. `buildBodyContract` ran at the Morning Gate and its output went
     * into `days.morning_agenda`, which no screen read. Built, stored, invisible — the exact
     * "runs but inert" shape this repository names, and introduced by this session's own work.
     */
    const { body } = await apiJson("/api/spirit/day");
    expect(body.data.practice.body.launch_sequence[0]).toBe("10 in-bed leg raises per side");
    expect(body.data.practice.body.somatic.length).toBeGreaterThan(0);
    expect(body.data.practice.body.safety_stop).toContain("do not push through");
  });

  it("gives the twenty-minute sequence on a normal day", async () => {
    const { body } = await apiJson("/api/spirit/day");
    expect(body.data.practice.manifestation.minutes).toBe(20);
    expect(body.data.practice.manifestation.floor).toBe(false);
  });

  it("STOPS AT THE SOVEREIGNTY RULE, AND SAYS SO IN HER OWN TERMS", async () => {
    /*
     * THE CONFLICT THIS RECORDS. She asked for an LLM-written gratitude sentence daily, and she
     * classified `spirit` as a sovereign subsystem — LOCAL_ONLY storage AND local-only reasoning.
     * A sentence drawn from her life, written by Workers AI, is exactly what that forbids.
     *
     * Both are hers and they cannot both hold. The one thing an implementation must not do is pick
     * — least of all silently, in the direction that ships the feature. Adding `spirit` to the
     * validator's exception list would have taken about a minute and traded a sovereignty
     * guarantee for one sentence.
     *
     * So the refusal is the FEATURE here, and the message has to be usable: it names the rule, says
     * both routes forward, and makes clear nothing is broken.
     */
    const { body } = await apiJson("/api/spirit/day");
    const g = body.data.practice.gratitude;
    expect(g.sentence).toBe("");
    expect(g.unavailable).toContain("sovereign");
    expect(g.unavailable).toContain("local runtime");
    // §8.5 bans filler, so there is deliberately nothing generic standing in for it.
    expect(g.unavailable.toLowerCase()).toContain("filler");
    // And the theme still rotates, so the moment the rule changes nothing else has to.
    expect(g.theme).toBeTruthy();
  });

  it("KEEPS SPIRIT SOVEREIGN — the check that would catch this being loosened later", async () => {
    const p = await row<{ residency: string; ai_processing: string }>(
      `SELECT residency, ai_processing FROM data_policy WHERE entity = 'gratitude_sentences'`,
    );
    expect(p!.residency).toBe("LOCAL_ONLY");
    expect(p!.ai_processing).toBe("LOCAL_ONLY");

    // And nothing about her gratitude is written into the cloud domain while the question is open.
    const tables = await env.DB
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = 'gratitude_sentences'`)
      .all<{ name: string }>();
    expect(tables.results ?? []).toEqual([]);
  });

  it("says the sky is quiet rather than padding the list", async () => {
    const { body } = await apiJson("/api/spirit/day");
    // With no birth data in this runtime there is no chart, and that is stated by name.
    expect(body.data.sky.available).toBe(false);
    expect(body.data.sky.reason).toContain("birth data");
  });
});
