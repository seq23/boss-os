import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { all, apiJson, uid } from "./helpers";
import { buildPrompt } from "../../src/worker/boss/queue/consumer";
import { loadFirmNotices, renderNotices } from "../../src/worker/boss/prompt/notices";

/**
 * FIRMWIDE NOTICES — and the only assertion that matters: they reach the words a model is given.
 *
 * `internal_memo` has existed in this database since 0014 with a create action, two routes and an
 * append-only trigger, and zero rows — because nothing ever read it into a prompt. A table with a
 * screen on it is decoration. So the tests below are not about the table; they are about
 * `buildPrompt`, the one function both employee run paths go through, and they call it for real.
 */

async function promptFor(input: Record<string, unknown>, task: Record<string, unknown> = {}) {
  return buildPrompt(
    env as any,
    { id: uid("tsk"), title: "A title nobody should be answering", template_id: null, ...task },
    input,
  );
}

describe("firmwide notices", () => {
  it("seeds twelve notices, each with a title, a body and an author", async () => {
    const notices = await all(`SELECT * FROM firm_notices ORDER BY created_at ASC, id ASC`);
    expect(notices.length).toBe(12);
    for (const n of notices) {
      expect(n.title.trim().length).toBeGreaterThan(10);
      // Long enough to be actionable prose rather than a slogan.
      expect(n.body.trim().length).toBeGreaterThan(120);
      expect(n.author.trim()).toBeTruthy();
      expect(Number.isFinite(n.created_at)).toBe(true);
    }
  });

  it("states the twelve things the firm already does", async () => {
    const text = (await all(`SELECT * FROM firm_notices`))
      .map((n: any) => `${n.title}\n${n.body}`).join("\n").toLowerCase();
    for (const phrase of [
      "scooter@westpeek.ventures",
      "west peek live",
      "a person sends",
      "training",
      "west peek productions",
      "plausible number",
      "claim",
      "employees propose",
      "reversibly",
      "non-engineer",
      "silence is not a blocker",
      "produced nothing",
    ]) {
      expect(text).toContain(phrase);
    }
  });

  it("does not carry the spend ladder, which code enforces and an employee cannot act on", async () => {
    const text = (await all(`SELECT * FROM firm_notices`)).map((n: any) => `${n.title} ${n.body}`).join(" ");
    expect(/spend ladder|spend gradient|cost ladder/i.test(text)).toBe(false);
  });

  // ─── THE POINT ──────────────────────────────────────────────────────────────

  it("puts every notice in front of a mail-driven employee prompt", async () => {
    const prompt = await promptFor({
      source: "boss_inbound_mail",
      subject: "#simone the LP letter",
      from: "seq.taylor@gmail.com",
      body: "Draft the letter to the LPs about the second close.",
    });

    const notices = await loadFirmNotices(env.DB);
    expect(notices.length).toBeGreaterThan(0);
    for (const notice of notices) {
      expect(prompt).toContain(notice.title);
    }
    // Her words survive alongside them — the notices ride in front, they do not replace.
    expect(prompt).toContain("Draft the letter to the LPs about the second close.");
    // And they sit OUTSIDE the fence, so nothing she pasted can be read as firm policy.
    const fence = (prompt.match(/HER_WORDS_[a-f0-9]{8,}/) ?? [])[0]!;
    expect(prompt.indexOf("FIRMWIDE NOTICES")).toBeLessThan(prompt.indexOf(fence));
  });

  it("puts them in front of an api-supplied prompt too", async () => {
    const prompt = await promptFor({ prompt: "Summarise the Thursday note in three sentences." });
    expect(prompt).toContain("The Managing Partners are Sequoia Taylor and Scooter Taylor");
    expect(prompt).toContain("Summarise the Thursday note in three sentences.");
  });

  it("puts them in front of a templated task, which is the path that returns early", async () => {
    const templateId = uid("tpl");
    await env.DB
      .prepare(
        `INSERT INTO task_templates (id, lane, name, intake_kind, inputs, output_contract,
                                     success_criteria, prompt, enabled, created_at)
         VALUES (?, 'ops', 'A template', 'drafting', '[]', 'A draft', 'It reads well', ?, 1, ?)`,
      )
      .bind(templateId, "Do the thing for {{client}}.", Date.now())
      .run();

    const prompt = await promptFor({ client: "West Peek" }, { template_id: templateId });
    expect(prompt).toContain("Do the thing for West Peek.");
    expect(prompt).toContain("FIRMWIDE NOTICES");
  });

  it("puts them in front of a bare-title task, which is the thinnest prompt this system builds", async () => {
    const prompt = await promptFor({}, { title: "Check the calendar" });
    expect(prompt).toContain("FIRMWIDE NOTICES");
    expect(prompt).toContain("Check the calendar");
  });

  it("a notice posted through the governance surface reaches the next run, with no deploy", async () => {
    const title = `No fund work is booked to Productions ${uid("n")}`;
    const posted = await apiJson("/api/governance/notices", {
      method: "POST",
      body: { title, body: "If a request blends the two, keep them apart and say that you did.", author: "Sequoia Taylor" },
    });
    expect(posted.status).toBe(201);

    const prompt = await promptFor({ prompt: "Anything at all." });
    expect(prompt).toContain(title);

    const listed = await apiJson("/api/governance/notices");
    expect(listed.status).toBe(200);
    expect(listed.body.data.notices.some((n: any) => n.title === title)).toBe(true);

    await env.DB.prepare(`DELETE FROM firm_notices WHERE title = ?`).bind(title).run();
  });

  it("refuses an anonymous or empty notice", async () => {
    for (const body of [
      { title: "", body: "x", author: "Sequoia Taylor" },
      { title: "A title", body: "", author: "Sequoia Taylor" },
      { title: "A title", body: "A body", author: "" },
    ]) {
      const res = await apiJson("/api/governance/notices", { method: "POST", body });
      expect(res.status).toBe(400);
    }
  });

  // ─── THE NEGATIVE PROOF ─────────────────────────────────────────────────────

  it("renders nothing at all when there are no notices, rather than an empty heading", () => {
    expect(renderNotices([])).toBe("");
  });

  it("would notice if the block stopped being prepended", async () => {
    // The shipped state, restored: an instruction with no notices in front of it. If this ever
    // passed the assertion above, the assertion is not testing anything.
    const asItWas = "Summarise the Thursday note in three sentences.";
    expect(asItWas).not.toContain("FIRMWIDE NOTICES");
    expect(await promptFor({ prompt: asItWas })).toContain("FIRMWIDE NOTICES");
  });
});
