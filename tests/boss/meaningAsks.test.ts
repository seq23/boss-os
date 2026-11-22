/**
 * DOES SHE ASK FOR IT? (eng sweep row 7b, 22 Nov 2026; #514 review). The words find the list, the duty or the hour;
 * ONE first read per email answers a numbered check for each. How it breaks, each proven here: a model that says
 * "not" never removes a list row or edits a duty (data loss) and never lifts a not-before hold; unsure changes nothing
 * and asks her; model down runs the keywords AND logs it (outage), and the keywords never read "Don't change …" or
 * "Should I change …?" as a change; a pure forward never edits a duty. Synthetic names only: the repo is public.
 */
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { all, apiJson, row } from "./helpers";
import { setFirstReadRungs, type Rung } from "../../src/worker/boss/intake/firstRead";
import { listEditsFromMail, applyListEdit } from "../../src/worker/boss/capital/grid";
import { activeRoster, emailReading } from "../../src/worker/boss/intake/inboundMail";
import { editDutyFromMail } from "../../src/worker/boss/duties/editByMail";
import { admitTask } from "../../src/worker/boss/tasks/admit";

/** The first read's answer: every numbered check gets `meaning` (quoting `quote` when it asks), plus brief fields. */
const reads = (checks: Array<{ meaning: string; quote?: string }>, extra: Record<string, unknown> = {}, calls?: { n: number }): Rung[] => [{
  id: "free-test",
  call: async () => {
    if (calls) calls.n += 1;
    return JSON.stringify({ asks: [], holds: [], questions: [], unclear: [], files: [], decision: null, checks: checks.map((c, i) => ({ n: i + 1, meaning: c.meaning, quote: c.quote ?? "" })), ...extra });
  },
}];
const says = (meaning: string, quote = "", n = 1) => reads(Array.from({ length: n }, () => ({ meaning, quote })));
const down: Rung[] = [{ id: "free-test", call: async () => { throw new Error("503 from the provider"); } }];
const fellBack = async () => (await all<any>(`SELECT detail FROM system_events WHERE event = 'meaning_keyword_fallback'`)).length;
const rainmaker = async () => (await apiJson("/api/capital/lists")).body.data.same_firm.map((e: any) => e.value);

const WRITTEN = "duty_test_frames_7b";
const PERSON = "Pat Sample";
beforeEach(async () => {
  await env.DB.exec("DELETE FROM capital_party_lists; DELETE FROM system_events; DELETE FROM duty_versions; DELETE FROM audit_log;");
  await env.DB.exec(`DELETE FROM standing_duties WHERE id = '${WRITTEN}'`);
  const cols = (await all<{ name: string }>(`PRAGMA table_info(standing_duties)`)).map((c) => c.name);
  const pick = cols.map((c) => (c === "id" ? "?1" : c === "name" ? "?2" : c === "task_input" ? "?3" : c === "executor" ? "'agent'" : c === "owner_prompt" || c === "removed_at" ? "NULL" : c));
  await env.DB.prepare(`INSERT INTO standing_duties (${cols.join(",")}) SELECT ${pick.join(",")} FROM standing_duties WHERE id = 'duty_brokerage_sourcing'`)
    .bind(WRITTEN, "Gallery Frames Recount", JSON.stringify({ prompt: "Count the frames in the studio." })).run();
  await applyListEdit(env, { list: "same_firm", action: "add", kind: "name", value: PERSON.toLowerCase(), label: PERSON } as any, "seed");
});
afterEach(() => setFirstReadRungs(null));

