/**
 * THE PROSPECT EMAIL: NAMES AS EXAMPLES, NO FAKE "Re:", TRY AGAIN, HER CHANGES, AND THE FOLLOW-UP'S
 * MAILBOX AND THREAD (owner, 25 Oct 2026). Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import { PROSPECT_VARIANTS, DEFAULT_PROSPECT_TEMPLATE, PROSPECT_TEMPLATE_RULES, renderProspect, prospectProblems, featuredNamesProblems, applyTemplateNotes, namesLine } from "../src/shared/boss/lp/plan.mjs";
// @ts-expect-error — plain ESM with no declaration file
import { sendShape } from "../scripts/ops/lp-prospects.mjs";

const NAMES = [{ name: "OpenAI" }, { name: "Anduril" }, { name: "Databricks" }];

describe("the standing rules for every prospect email", () => {
  it("every variant, first email and follow-up, passes every rule, names read as examples, and no subject fakes a reply", () => {
    expect(PROSPECT_VARIANTS.length).toBeGreaterThanOrEqual(3);
    for (const t of PROSPECT_VARIANTS) for (const touch of [1, 2]) for (const variant of [0, 1, 2]) {
      const r = renderProspect(t, { first: "Alex", names: NAMES, touch, variant });
      expect(prospectProblems(touch === 1 ? r : { subject: "", body: r.body }, NAMES), `${t.subject} ${touch} ${variant}`).toEqual([]);
      expect(r.subject).not.toMatch(/^\s*re\s*:/i);
      expect(`${r.subject}\n${r.body}`).not.toMatch(/anthropic/i);
    }
    expect(renderProspect(DEFAULT_PROSPECT_TEMPLATE, { first: "Alex", names: NAMES }).body).toContain("Some of the names crossing my desk right now include OpenAI, Anduril and Databricks, among others.");
    expect(renderProspect(DEFAULT_PROSPECT_TEMPLATE, { first: "Alex", names: NAMES }).subject).toBe("Late-stage secondaries: OpenAI, Anduril and others");
  });
  it("the check catches the old wording: a closed list of names, and a cold \"Re:\" subject", () => {
    const old = { subject: "Re: Up to $1B secondary inquiry: OpenAI, Anduril, Databricks", body: "Names coming across my desk at the moment are: OpenAI, Anduril, Databricks. Would love 15 minutes." };
    const p = featuredNamesProblems(old, NAMES);
    expect(p.some((x) => /Re:/.test(x))).toBe(true);
    expect(p.some((x) => /as if they were all of them/.test(x))).toBe(true);
    expect(p.some((x) => /subject lists every featured name/.test(x))).toBe(true);
    expect(featuredNamesProblems({ subject: "Late-stage secondaries", body: namesLine(NAMES) }, NAMES)).toEqual([]);
  });
  it("her two rules are on record in her words, each with an enforcer", () => {
    expect(PROSPECT_TEMPLATE_RULES.map((r) => r.key)).toEqual(["names_are_examples", "no_fake_reply_subject"]);
    expect(PROSPECT_TEMPLATE_RULES[0]!.said).toBe("I don't like that you make it seem like those are the only 3 companies I'm working on.");
  });
});

describe("her changes, applied plainly", () => {
  it("\"say 'X' not 'Y'\" and \"drop the … line\" are applied; anything else is kept as her note", () => {
    const r = applyTemplateNotes(DEFAULT_PROSPECT_TEMPLATE, "drop the floating line, say 'add or trim' not 'add or trim', and make it warmer");
    expect(r.applied).toContain("dropped the floating line");
    expect(r.template.follow_up).not.toContain("Just floating this back up.");
    expect(r.template.follow_up.split("\n\n")[0]).toBe("Hi {first},");
    expect(r.kept).toEqual(["make it warmer"]);
  });
  it("try again is a different structure, not a reworded copy", () => {
    const a = renderProspect(PROSPECT_VARIANTS[0]!, { first: "Alex", names: NAMES });
    const b = renderProspect(PROSPECT_VARIANTS[1]!, { first: "Alex", names: NAMES });
    expect(b.subject).not.toBe(a.subject);
    expect(b.body.split("\n\n")[1]!.slice(0, 30)).not.toBe(a.body.split("\n\n")[1]!.slice(0, 30));
  });
});

describe("the one follow-up replies in their thread, from the mailbox that sent the first email", () => {
  const s = { touch: 2, email: "pat@family.example", subject: "Late-stage secondaries: OpenAI, Anduril and others", body: "Hi Pat,", thread_id: "t123", in_reply_to: "<m1@mail.example>", from: "sequoia@westpeek.ventures" };
  it("uses the original mailbox and thread, as a reply", () => {
    const shape = sendShape(s);
    expect(shape).toEqual({ mailbox: "sequoia@westpeek.ventures", threadId: "t123", message: { to: "pat@family.example", subject: "Re: Late-stage secondaries: OpenAI, Anduril and others", body: "Hi Pat,", inReplyTo: "<m1@mail.example>", from: "sequoia@westpeek.ventures" } });
  });
  it("is held, never sent fresh, without its thread or its first mailbox", () => {
    expect(sendShape({ ...s, thread_id: null }).refused).toMatch(/no thread/);
    expect(sendShape({ ...s, from: null }).refused).toMatch(/which mailbox/);
    // A thread that lives in another mailbox is never answered from this one.
    expect(sendShape({ ...s, from: "staylor@another.example" }).refused).toMatch(/only be a reply from that mailbox/);
  });
});
