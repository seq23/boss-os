/**
 * HER REPLY TO THE PROSPECT-EMAIL CARD GOES TO THE TEMPLATE (owner, 25 Oct 2026): "5: …" is read
 * against the morning she was sent; a change or "try again" redrafts and retires the old draft; "5:
 * approved" approves it and links everyone whose one follow-up it releases. Nothing reaches a
 * prospect until she approves. Synthetic data only.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { handleBossInboundMail } from "../../src/worker/boss/intake/inboundMail";
import { proposeTemplate, importProspects, prospectPlan } from "../../src/worker/boss/lp/desk";

const NAMES = [{ name: "Alpha" }, { name: "Beta" }, { name: "Gamma" }];
const WED_10AM = Date.parse("2026-10-28T15:00:00Z");

function mail(body: string) {
  const from = "Sequoia <seq.taylor@gmail.com>";
  const subject = "Re: Sunday: 5 decisions";
  const headers = new Headers({ from, subject, "authentication-results": "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass header.from=gmail.com", "message-id": `<${Math.random().toString(36).slice(2)}@mail.gmail.com>`, "in-reply-to": "<morning@boss>" });
  const raw = `From: ${from}\r\nSubject: ${subject}\r\n\r\n${body}`;
  return { from: "seq.taylor@gmail.com", to: "boss@sequoiataylor.com", headers, raw: new Response(raw).body!, rawSize: raw.length };
}

async function morningWith(keys: string[]) {
  const payload = { day: "2026-10-25", decide: keys.map((key, i) => ({ key, title: `Card ${i + 1}` })) };
  await env.DB.prepare(`INSERT OR REPLACE INTO morning_digests (day, payload, sent_at, created_at, updated_at) VALUES (?,?,?,?,?)`).bind("2026-10-25", JSON.stringify(payload), Date.now(), Date.now(), Date.now()).run();
}
const pendingRows = async () => (await env.DB.prepare(`SELECT * FROM prospect_templates WHERE status = 'pending'`).all<any>()).results ?? [];

beforeEach(async () => {
  await env.DB.exec("DELETE FROM prospect_templates; DELETE FROM prospects; DELETE FROM morning_digests;");
});

describe("a numbered reply to the prospect-email card", () => {
  it("\"5: <changes>\" keeps her words, redrafts at once, retires the old, and replies with the new email word for word and three links", async () => {
    const t = (await proposeTemplate(env.DB, null, NAMES)) as any;
    await morningWith(["lp:1", "lp:2", "approval:x", "rc:y", `prospect-template:${t.template.id}`]);
    const res = await handleBossInboundMail(mail("5: drop the floating line\n\nOn Sun, Simone wrote:\n> ..."), env as never);
    expect(res.outcome).toBe("TEMPLATE_ANSWERED");
    expect(res.taskId ?? null).toBeNull();
    const [now] = await pendingRows();
    expect(now.id).not.toBe(t.template.id);
    expect(now.parent_id).toBe(t.template.id);
    expect(JSON.parse(now.change_notes)).toEqual(["drop the floating line"]);
    expect(now.follow_up).not.toContain("Just floating this back up.");
    expect((await env.DB.prepare(`SELECT status FROM prospect_templates WHERE id = ?`).bind(t.template.id).first<any>()).status).toBe("retired");
    const reply = String((res as any).reply ?? "");
    expect(reply).toContain("What I changed: dropped the floating line.");
    expect(reply).toContain(`Approve: https://boss.sequoiataylor.com/tap/${now.tap_token}?do=approve`);
    expect(reply).toContain(`Try again: https://boss.sequoiataylor.com/tap/${now.tap_token}?do=retry`);
    expect(reply).toContain("Some of the names crossing my desk right now include Alpha, Beta and Gamma, among others.");
  });

  it("\"5: I don't like this, try again\" is a genuinely different draft", async () => {
    const t = (await proposeTemplate(env.DB, null, NAMES)) as any;
    await morningWith(["a", "b", "c", "d", `prospect-template:${t.template.id}`]);
    const res = await handleBossInboundMail(mail("5: I don't like this, try again"), env as never);
    expect(res.outcome).toBe("TEMPLATE_ANSWERED");
    const [now] = await pendingRows();
    expect(now.variant).toBe(1);
    expect(now.subject).not.toBe(t.template.subject);
    expect(JSON.parse(now.change_notes)).toEqual(["I don't like this", "try again"]);
  });

  it("\"5: approved\" approves it, and links the people whose one follow-up it releases", async () => {
    const t = (await proposeTemplate(env.DB, null, NAMES)) as any;
    await importProspects(env.DB, [{ email: "p1@family.example", name: "Pat One", source: "8raise_2026_10_11", touches: 1, first_sent_at: Date.parse("2026-10-11T15:00:00Z"), status: "active" } as any]);
    await morningWith(["a", "b", "c", "d", `prospect-template:${t.template.id}`]);
    // Before her word, nothing goes.
    expect((await prospectPlan(env.DB, WED_10AM)).sends).toEqual([]);
    const res = await handleBossInboundMail(mail("5: approved"), env as never);
    expect(res.outcome).toBe("TEMPLATE_ANSWERED");
    expect((await env.DB.prepare(`SELECT status FROM prospect_templates WHERE id = ?`).bind(t.template.id).first<any>()).status).toBe("approved");
    expect((await env.DB.prepare(`SELECT template_id FROM prospects WHERE email = 'p1@family.example'`).first<any>()).template_id).toBe(t.template.id);
  });

  it("a number that names some other card is not the template's: nothing is redrafted", async () => {
    const t = (await proposeTemplate(env.DB, null, NAMES)) as any;
    await morningWith(["lp:1", "lp:2", "approval:x", "rc:y", "lp:5", `prospect-template:${t.template.id}`]);
    const res = await handleBossInboundMail(mail("5: try again"), env as never);
    expect(res.outcome).not.toBe("TEMPLATE_ANSWERED");
    expect((await pendingRows()).map((r: any) => r.id)).toEqual([t.template.id]);
  });

  it("a draft written before her standing rule (a \"Re:\" subject) is redrafted under it, with her words kept", async () => {
    const old = { subject: "Re: Up to $1B secondary inquiry: {subject_names}", body: "Hi {first},\n\nI hope you don't mind the direct note. We've done more than $100M in secondary transactions.\n\n{names_line} Would love to find 15 minutes to compare notes, and I'm happy to talk about what you're looking to add or trim.\n\nSequoia Taylor\nWest Peek Ventures\n\nIf this isn't relevant, just reply \"no thanks\" and I won't write again.", follow_up: "Hi {first},\n\nJust floating this back up. {names_line} We've done more than $100M in secondary transactions, and I'd love to find 15 minutes to compare notes on what you're looking to add or trim.\n\nSequoia Taylor\nWest Peek Ventures\n\nIf this isn't relevant, just reply \"no thanks\" and I won't write again." };
    await env.DB.prepare(`INSERT INTO prospect_templates (id, hash, subject, body, follow_up, names_json, status, tap_token, created_at) VALUES ('ptp_oldone1', 'h_old', ?, ?, ?, ?, 'pending', 'tok_old_aaaaaaaaaaaaaaaaaa', 1)`).bind(old.subject, old.body, old.follow_up, JSON.stringify(NAMES)).run();
    const res = await handleBossInboundMail(mail("ptp_oldone1: I don't like that you make it seem like those are the only 3 companies I'm working on."), env as never);
    expect(res.outcome).toBe("TEMPLATE_ANSWERED");
    const [now] = await pendingRows();
    expect(now.parent_id).toBe("ptp_oldone1");
    expect(now.subject).not.toMatch(/^Re:/);
    expect(JSON.parse(now.change_notes)).toEqual(["I don't like that you make it seem like those are the only 3 companies I'm working on."]);
  });
});
