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

  it("COMPOSES THE SENTENCE HERE, WITH NO MODEL AND NO ROW", async () => {
    /*
     * THE CHOICE WAS FALSE AND IT TOOK THE OWNER ASKING TO SEE IT.
     *
     * This was a named stop: her instruction that an LLM writes the daily gratitude sentence
     * against her classification of `spirit` as sovereign, presented to her as a decision between
     * a good sentence and her own rule.
     *
     * It was not that. The airlock would only ever have shown a cloud model the SHAPE of her day —
     * anchor, a count of open loops, day mode — because everything that makes the sentence specific
     * is sovereign. The model version was going to be THINNER, not richer. Composed in the Worker
     * it can read all of it, because none of it leaves.
     *
     * So: no model, no table, no classification change, and a better sentence. Both axes are
     * honoured literally rather than by permission.
     */
    const { body } = await apiJson("/api/spirit/day");
    const g = body.data.practice.gratitude;
    expect(g.sentence.length).toBeGreaterThan(0);
    expect(g.unavailable).toBeNull();
    expect(g.source).toContain("never sent anywhere");
  });

  it("KEEPS SPIRIT SOVEREIGN, and now needs no exception to do it", async () => {
    const p = await row<{ residency: string; ai_processing: string }>(
      `SELECT residency, ai_processing FROM data_policy WHERE entity = 'gratitude_sentences'`,
    );
    expect(p!.residency).toBe("LOCAL_ONLY");
    expect(p!.ai_processing).toBe("LOCAL_ONLY");

    // Nothing is written down: LOCAL_ONLY residency honoured by there being no row to classify.
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

describe("the novelty engine advances by being looked at", () => {
  it("RECORDS TODAY'S ROTATION ON READ, so it rotates without a gate being run", async () => {
    /*
     * `logSomatic` was only called by the Morning Gate. On any day she read Spirit without running
     * it, the same five movements came up — each labelled "Not done before" — because nothing had
     * written down what was chosen. A novelty engine with no memory is the random number generator
     * it was built to stop being, and this is the path most likely to be taken.
     */
    await env.DB.prepare(`DELETE FROM movement_log`).run();
    await apiJson("/api/spirit/day");

    const logged = await row<{ n: number }>(`SELECT COUNT(*) AS n FROM movement_log`);
    expect(logged!.n).toBeGreaterThan(0);
  });

  it("does NOT rewrite history for a day being looked back at", async () => {
    // Reading last week would otherwise write a rotation into last week and reshuffle every day
    // after it, which is a novelty engine sabotaging itself through the history view.
    await env.DB.prepare(`DELETE FROM movement_log`).run();
    await apiJson("/api/spirit/day?date=2026-01-05");
    const logged = await row<{ n: number }>(`SELECT COUNT(*) AS n FROM movement_log`);
    expect(logged!.n).toBe(0);
  });
});
