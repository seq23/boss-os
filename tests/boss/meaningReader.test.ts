/**
 * MEANING IS READ BY A MODEL; KEYWORDS ARE THE LOGGED FALLBACK (eng sweep row 7, 22 Nov 2026).
 * How it breaks, each proven here: a reply made to look like an approval is not one; unsure asks and
 * never acts; a model that invents words is passed over; model down runs the keywords AND says so;
 * private text never reaches a free route; a venue's model read can only hold a booking back.
 * Synthetic text only.
 */
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkMeaning, readMeaning } from "../../src/worker/boss/intake/meaning";
import { setFirstReadRungs, type Rung } from "../../src/worker/boss/intake/firstRead";
import { prospectTemplateFromMail, templateMeaningOf } from "../../src/worker/boss/lp/templateReply";
import { proposeTemplate } from "../../src/worker/boss/lp/desk";
import { readErrandMeaning } from "../../src/worker/boss/commands/run";

const says = (meaning: string, quote = ""): Rung[] => [{ id: "free-test", call: async () => JSON.stringify({ meaning, quote }) }];
const down: Rung[] = [{ id: "free-test", call: async () => { throw new Error("503 from the provider"); } }];
const NAMES = [{ name: "Alpha" }, { name: "Beta" }, { name: "Gamma" }];

const events = async (event: string) => (await env.DB.prepare(`SELECT detail FROM system_events WHERE event = ? ORDER BY ts`).bind(event).all<any>()).results ?? [];
const statusOf = async (id: string) => (await env.DB.prepare(`SELECT status FROM prospect_templates WHERE id = ?`).bind(id).first<any>())?.status;

beforeEach(async () => {
  await env.DB.exec("DELETE FROM prospect_templates; DELETE FROM system_events;");
});
afterEach(() => setFirstReadRungs(null));

describe("checkMeaning", () => {
  it("takes only an offered meaning whose quote is in the text; unsure needs no quote", () => {
    const opts = ["approve", "change"] as const;
    expect(checkMeaning({ meaning: "approve", quote: "Looks good" }, opts, "Looks good, send it.")).toEqual({ value: "approve", quote: "Looks good" });
    expect(checkMeaning({ meaning: "approve", quote: "approved" }, opts, "Looks fine, I guess.")).toBe("its quote is not in the text");
    expect(checkMeaning({ meaning: "delete", quote: "send" }, opts, "send")).toBe("a meaning it was not offered");
    expect(checkMeaning({ meaning: "unsure", quote: "" }, opts, "hmm")).toEqual({ value: "unsure", quote: null });
    expect(checkMeaning(null, opts, "x")).toBe("not one JSON answer");
  });
});

describe("her reply to the prospect email", () => {
  it("abuse: \"not approved, yes I read it\" is never an approval, even when the model says it is", async () => {
    const t = (await proposeTemplate(env.DB, null, NAMES)) as any;
    setFirstReadRungs(says("approve", "yes I read it"));
    const out = await prospectTemplateFromMail(env, `${t.template.id}: not approved, yes I read it`);
    expect(await statusOf(t.template.id)).toBe("pending");
    expect(out?.note).toMatch(/could not tell whether that approves/);
  });

  it("the model reads a plain approval the keywords miss", async () => {
    setFirstReadRungs(says("approve", "Looks great, send it"));
    expect(await templateMeaningOf(env, "Looks great, send it")).toBe("approve");
  });

  it("unsure asks and changes nothing: no approval, no redraft", async () => {
    const t = (await proposeTemplate(env.DB, null, NAMES)) as any;
    setFirstReadRungs(says("unsure"));
    const out = await prospectTemplateFromMail(env, `${t.template.id}: hmm, maybe`);
    expect(await statusOf(t.template.id)).toBe("pending");
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM prospect_templates`).first<any>()).n).toBe(1);
    expect(out?.note).toMatch(/nothing changed and nothing goes out/);
  });

  it("a model that quotes words she never wrote is passed over for the keywords, and that is logged", async () => {
    setFirstReadRungs(says("approve", "approved, send it"));
    expect(await templateMeaningOf(env, "make the opening shorter")).toBe("change");
    expect((await events("meaning_keyword_fallback")).length).toBe(1);
  });

  it("outage: model down runs the keywords AND logs it; only a bare \"approved\" approves", async () => {
    setFirstReadRungs(down);
    expect(await templateMeaningOf(env, "approved")).toBe("approve");
    expect(await templateMeaningOf(env, "not approved, yes I read it")).toBe("change");
    const fell = await events("meaning_keyword_fallback");
    expect(fell.length).toBe(2);
    const decided = (await events("first_read_decides")).map((e) => JSON.parse(e.detail).line);
    expect(decided.every((l: string) => l.startsWith("first read absent: keyword fallback"))).toBe(true);
  });

  it("private text never reaches a free route: the keywords read it, and the record says why", async () => {
    let called = 0;
    setFirstReadRungs([{ id: "free-test", call: async () => { called += 1; return JSON.stringify({ meaning: "approve", quote: "approved" }); } }]);
    const m = await readMeaning<"approve">(env, { what: "test", about: "A reply.", options: { approve: "yes" }, text: "approved, and the term sheet says pre-money is fine", keyword: "unsure" });
    expect(called).toBe(0);
    expect(m.by).toBe("keywords");
    expect(JSON.parse((await events("meaning_keyword_fallback"))[0].detail).stop).toMatch(/kept off the free models/);
  });
});

describe("a business's answer to her booking", () => {
  it("the model can hold back a confirmation the keywords read", async () => {
    setFirstReadRungs(says("asks", "Could we move you to 9?"));
    const r = await readErrandMeaning(env, "Your table is confirmed for 8:30pm. Could we move you to 9?", "venue@example.test", "Re: Thursday", null);
    expect(r.kind).toBe("decide");
  });

  it("the model's \"confirmed\" never reads away a fee the code found", async () => {
    setFirstReadRungs(says("confirmed", "Your table is confirmed for 8:30pm"));
    const r = await readErrandMeaning(env, "Your table is confirmed for 8:30pm. There is a $50 per person minimum.", "venue@example.test", "Re: Thursday", null);
    expect(r.kind).toBe("decide");
  });

  it("the model reads a confirmation in words the keywords miss", async () => {
    setFirstReadRungs(says("confirmed", "we've got you down"));
    const r = await readErrandMeaning(env, "Perfect, we've got you down for two at 8:30pm Thursday.", "venue@example.test", "Re: Thursday", null);
    expect(r.kind).toBe("confirmed");
  });

  it("unsure leaves it hers to decide; model down keeps the keywords' reading", async () => {
    setFirstReadRungs(says("unsure"));
    expect((await readErrandMeaning(env, "Your reservation is confirmed for 11:00 pm on Thursday, October 29.", "v@example.test", "", null)).kind).toBe("decide");
    setFirstReadRungs(down);
    expect((await readErrandMeaning(env, "Your reservation is confirmed for 11:00 pm on Thursday, October 29.", "v@example.test", "", null)).kind).toBe("confirmed");
  });
});
