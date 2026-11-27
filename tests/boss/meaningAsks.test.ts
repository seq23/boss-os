/**
 * DOES SHE ASK FOR IT? (eng sweep row 7b, 22 Nov 2026; #514 review). The words find the list, the duty or the hour;
 * ONE first read per email answers a numbered check for each. How it breaks, each proven here: a model that says
 * "not" never removes a list row or edits a duty (data loss) and never lifts a not-before hold; unsure changes nothing
 * and asks her; model down runs the keywords AND logs it (outage), and the keywords never read "Don't change …" or
 * "Should I change …?" as a change; a forwarded sender's words (body or subject) never edit, list or set a deadline. Synthetic names only: the repo is public.
 */
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { all, apiJson, row } from "./helpers";
import { setFirstReadRungs, type Rung } from "../../src/worker/boss/intake/firstRead";
import { listEditsFromMail, applyListEdit } from "../../src/worker/boss/capital/grid";
import { activeRoster, emailReading, handleBossInboundMail, herSubjectOf } from "../../src/worker/boss/intake/inboundMail";
import { BOSS_INTAKE_MAILBOX } from "../../src/shared/boss/intake/mail.mjs";
import type { Env } from "../../src/worker/boss/env";
import { herWords, ownWords } from "../../src/shared/boss/intake/messageBody.mjs";
import { checksOf } from "../../src/worker/boss/intake/firstRead";
import { editDutyFromMail } from "../../src/worker/boss/duties/editByMail";
import { admitTask } from "../../src/worker/boss/tasks/admit";
import { cloudflareAuth } from "./cloudflareAuth";

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
  await env.DB.exec("DELETE FROM capital_party_lists; DELETE FROM system_events; DELETE FROM duty_versions; DELETE FROM audit_log; DELETE FROM judgement_calls;");
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

  it("no read was made (nothing to read, or too big to read): the keywords act and NO outage is logged", async () => {
    setFirstReadRungs(down);
    await listEditsFromMail(env, TAKE_OFF, "m1", Date.now(), { read: { brief: null, reader: null, tried: [], stop: null } as any, base: 0 });
    expect(await rainmaker()).toEqual([]);
    expect(await fellBack()).toBe(0);
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

  // No keyword fast path in front of the model (22 Nov 2026): a change in words the old change list never had is read.
  it("words no keyword knew (\"make … also count the attic\"): the model reads asks and the duty is edited", async () => {
    const PLAIN = "Make Camille's gallery frames recount duty count the attic too. Your call.";
    setFirstReadRungs(says("asks", "count the attic too"));
    expect((await edit(PLAIN))?.outcome).toBe("DUTY_EDITED");
    expect(await prompt()).toContain("count the attic too");
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

  it("outage: a model that answers with bad JSON is no read: the judged keywords edit AND that is logged", async () => {
    setFirstReadRungs([{ id: "free-test", call: async () => "Sure! Here is what she means: she wants a change." }]);
    expect((await edit())?.outcome).toBe("DUTY_EDITED");
    expect(await fellBack()).toBe(1);
  });

  it("outage: a model that never answers times out: the judged keywords decide AND that is logged", async () => {
    setFirstReadRungs([{ id: "free-test", call: (_p, signal) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted")))) }]);
    const res = await edit("Don't change Camille's gallery frames recount duty to count the attic too. Your call.");
    expect(res?.outcome ?? null, "the judge still refuses a negated change").not.toBe("DUTY_EDITED");
    expect(await prompt()).toBeNull();
    expect(await fellBack()).toBe(1);
  }, 45_000);

  // Sentences the duty words DO find (so the whole-sentence judge is what stops them), negated and asked.
  it("outage: \"Don't change …\" the duty words find is never an edit", async () => {
    setFirstReadRungs(down);
    const res = await edit("Don't change Camille's gallery frames recount duty to count the attic too. Your call.");
    expect(res?.outcome ?? null).not.toBe("DUTY_EDITED");
    expect(await prompt()).toBeNull();
  });

  it("outage: \"Should I change …?\" the duty words find is never an edit", async () => {
    setFirstReadRungs(down);
    const res = await edit("Should I change Camille's gallery frames recount duty to count the attic too? Your call.");
    expect(res?.outcome ?? null).not.toBe("DUTY_EDITED");
    expect(await prompt()).toBeNull();
  });
});

describe("one read per email (#514 review)", () => {
  const NOW = Date.parse("2026-11-23T15:00:00Z");
  const reading = async (readable: string, subject = "", own = ownWords(readable)) => emailReading(env, {
    subject, her: herWords(readable), own, readable, files: [], roster: (await activeRoster(env)) as any, now: NOW, mailId: "m5", oversize: false, isReply: false,
  });

  it("a list edit, a duty edit and a deadline are all answered by ONE model call, and only when a door asks", async () => {
    const calls = { n: 0 };
    setFirstReadRungs(reads([{ meaning: "unsure" }, { meaning: "unsure" }, { meaning: "unsure" }], {}, calls));
    const r = await reading(`Take ${PERSON} off the Rainmaker list.\nChange to Camille's gallery frames recount duty: count the attic too.\nHave it done by Friday.`);
    expect(r.listsAt).not.toBeNull();
    expect(r.dutyAt).not.toBeNull();
    expect(r.dueFound).not.toBeNull();
    // Building the reading, and a guard looking at what was read so far, never call the model.
    expect(await r.readSoFar()).toBeNull();
    expect(calls.n).toBe(0);
    await r.listsAt!();
    await r.dutyAt!();
    await r.dueAt();
    await r.read();
    expect(calls.n).toBe(1);
  });

  it("a not-before hold is never read away: the model's \"not\" on the deadline leaves the hold standing", async () => {
    setFirstReadRungs(says("not"));
    const r = await reading("Have the frames counted by Friday 3pm. Start not before 9am Wednesday.");
    expect(r.dueFound).not.toBeNull();
    expect(r.notBefore?.at).toBeTruthy();
    const due = await r.dueAt();
    // The deadline the model said she did not set is gone; the due the hold implies is set from the hold.
    expect(due).not.toBeNull();
    expect(due!.due_at).not.toBe(r.dueFound!.due_at);
    expect(Date.parse(due!.due_at)).toBeGreaterThan(Date.parse(r.notBefore!.at));
  });

  it("a deadline the model says she did not set is dropped; unsure keeps it", async () => {
    setFirstReadRungs(says("not"));
    expect(await (await reading("Send me the report by Friday.")).dueAt()).toBeNull();
    setFirstReadRungs(says("unsure"));
    expect(await (await reading("Send me the report by Friday.")).dueAt()).not.toBeNull();
  });

  // A real Gmail forward, through the same boundary the inbound door uses, with every model down.
  const FORWARD = "FYI\n\n---------- Forwarded message ---------\nFrom: Someone <someone@example.test>\nDate: Sat, Nov 21, 2026 at 9:12 AM\nSubject: frames\nTo: <studio@example.test>\n\n" +
    `Change to Camille's gallery frames recount duty: count the attic too. Your call.\nTake ${PERSON} off the Rainmaker list.\nHave it done by Friday.`;

  it("a forward: the forwarded sender's words never edit a duty or a list, and set no deadline (model down)", async () => {
    setFirstReadRungs(down);
    const r = await reading(FORWARD);
    expect(herWords(FORWARD)).toBe("FYI");
    expect(r.duty).toBeNull();
    expect(r.listsAt).toBeNull();
    expect(r.dueFound).toBeNull();
    const res = await editDutyFromMail(env, { roster: (await activeRoster(env)) as any, subject: "", text: herWords(FORWARD), mailId: "m5", now: NOW, sender: "owner" });
    expect(res?.outcome ?? null).not.toBe("DUTY_EDITED");
    expect(await rainmaker()).toEqual([PERSON.toLowerCase()]);
    expect((await row<{ owner_prompt: string | null }>(`SELECT owner_prompt FROM standing_duties WHERE id = '${WRITTEN}'`))!.owner_prompt).toBeNull();
  });

  /** One email from her through the real inbound door (handleBossInboundMail), the first read down. */
  const door = async (body: string, subject: string, id: string) => {
    setFirstReadRungs(down);
    const from = "owner-test@example.test";
    const runtime = { ...env, BOSS_EXTRA_OWNER_SENDERS: from } as Env;
    const raw = `From: ${from}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body.replace(/\n/g, "\r\n")}`;
    const headers = new Headers({ from, subject, "authentication-results": cloudflareAuth(from), "message-id": `<${id}@example.test>` });
    const result = await handleBossInboundMail({ from, to: BOSS_INTAKE_MAILBOX, headers, raw: new Response(raw).body!, rawSize: new TextEncoder().encode(raw).length } as never, runtime);
    expect(result).toMatchObject({ outcome: "SIMONE_QUEUED", reply: null, mailId: expect.any(String) });
    return result;
  };
  const prompt = async () => (await row<{ owner_prompt: string | null }>(`SELECT owner_prompt FROM standing_duties WHERE id = '${WRITTEN}'`))!.owner_prompt;
  /** The deadline the admitted task carries, or null; a door that admitted nothing has none either. */
  const dueOf = async (taskId: string | null) => (taskId ? JSON.parse((await row<{ input: string }>(`SELECT input FROM tasks WHERE id = '${taskId}'`))!.input).due ?? null : null);
  const OTHER = "Quinn Example";

  it("through the inbound door: her Gmail forward never takes a name off her list, edits a duty or sets a deadline (model down)", async () => {
    const result = await door(FORWARD, "Fwd: frames", "fwd-514");
    expect(await rainmaker()).toEqual([PERSON.toLowerCase()]);
    expect((await all<any>(`SELECT id FROM audit_log WHERE action = 'party_list_edited'`)).length).toBe(0);
    expect(await prompt()).toBeNull();
    expect(result.taskId, "the forward is ordinary work").toBeTruthy();
    expect(await dueOf(result.taskId), "\"Have it done by Friday\" was the forwarded sender's").toBeNull();
  });

  it("through the inbound door: a forwarded \"call me after 3pm\" never holds her task (model down; inboundMail :78)", async () => {
    const body = FORWARD.replace("Have it done by Friday.", "Call me after 3pm.");
    const result = await door(body, "Fwd: frames", "fwd-514-hold");
    expect(result.taskId, "the forward is ordinary work").toBeTruthy();
    // The hold rides on the admitted task's input (and the queue delay admitTask takes from it).
    const input = JSON.parse((await row<{ input: string }>(`SELECT input FROM tasks WHERE id = '${result.taskId}'`))!.input);
    expect(input.body).toBe("FYI");
    expect(input.context, "the original wording is available as context").toContain("after 3pm");
    expect(input.not_before ?? null, "\"after 3pm\" was the forwarded sender's").toBeNull();
  });

  it("the list door cuts at a forward itself: handed her whole email (inboundMail :701 passing `own`), only her line acts", async () => {
    await applyListEdit(env, { list: "same_firm", action: "add", kind: "name", value: OTHER.toLowerCase(), label: OTHER } as any, "seed");
    setFirstReadRungs(down);
    const body = `Take ${PERSON} off the Rainmaker list.\n\n` + FORWARD.replace(`Take ${PERSON} off`, `Take ${OTHER} off`);
    const out = await listEditsFromMail(env, ownWords(body), "m-own", NOW);
    expect(out?.edits.map((e) => e.value)).toEqual([PERSON.toLowerCase()]);
    expect(await rainmaker()).toEqual([OTHER.toLowerCase()]);
  });

  it("through the inbound door: her own question about a duty never becomes an edit because a forward under it says change (inboundMail :1070)", async () => {
    const body = "Should we change Camille's gallery frames recount duty: count the attic too?\n\n" + FORWARD.replace(`Take ${PERSON} off the Rainmaker list.\n`, "");
    const result = await door(body, "Fwd: frames", "fwd-514-duty");
    expect(result.outcome).not.toBe("DUTY_EDITED");
    expect(result.outcome).not.toBe("DUTY_EDIT_DRAFTED");
    expect(await prompt()).toBeNull();
    expect((await all<any>(`SELECT id FROM judgement_calls WHERE resume_kind = 'duty_edit'`)).length, "no duty change waits for her").toBe(0);
  });

  it("a forward keeps its body for the work (ownWords): only the doors that change her things cut at it", () => {
    expect(ownWords(FORWARD)).toContain("count the attic too");
  });

  it("a forwarded subject is not hers: no deadline or duty is read from it", async () => {
    setFirstReadRungs(down);
    const subject = "Fwd: Change Camille's gallery frames recount duty, have it done by Friday";
    const own = herSubjectOf(subject, "Change Camille's gallery frames recount duty, have it done by Friday");
    expect(own).toBe("");
    const r = await reading(FORWARD, own);
    expect(r.dueFound).toBeNull();
    expect(r.duty).toBeNull();
    // Her own subject on a forward still counts.
    expect(herSubjectOf("Have this done by Friday", "frames")).toBe("Have this done by Friday");
  });
});

describe("the quote check: an \"asks\" must stand in her sentence", () => {
  const LINE = `take ${PERSON} off the Rainmaker list`;
  it("a questioned or negated sentence is unsure, never an ask; a plain one stands", () => {
    expect(checksOf([{ n: 1, meaning: "asks", quote: LINE }], `Should I ${LINE}?`, 1)[1]!.meaning).toBe("unsure");
    expect(checksOf([{ n: 1, meaning: "asks", quote: LINE }], `Don't ${LINE}.`, 1)[1]!.meaning).toBe("unsure");
    expect(checksOf([{ n: 1, meaning: "asks", quote: LINE }], `Please ${LINE}.`, 1)[1]!.meaning).toBe("asks");
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

  it("risk only rises: the model's high raises a low read, its low never lowers a high one", async () => {
    expect((await admit(null)).classification.risk).toBe("low");
    expect((await admit({ risk: "high" })).classification.risk).toBe("high");
    const WEIGH = { title: "The gallery's offer", prompt: "Weigh the gallery's offer for the spring catalogue and tell me what you think." };
    expect((await admit(null, WEIGH)).classification.risk).toBe("high");
    expect((await admit({ risk: "low" }, WEIGH)).classification.risk).toBe("high");
  });

  it("the model's kind fills a one-off the keywords could not name", async () => {
    const PLAIN = { title: "The studio frames", prompt: "Handle the frames for the studio." };
    expect((await admit(null, PLAIN)).classification.intakeKind).toBe("one_off");
    expect((await admit({ kind: "recurring_duty" }, PLAIN)).classification.intakeKind).toBe("recurring_duty");
    // The read's kind decides over a kind the keywords guessed, when it loosens nothing (22 Nov 2026).
    const guessed = (await admit(null)).classification;
    const byRead = (await admit({ kind: "drafting" })).classification;
    expect(guessed.intakeKind).toBe("research");
    expect(byRead.intakeKind).toBe("drafting");
    // A kind that would run on its own where the keywords' only drafted keeps the draft: the label moves, the hands do not.
    expect((await admit({ kind: "recurring_duty" })).classification).toMatchObject({ intakeKind: "recurring_duty", executionAssignment: "AI_DRAFT" });
  });

  it("the read's kind never loosens: private work stays private, a declared kind is never relabelled", async () => {
    const KEPT = { title: "The studio portfolio", prompt: "Close the open positions in the studio portfolio." };
    expect((await admit(null, KEPT)).classification, "the keywords read it as trading").toMatchObject({ intakeKind: "trading", modelAccess: "public_model_approved", executionAssignment: "USER_ONLY" });
    expect((await admit({ kind: "drafting" }, KEPT)).classification, "a looser kind from the read moves the label, never the hands or the models")
      .toMatchObject({ intakeKind: "drafting", modelAccess: "public_model_approved", executionAssignment: "USER_ONLY", risk: "high" });
    const PRIVATE = { title: "The trading desk ask", prompt: "Look at the trading desk positions." };
    const tightened = (await admit({ kind: "coaching" })).classification;
    expect(tightened.modelAccess).toBe("public_model_approved");
    const declared = await admitTask(env as never, { title: PRIVATE.title, intake_kind: "trading", brief: { asks: [], holds: [], questions: [], unclear: [], files: [], decision: null, kind: "drafting" }, input: { prompt: PRIVATE.prompt, source: "boss_inbound_mail", from: "owner@example.test", mail_id: "m7-declared" } } as any);
    expect(declared.classification).toMatchObject({ intakeKind: "trading", modelAccess: "public_model_approved" });
  });
});

describe("her morning reply", () => {
  it("a whole-line command the first read missed is unknown: nothing done, asked once, logged as a disagreement", async () => {
    const { morningReplyFromMail } = await import("../../src/worker/boss/intake/morningReply");
    const r = await morningReplyFromMail(env as never, { text: "Examplecorp is public", refs: [], mailId: "m9", read: { reply: null, answers: [], commands: [] } as any, readHasWork: false });
    expect(r?.acted).toBe(0);
    expect(r?.note).toMatch(/not sure you meant "Examplecorp is public"/);
    const said = await all<any>(`SELECT detail FROM system_events WHERE event = 'meaning_disagrees'`);
    expect(said).toHaveLength(1);
    expect(JSON.parse(said[0].detail).keyword).toBe("public");
    expect(await fellBack()).toBe(0);
  });
  it("with no read at all, the judged keyword acts and is logged as the fallback", async () => {
    const { morningReplyFromMail } = await import("../../src/worker/boss/intake/morningReply");
    const r = await morningReplyFromMail(env as never, { text: "Examplecorp is public", refs: [], mailId: "m10", read: null });
    expect(r?.acted).toBe(1);
    const logged = await all<any>(`SELECT detail FROM system_events WHERE event = 'first_read_decides' AND entity_id = 'm10'`);
    expect(JSON.parse(logged[0].detail)).toMatchObject({ used: "KEYWORD", keyword: "public" });
  });
});