describe("her list edits", () => {
  const TAKE_OFF = `Take ${PERSON} off the Rainmaker list`;
  const edited = async () => (await all<any>(`SELECT id FROM audit_log WHERE action = 'party_list_edited'`)).length;

  it("data loss: the model reads \"not\" and the row stays; no audit row says it changed", async () => {
    setFirstReadRungs(says("not"));
    expect(await listEditsFromMail(env, TAKE_OFF, "m1", Date.now())).toBeNull();
    expect(await rainmaker()).toEqual([PERSON.toLowerCase()]);
    expect(await edited()).toBe(0);
  });

  it("unsure: nothing is removed, she is asked, and no audit row is written", async () => {
    setFirstReadRungs(says("unsure"));
    const out = await listEditsFromMail(env, TAKE_OFF, "m1", Date.now());
    expect(await rainmaker()).toEqual([PERSON.toLowerCase()]);
    expect(out?.edits).toHaveLength(0);
    expect(out?.note).toMatch(/could not tell whether you want this, so nothing changed: take .* off the Rainmaker list/i);
    expect(await edited()).toBe(0);
  });

  it("the model reads \"asks\" with her words: the edit is made", async () => {
    setFirstReadRungs(says("asks", TAKE_OFF));
    const out = await listEditsFromMail(env, TAKE_OFF, "m1", Date.now());
    expect(out?.edits).toHaveLength(1);
    expect(await rainmaker()).toEqual([]);
    expect(await edited()).toBe(1);
  });

  it("outage: model down, the keywords act AND that is logged once", async () => {
    setFirstReadRungs(down);
    await listEditsFromMail(env, TAKE_OFF, "m1", Date.now());
    expect(await rainmaker()).toEqual([]);
    expect(await fellBack()).toBe(1);
  });
});

describe("her duty edits", () => {
  const BODY = "Change to Camille's gallery frames recount duty: from now on count the attic too. Your call.";
  const prompt = async () => (await row<{ owner_prompt: string | null }>(`SELECT owner_prompt FROM standing_duties WHERE id = '${WRITTEN}'`))!.owner_prompt;
  const edit = async (text = BODY) => editDutyFromMail(env, { roster: (await activeRoster(env)) as any, subject: "", text, mailId: "m1", now: Date.now(), sender: "owner" });

  it("unsure: the duty is untouched and she is asked", async () => {
    setFirstReadRungs(says("unsure"));
    const res = await edit();
    expect(res?.outcome).toBe("DUTY_NOT_UNDERSTOOD");
    expect(await prompt()).toBeNull();
    expect(res?.note).toMatch(/could not tell whether you want the duty "Gallery Frames Recount" changed/);
  });

  it("the model reads \"not\": no edit", async () => {
    setFirstReadRungs(says("not"));
    expect(await edit()).toBeNull();
    expect(await prompt()).toBeNull();
  });

  it("outage: model down, a standing change edits AND that is logged", async () => {
    setFirstReadRungs(down);
    expect((await edit())?.outcome).toBe("DUTY_EDITED");
    expect(await prompt()).toContain("count the attic too");
    expect(await fellBack()).toBe(1);
  });

  it("outage: \"Don't change …\" is never an edit", async () => {
    setFirstReadRungs(down);
    expect((await edit("Don't change Camille's gallery frames recount duty: it is fine as it is."))?.outcome).not.toBe("DUTY_EDITED");
    expect(await prompt()).toBeNull();
  });

  it("outage: \"Should I change …?\" is never an edit", async () => {
    setFirstReadRungs(down);
    expect((await edit("Should I change Camille's gallery frames recount duty to count the attic too?"))?.outcome).not.toBe("DUTY_EDITED");
    expect(await prompt()).toBeNull();
  });
});

