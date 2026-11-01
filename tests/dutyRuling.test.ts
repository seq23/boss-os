/**
 * A RULING OF HERS THAT REACHED THE WRONG DESK, RE-SENT WORD FOR WORD (owner incident, 1 Nov
 * 2026) — the pure half. "Change to Camille's Marketplace listings duty … your call" was triaged
 * to Camille as research, carrying her words with a "research: " prefix that sends a job to a
 * research page rather than the duty it named. Fails if the words a mis-routed ruling carries are
 * ever misread, or if a task holding none is treated as though it held something.
 */
import { describe, expect, it } from "vitest";
import { rulingWordsIn } from "../scripts/ops/duty-ruling.mjs";

const task = (input: Record<string, unknown> | null) => ({ input: input === null ? null : JSON.stringify(input) });

describe("rulingWordsIn: which words are the ruling", () => {
  it("strips the research: prefix Simone's triage adds", () => {
    expect(rulingWordsIn(task({ body: "research: Change to Camille's Marketplace listings duty. Your call." })))
      .toBe("Change to Camille's Marketplace listings duty. Your call.");
  });
  it("is case-insensitive on the prefix and tolerates extra whitespace", () => {
    expect(rulingWordsIn(task({ body: "Research:   use real job photos first." }))).toBe("use real job photos first.");
  });
  it("takes the words as they are when there is no research: prefix", () => {
    expect(rulingWordsIn(task({ body: "Before each refresh, use our real job photos first." })))
      .toBe("Before each refresh, use our real job photos first.");
  });
  it("falls back to input.prompt when there is no body", () => {
    expect(rulingWordsIn(task({ prompt: "research: from now on count the attic too." }))).toBe("from now on count the attic too.");
  });
});

describe("rulingWordsIn: a refusal when the task holds none", () => {
  it("is null for a task with no input at all", () => {
    expect(rulingWordsIn(task(null))).toBeNull();
    expect(rulingWordsIn(undefined)).toBeNull();
  });
  it("is null when body and prompt are both empty or absent", () => {
    expect(rulingWordsIn(task({}))).toBeNull();
    expect(rulingWordsIn(task({ body: "   " }))).toBeNull();
    expect(rulingWordsIn(task({ duty_id: "duty_test_listings" }))).toBeNull();
  });
  it("is null when the words are only the research: prefix itself", () => {
    expect(rulingWordsIn(task({ body: "research:   " }))).toBeNull();
  });
});
