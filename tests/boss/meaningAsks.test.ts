/**
 * DOES SHE ASK FOR IT? (eng sweep row 7b, 22 Nov 2026). The words find the list, the duty or the hour; the model
 * reads whether her email asks for it. How it breaks, each proven here: a model that says "not" never removes a
 * list row or edits a duty (data loss); unsure changes nothing and asks her; model down runs the keywords AND logs
 * it (outage). Synthetic names only: the repo is public.
 */
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { all, apiJson, row } from "./helpers";
import { setFirstReadRungs, type Rung } from "../../src/worker/boss/intake/firstRead";
import { confirmAsk } from "../../src/worker/boss/intake/meaning";
import { listEditsFromMail, applyListEdit } from "../../src/worker/boss/capital/grid";
import { activeRoster, herTime } from "../../src/worker/boss/intake/inboundMail";
import { editDutyFromMail } from "../../src/worker/boss/duties/editByMail";

const says = (meaning: string, quote = ""): Rung[] => [{ id: "free-test", call: async () => JSON.stringify({ meaning, quote }) }];
const down: Rung[] = [{ id: "free-test", call: async () => { throw new Error("503 from the provider"); } }];
const fellBack = async () => (await all<any>(`SELECT detail FROM system_events WHERE event = 'meaning_keyword_fallback'`)).length;
const rainmaker = async () => (await apiJson("/api/capital/lists")).body.data.same_firm.map((e: any) => e.value);

const WRITTEN = "duty_test_frames_7b";
const PERSON = "Pat Sample";
beforeEach(async () => {
  await env.DB.exec("DELETE FROM capital_party_lists; DELETE FROM system_events; DELETE FROM duty_versions;");
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

  it("data loss: the model reads \"not\" and the row stays; the email goes on as ordinary mail", async () => {
    setFirstReadRungs(says("not", `Take ${PERSON}`));
    expect(await listEditsFromMail(env, TAKE_OFF, "m1", Date.now())).toBeNull();
    expect(await rainmaker()).toEqual([PERSON.toLowerCase()]);
  });

  it("unsure: nothing is removed and she is asked", async () => {
    setFirstReadRungs(says("unsure"));
    const out = await listEditsFromMail(env, TAKE_OFF, "m1", Date.now());
    expect(await rainmaker()).toEqual([PERSON.toLowerCase()]);
    expect(out?.edits).toHaveLength(0);
    expect(out?.note).toMatch(/could not tell whether you want this, so nothing changed: take .* off the Rainmaker list/i);
  });

  it("the model reads \"asks\" with her words: the edit is made", async () => {
    setFirstReadRungs(says("asks", TAKE_OFF));
    const out = await listEditsFromMail(env, TAKE_OFF, "m1", Date.now());
    expect(out?.edits).toHaveLength(1);
    expect(await rainmaker()).toEqual([]);
  });

  it("outage: model down, the keywords act AND that is logged", async () => {
    setFirstReadRungs(down);
    await listEditsFromMail(env, TAKE_OFF, "m1", Date.now());
    expect(await rainmaker()).toEqual([]);
    expect(await fellBack()).toBe(1);
  });
});

describe("her duty edits", () => {
  const BODY = "Change to Camille's gallery frames recount duty: from now on count the attic too. Your call.";
  const prompt = async () => (await row<{ owner_prompt: string | null }>(`SELECT owner_prompt FROM standing_duties WHERE id = '${WRITTEN}'`))!.owner_prompt;
  const edit = async () => editDutyFromMail(env, { roster: (await activeRoster(env)) as any, subject: "", text: BODY, mailId: "m1", now: Date.now(), sender: "owner" });

  it("unsure: the duty is untouched and she is asked", async () => {
    setFirstReadRungs(says("unsure"));
    const res = await edit();
    expect(res?.outcome).toBe("DUTY_NOT_UNDERSTOOD");
    expect(await prompt()).toBeNull();
    expect(res?.note).toMatch(/could not tell whether you want the duty "Gallery Frames Recount" changed/);
  });

  it("the model reads \"not\": no edit", async () => {
    setFirstReadRungs(says("not", "Change to Camille's gallery frames recount duty"));
    expect(await edit()).toBeNull();
    expect(await prompt()).toBeNull();
  });

  it("outage: model down, the keywords edit AND that is logged", async () => {
    setFirstReadRungs(down);
    expect((await edit())?.outcome).toBe("DUTY_EDITED");
    expect(await prompt()).toContain("count the attic too");
    expect(await fellBack()).toBe(1);
  });
});

describe("a time in her email", () => {
  const found = { at: "2026-11-27T23:00:00.000Z", words: "Friday" };
  it("kept only when she set it: \"not\" drops it, unsure keeps it, model down keeps it and logs", async () => {
    setFirstReadRungs(says("not", "last Friday"));
    expect(await herTime(env as never, found, "to have this work done by", "Send me last Friday's report.", "m1", Date.now())).toBeNull();
    setFirstReadRungs(says("unsure"));
    expect(await herTime(env as never, found, "to have this work done by", "Send me the report Friday.", "m1", Date.now())).toBe(found);
    setFirstReadRungs(down);
    expect(await herTime(env as never, found, "to have this work done by", "Send me the report Friday.", "m1", Date.now())).toBe(found);
    expect(await fellBack()).toBe(1);
    expect(await herTime(env as never, null, "x", "y", "m1", Date.now())).toBeNull();
  });

  it("confirmAsk: an \"asks\" quote she negated is never an act", async () => {
    setFirstReadRungs(says("asks", "change the duty"));
    expect(await confirmAsk(env as never, { what: "t", about: "An email.", change: "change the duty", text: "Don't change the duty." })).toBe("ask");
  });
});

describe("who reads the work she asks for", () => {
  const ASK = "Put together a one-page summary of the spring catalogue and get it in front of the gallery buyers.";
  let n = 0;
  const admit = async () => (await import("../../src/worker/boss/tasks/admit")).admitTask(env as never, {
    title: `Spring catalogue summary ${++n}`, input: { prompt: ASK, source: "boss_inbound_mail", from: "owner@example.test", mail_id: `m7-${n}` },
  });

  it("the model may only tighten: its \"asks\" makes the work external; \"not\" and model down keep the keywords' reading", async () => {
    setFirstReadRungs(says("asks", "get it in front of the gallery buyers"));
    expect((await admit()).classification.audience).toBe("external");
    setFirstReadRungs(says("not", "Put together a one-page summary"));
    expect((await admit()).classification.audience).toBe("internal");
    setFirstReadRungs(down);
    expect((await admit()).classification.audience).toBe("internal");
    expect(await fellBack()).toBe(1);
  });
});

describe("her morning reply", () => {
  it("a whole-line command the first read missed still acts, and is logged as the keywords'", async () => {
    const { morningReplyFromMail } = await import("../../src/worker/boss/intake/morningReply");
    await morningReplyFromMail(env as never, { text: "Examplecorp is public", refs: [], mailId: "m9", read: { reply: null, answers: [], commands: [] } as any });
    const fell = await all<any>(`SELECT detail FROM system_events WHERE event = 'meaning_keyword_fallback'`);
    expect(fell).toHaveLength(1);
    expect(JSON.parse(fell[0].detail).keyword).toBe("public");
  });
});