describe("one read per email (#514 review)", () => {
  const reading = async (own: string, readable = own) => emailReading(env, {
    subject: "", own, readable, files: [], roster: (await activeRoster(env)) as any, now: Date.parse("2026-11-23T15:00:00Z"), mailId: "m5", oversize: false,
  });

  it("a list edit, a duty edit and a deadline are all answered by ONE model call", async () => {
    const calls = { n: 0 };
    setFirstReadRungs(reads([{ meaning: "unsure" }, { meaning: "unsure" }, { meaning: "unsure" }], {}, calls));
    const r = await reading(`Take ${PERSON} off the Rainmaker list.\nChange to Camille's gallery frames recount duty: count the attic too.\nHave it done by Friday.`);
    expect(r.listsAt).not.toBeNull();
    expect(r.dutyAt).not.toBeNull();
    await r.listsAt!();
    await r.dutyAt!();
    await r.read();
    expect(calls.n).toBe(1);
  });

  it("a not-before hold is never read away: the model's \"not\" leaves it standing", async () => {
    setFirstReadRungs(says("not", "", 3));
    const r = await reading("Do this Monday, not before 9am.");
    expect(r.notBefore?.at).toBeTruthy();
    // The deadline the model said she did not set may go; the hold it implies does not.
    expect(r.due && Date.parse(r.due.due_at)).toBeGreaterThan(Date.parse(r.notBefore!.at));
  });

  it("a deadline the model says she did not set is dropped; unsure keeps it", async () => {
    setFirstReadRungs(says("not"));
    expect((await reading("Send me last Friday's report.")).due).toBeNull();
    setFirstReadRungs(says("unsure"));
    expect((await reading("Send me the report by Friday.")).due).not.toBeNull();
  });

  it("a pure forward: the duty door never sees the forwarded sender's words", async () => {
    setFirstReadRungs(down);
    const forwarded = "---------- Forwarded message ---------\nFrom: someone@example.test\n\nChange to Camille's gallery frames recount duty: count the attic too. Your call.";
    const r = await reading("", forwarded);
    expect(r.duty).toBeNull();
    expect(r.dutyAt).toBeNull();
  });
});

describe("who reads the work she asks for: kind, risk and audience only tighten", () => {
  const ASK = "Put together a one-page summary of the spring catalogue and get it in front of the gallery buyers.";
  let n = 0;
  const admit = (brief: Record<string, unknown> | null, extra: Record<string, unknown> = {}) => admitTask(env as never, {
    title: String(extra.title ?? "Spring catalogue summary") + ` ${++n}`,
    brief: brief ? { asks: [], holds: [], questions: [], unclear: [], files: [], decision: null, ...brief } as any : null,
    input: { prompt: ASK, source: "boss_inbound_mail", from: "owner@example.test", mail_id: `m7-${n}`, ...extra },
  } as any);

  it("the model's outside quote makes the work external; no quote keeps the keywords' reading", async () => {
    expect((await admit({ outside: "get it in front of the gallery buyers" })).classification.audience).toBe("external");
    expect((await admit({ outside: null })).classification.audience).toBe("internal");
    expect((await admit(null)).classification.audience).toBe("internal");
  });

  it("risk only rises: the model's high raises a low read, its low never lowers", async () => {
    const base = (await admit(null)).classification.risk;
    expect((await admit({ risk: "high" })).classification.risk).toBe("high");
    expect((await admit({ risk: "low" })).classification.risk).toBe(base);
  });

  it("the model's kind fills a one-off the keywords could not name", async () => {
    const PLAIN = { title: "The studio frames", prompt: "Handle the frames for the studio." };
    expect((await admit(null, PLAIN)).classification.intakeKind).toBe("one_off");
    expect((await admit({ kind: "recurring_duty" }, PLAIN)).classification.intakeKind).toBe("recurring_duty");
    // A kind the keywords named is never relabelled by the model.
    expect((await admit({ kind: "recurring_duty" })).classification.intakeKind).toBe((await admit(null)).classification.intakeKind);
  });
});

describe("her morning reply", () => {
  it("a whole-line command the first read missed still acts; logged as added, never as an outage", async () => {
    const { morningReplyFromMail } = await import("../../src/worker/boss/intake/morningReply");
    await morningReplyFromMail(env as never, { text: "Examplecorp is public", refs: [], mailId: "m9", read: { reply: null, answers: [], commands: [] } as any });
    const added = await all<any>(`SELECT detail FROM system_events WHERE event = 'meaning_keyword_added'`);
    expect(added).toHaveLength(1);
    expect(JSON.parse(added[0].detail).keyword).toBe("public");
    expect(await fellBack()).toBe(0);
  });
});
