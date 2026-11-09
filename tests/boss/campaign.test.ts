import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import worker from "../../src/worker/boss/index";
import { handleBossInboundMail } from "../../src/worker/boss/intake/inboundMail";
import { BOSS_INTAKE_MAILBOX } from "../../src/shared/boss/intake/mail.mjs";
import { advancePartnerOrgs, campaignResearched, campaignVerified, holdOrgs, macCampaignWork, researchFound, staggerHold, stopCompany } from "../../src/worker/boss/outreach/campaign";
import { processReplies } from "../../src/worker/boss/outreach/engine";
import { isSuppressed } from "../../src/worker/boss/outreach/suppression";
import { businessByKey, PARTNERS_KEY } from "../../src/worker/boss/outreach/catalog";
import { composeEmail } from "../../src/worker/boss/outreach/compose";
import { outboundProblems } from "../../src/shared/boss/t2rGroups/rules.mjs";
import { pageProblems } from "../../src/shared/boss/outreach/campaign.mjs";
import { all, row, stubFetch } from "./helpers";

/**
 * "IF I EMAILED THIS TO BOSS@ I NEED THEM TO TAKE THIS AND DO IT END 2 END" (owner, 8 Nov 2026).
 * Her request exactly as she wrote it, with made-up people and a made-up company (her rule: no real
 * names in test mail). Before the campaign lane, triage split it to Danielle and the systems desk.
 */
const HER_REQUEST = `I want one of my boss OS agents to create a drip campaign to try to sell a time 2 read partnership for these people and they will need to create emails and maybe a one pager or something (they can use docs in repo):


The corporate email pattern for Acmelearn follows a standard structure. For direct business development and partnership pitches, the specific, verified executive email addresses are detailed below.

Verified Executive Email Addresses

• Dana Fakename (SVP, Revenue & Growth Marketing): dana.fakename@acmelearn.example
\t• Best use: Digital sponsorships, audience integration, performance marketing, or brand alliances.
• Pat Placeholder (President): pat.placeholder@acmelearn.example
\t• Best use: Corporate mergers, high-level institutional alliances, or overarching parent company contracts.
• Robin Sample (Director of Business Development): robin.sample@acmelearn.example
\t• Note: The fallback operational email address for her specific department's vendor onboarding, institutional quotes, and processing is purchaseorders@acmelearn.example.
\t• Best use: B2B curriculum distribution packages, school-district bundles, or software tools integration.`;

function mail(body: string, subject = "") {
  const from = "Sequoia <seq.taylor@gmail.com>";
  const headers = new Headers({
    from, subject,
    "authentication-results": "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass header.from=gmail.com",
    "message-id": `<${Math.random().toString(36).slice(2)}@mail.gmail.com>`,
  });
  const raw = `From: ${from}\r\nSubject: ${subject}\r\n\r\n${body}`;
  return { from: "seq.taylor@gmail.com", to: BOSS_INTAKE_MAILBOX, headers, raw: new Response(raw).body!, rawSize: new TextEncoder().encode(raw).length };
}

const DAY = 86_400_000;
const MON_10AM_CT = Date.parse("2026-11-09T16:00:00Z");

/** The product's own capabilities document, as its repo serves it (read at build time, never copied). */
let features: string | null = "# Capabilities\n\n## Live today\n\n- Stories get harder as your child reads.\n- A planned school workspace (planned).\n- Narration and word help on every story.\n";
let restore: () => void = () => {};
beforeEach(() => {
  restore = stubFetch((req) => req.url.includes("raw.githubusercontent.com") && features !== null ? new Response(features) : new Response("no", { status: 404 }));
});
afterEach(() => restore());

beforeEach(async () => {
  await env.DB.exec("DELETE FROM outreach_settings WHERE key LIKE 'probe:%'; DELETE FROM boss_inbound_mail; DELETE FROM outreach_campaigns; DELETE FROM outreach_partner_orgs; DELETE FROM outreach_sends; DELETE FROM outreach_suppression; DELETE FROM outreach_replies; DELETE FROM outreach_bounce_fixes; DELETE FROM boss_task_notices;");
  await env.DB.prepare(`DELETE FROM outreach_prospects WHERE business_key = ?`).bind(PARTNERS_KEY).run();
});

/** The Mac's research came back: `people` found published (none = nothing found). */
const researched = (id: string, people: Array<{ name: string; email: string; source_url: string }> = [], seen: Array<{ name: string; email: string }> = [], at = MON_10AM_CT) =>
  campaignResearched(env as never, id, { people, seen }, at);

/** Every address in a person's line fails the check ("invalid"), one Mac tick each. */
async function outOfAddresses(id: string, first: string) {
  for (let i = 0; i < 4; i++) {
    const spec = JSON.parse((await row<any>(`SELECT spec FROM outreach_campaigns WHERE id = ?`, id)).spec);
    const p = spec.contacts.find((x: any) => x.first.toLowerCase() === first);
    if (p.no_address) return;
    await campaignVerified(env as never, id, [{ email: p.email, result: "invalid" }], MON_10AM_CT);
  }
}

async function campaignFromHer() {
  const r = await handleBossInboundMail(mail(HER_REQUEST) as never, env as never);
  const c = await row<any>(`SELECT * FROM outreach_campaigns WHERE mail_id = ?`, r.mailId);
  return { r, c, spec: c ? JSON.parse(c.spec) : null };
}

describe("her drip-campaign email becomes a campaign, end to end", () => {
  it("Monique takes it by rule: all three people sequenced (the president last), the PO inbox skipped, no desk triaged, no card", async () => {
    const { r, c, spec } = await campaignFromHer();
    expect(r.outcome).toBe("CAMPAIGN");
    expect(r.signer).toBe("Monique");
    expect(c).not.toBeNull();
    expect(c.business_key).toBe(PARTNERS_KEY);
    expect(c.org_name).toBe("Acmelearn");
    const send = spec.contacts.filter((x: any) => x.role === "send");
    expect(send.map((x: any) => [x.email, x.order, x.angle])).toEqual([
      ["dana.fakename@acmelearn.example", 0, "brand"],
      ["robin.sample@acmelearn.example", 1, "distribution"],
      ["pat.placeholder@acmelearn.example", 2, "alliance"],
    ]);
    expect(spec.contacts.filter((x: any) => x.role !== "send")).toEqual([]);
    expect(spec.skipped.map((x: any) => x.email)).toEqual(["purchaseorders@acmelearn.example"]);
    // Nobody else got the work: no task was opened on any desk for this email.
    expect(await all(`SELECT id FROM tasks WHERE json_extract(input, '$.mail_id') = ?`, r.mailId)).toHaveLength(0);
    expect(r.reply).toMatch(/email 2: https:\/\/boss\.sequoiataylor\.com\/p\/[A-Za-z0-9_-]{16,}/);
    // No approval card for a partner campaign: all four emails go automatically (owner, 8 Nov 2026).
    expect(await row(`SELECT 1 AS x FROM judgement_calls WHERE resume_kind = 'outreach_copy' AND json_extract(resume_detail, '$.business_key') = ?`, PARTNERS_KEY)).toBeNull();
  });

  it("all three are sequenced one at a time, seven days apart; four emails each with no card; a reply stops everyone", async () => {
    const { c } = await campaignFromHer();
    await researched(c.id);
    await campaignVerified(env as never, c.id, [
      { email: "dana.fakename@acmelearn.example", result: "valid" },
      { email: "robin.sample@acmelearn.example", result: "valid" },
      { email: "pat.placeholder@acmelearn.example", result: "valid" },
    ], MON_10AM_CT);
    const ps = await all<any>(`SELECT * FROM outreach_prospects WHERE campaign_id = ? ORDER BY created_at`, c.id);
    expect(ps.map((p) => [p.contact_first, p.angle])).toEqual([["Dana", "brand"], ["Robin", "distribution"], ["Pat", "alliance"]]);
    expect((await row<any>(`SELECT state, notice_state FROM outreach_campaigns WHERE id = ?`, c.id))).toEqual({ state: "live", notice_state: "due" });

    const b = businessByKey(PARTNERS_KEY)!;
    // One at a time: Robin waits for Dana's first email, then 7 days; Pat waits for Robin's.
    expect(await staggerHold(env.DB, b, ps[0], MON_10AM_CT)).toBeNull();
    expect(await staggerHold(env.DB, b, ps[1], MON_10AM_CT)).toMatch(/earlier/);
    expect(await staggerHold(env.DB, b, ps[2], MON_10AM_CT)).toMatch(/earlier/);
    const sendFirst = async (p: any, at: number, id: string) => {
      await env.DB.prepare(`UPDATE outreach_prospects SET state = 'in_sequence', step = 1 WHERE id = ?`).bind(p.id).run();
      await env.DB.prepare(`INSERT INTO outreach_sends (id, business_key, prospect_id, to_email, step, is_test, status, sent_at) VALUES (?, ?, ?, ?, 0, 0, 'sent', ?)`).bind(id, PARTNERS_KEY, p.id, p.email, at).run();
    };
    await sendFirst(ps[0], MON_10AM_CT, "osd_t1");
    expect(await staggerHold(env.DB, b, ps[1], MON_10AM_CT + 6 * DAY)).toMatch(/7 days/);
    expect(await staggerHold(env.DB, b, ps[1], MON_10AM_CT + 7 * DAY)).toBeNull();
    expect(await staggerHold(env.DB, b, ps[2], MON_10AM_CT + 7 * DAY)).toMatch(/earlier/);
    await sendFirst(ps[1], MON_10AM_CT + 7 * DAY, "osd_t2");
    expect(await staggerHold(env.DB, b, ps[2], MON_10AM_CT + 13 * DAY)).toMatch(/7 days/);
    expect(await staggerHold(env.DB, b, ps[2], MON_10AM_CT + 14 * DAY)).toBeNull();

    // Four emails each, all automatic: no card is needed for emails 3 and 4, and none is raised.
    const { laterWordsApproved } = await import("../../src/worker/boss/outreach/engine");
    expect(b.steps).toHaveLength(4);
    expect(b.steps.every((st) => !st.approvalKey)).toBe(true);
    expect(await laterWordsApproved(env as never, b, 2, "A", MON_10AM_CT)).toBe("approved");
    expect(await laterWordsApproved(env as never, b, 3, "A", MON_10AM_CT)).toBe("approved");
    expect(await row(`SELECT 1 AS x FROM judgement_calls WHERE resume_kind = 'outreach_copy' AND json_extract(resume_detail, '$.business_key') = ?`, PARTNERS_KEY)).toBeNull();
    let first = "";
    for (const p of ps) for (let step = 0; step < 4; step++) {
      const m = composeEmail({ business: b, step, to: p.email, org: p.org_name, metro: "", unsubToken: p.unsub_token, postalAddress: "1 Test Street, Testville, TN 00000", contactFirst: p.contact_first, angle: p.angle, pageUrl: "https://example.test/p", firstSubject: first || null });
      if (step === 0) first = m.subject;
      expect(m.body).toMatch(new RegExp(`^Hi ${p.contact_first},`));
      expect(outboundProblems(`${m.subject}\n${m.body}`.replace(/Acmelearn/g, ""))).toEqual([]);
      expect(m.raw).not.toMatch(/^Cc:/m);
      if (step === 1) expect(m.body).toContain("https://example.test/p");
    }
    // A fifth email is never built.
    expect(() => composeEmail({ business: b, step: 4, to: ps[0].email, org: "Acmelearn", metro: "", unsubToken: "t", postalAddress: "1 Test Street, Testville, TN 00000", contactFirst: "Dana", angle: "brand", pageUrl: "https://example.test/p" })).toThrow(/past the third/);

    // A reply from Dana stops Robin and Pat too.
    expect(await stopCompany(env.DB, ps[0], MON_10AM_CT + 15 * DAY)).toBe(2);
    expect((await all<any>(`SELECT state FROM outreach_prospects WHERE id IN (?, ?)`, ps[1].id, ps[2].id)).map((r) => r.state)).toEqual(["done", "done"]);
  });

  it("research first: nothing is checked or queued before each person's research is back", async () => {
    const { c } = await campaignFromHer();
    const before = await macCampaignWork(env as never, MON_10AM_CT);
    expect(before.campaign_research.find((r) => r.id === c.id)?.people.map((p) => p.name)).toEqual(["Dana Fakename", "Robin Sample", "Pat Placeholder"]);
    expect(before.campaigns.find((x) => x.id === c.id)).toBeUndefined();
    // A verdict before the research is back is not acted on.
    await campaignVerified(env as never, c.id, [{ email: "dana.fakename@acmelearn.example", result: "valid" }], MON_10AM_CT);
    expect(await all(`SELECT 1 FROM outreach_prospects WHERE campaign_id = ?`, c.id)).toHaveLength(0);
    await researched(c.id);
    const after = await macCampaignWork(env as never, MON_10AM_CT);
    expect(after.campaign_research.find((r) => r.id === c.id)).toBeUndefined();
    expect(after.campaigns.find((x) => x.id === c.id)?.emails).toEqual(["dana.fakename@acmelearn.example", "robin.sample@acmelearn.example", "pat.placeholder@acmelearn.example"]);
  });

  it("valid, unknown and catchall are written to; the done reply says which check said what", async () => {
    const { c } = await campaignFromHer();
    await researched(c.id);
    await campaignVerified(env as never, c.id, [
      { email: "dana.fakename@acmelearn.example", result: "unknown" },
      { email: "robin.sample@acmelearn.example", result: "catchall" }, { email: "pat.placeholder@acmelearn.example", result: "valid" },
    ], MON_10AM_CT);
    const queued = await all<any>(`SELECT email FROM outreach_prospects WHERE campaign_id = ? ORDER BY created_at`, c.id);
    expect(queued.map((q) => q.email)).toEqual(["dana.fakename@acmelearn.example", "robin.sample@acmelearn.example", "pat.placeholder@acmelearn.example"]);
    const n = JSON.parse((await row<any>(`SELECT notice FROM outreach_campaigns WHERE id = ?`, c.id)).notice);
    expect(n.happened).toMatch(/is queued/);
    expect(n.details.join("\n")).toMatch(/Dana Fakename: no other published address found, so the one you gave; the check got no answer/);
    expect(n.details.join("\n")).toMatch(/Robin Sample: .*accepts all mail/);
    expect(n.thread).toHaveLength(1);
  });

  it("the one-pager is public, names the company, and holds no person", async () => {
    const { c } = await campaignFromHer();
    const res = await worker.fetch(new Request(`https://boss.test/api/outreach/p/${c.page_token}`), env as never, {} as never);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Acmelearn");
    // What it does today comes from the product's own document, and a planned feature never shows.
    expect(html).toContain("Stories get harder as your child reads.");
    expect(html).not.toMatch(/planned school workspace/);
    expect(html).not.toMatch(/Dana|Robin|Pat|@acmelearn/);
    // The page's own rule: it names partner pricing and a revenue share, never a figure or a brand.
    const words = html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/Acmelearn/g, "");
    expect(words).toMatch(/Partner pricing for your families/);
    expect(words).toMatch(/revenue share on every family/);
    expect(words).toMatch(/How Time2Read is different/);
    expect(pageProblems(words, outboundProblems)).toEqual([]);
    expect((await worker.fetch(new Request("https://boss.test/api/outreach/p/nope"), env as never, {} as never)).status).toBe(404);
  });
});

describe("the HeyGetOnMyLevel line shows only while its level check really works", () => {
  const hgoml = (status: number) => (req: Request) => {
    if (req.url.includes("raw.githubusercontent.com")) return new Response(features ?? "", { status: features ? 200 : 404 });
    if (req.url === "https://heygetonmylevel.com/") return new Response('<script type="module" src="/assets/index-Test123.js"></script>');
    if (req.url.endsWith("/assets/index-Test123.js")) return new Response('const u="https://abcdefgh.supabase.co",k="eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJlc2lnbmF0dXJl";');
    if (req.url === "https://abcdefgh.supabase.co/functions/v1/generate-reading") return status === 200
      ? Response.json({ title: "The Kite", text: "Mia ran to the hill with her red kite. The wind pulled it up and up until it was a small dot in the sky, and she laughed as the string tugged at her hands." })
      : new Response("Unauthorized", { status });
    return new Response("no", { status: 404 });
  };
  it("renders at once from the last probe, refreshes at most hourly, drops a result over 24h; the done reply probes fresh", async () => {
    const { c } = await campaignFromHer();
    const { onePagerFor } = await import("../../src/worker/boss/outreach/campaign");
    const H = 3_600_000;
    let calls = 0;
    const counting = (status: number) => { const h = hgoml(status); return (req: Request) => { if (req.url.includes("generate-reading")) calls++; return h(req); }; };
    restore(); restore = stubFetch(counting(200));
    // No result yet: the line is out, and this view runs the first probe (awaited here: no context).
    expect(await onePagerFor(env as never, c.page_token, undefined, MON_10AM_CT)).not.toContain("HeyGetOnMyLevel");
    expect(calls).toBe(1);
    // The next view within the hour shows it, from the stored pass, with no new call.
    expect(await onePagerFor(env as never, c.page_token, undefined, MON_10AM_CT + 10 * 60_000)).toContain("Included with Time2Read Premium: HeyGetOnMyLevel");
    expect(calls).toBe(1);
    // The site breaks; an hour on, a view still shows the last pass, and refreshes (one call) to a fail.
    restore(); restore = stubFetch(counting(401));
    expect(await onePagerFor(env as never, c.page_token, undefined, MON_10AM_CT + H + 1)).toContain("HeyGetOnMyLevel");
    expect(calls).toBe(2);
    expect(await onePagerFor(env as never, c.page_token, undefined, MON_10AM_CT + H + 2)).not.toContain("HeyGetOnMyLevel");
    expect(calls).toBe(2);
    // A pass older than 24 hours is no pass.
    restore(); restore = stubFetch(counting(200));
    await env.DB.prepare(`UPDATE outreach_settings SET value = ? WHERE key = 'probe:hgoml_level_check'`).bind(JSON.stringify({ ok: true, at: MON_10AM_CT, tried_at: MON_10AM_CT + 30 * H })).run();
    expect(await onePagerFor(env as never, c.page_token, undefined, MON_10AM_CT + 30 * H)).not.toContain("HeyGetOnMyLevel");
    expect(calls).toBe(2);
    // The done reply runs a fresh probe whatever the hour; a fail says so in one line.
    restore(); restore = stubFetch(counting(401));
    await researched(c.id);
    await campaignVerified(env as never, c.id, [{ email: "dana.fakename@acmelearn.example", result: "valid" }, { email: "robin.sample@acmelearn.example", result: "valid" }, { email: "pat.placeholder@acmelearn.example", result: "valid" }], MON_10AM_CT + 30 * H + 1);
    expect(calls).toBe(3);
    const n = JSON.parse((await row<any>(`SELECT notice FROM outreach_campaigns WHERE id = ?`, c.id)).notice);
    expect(n.details.join("\n")).toMatch(/HeyGetOnMyLevel is left off the one-pager/);
  });
});

describe("a request typed in from her session gets the same receipt, as Monique's own email", () => {
  it("the receipt is owed at once; the done reply joins its thread", async () => {
    const m = mail(HER_REQUEST, "Acmelearn drip");
    m.headers.set("x-boss-intake-origin", "console");
    m.headers.set("authentication-results", "boss-os-console; dmarc=pass (owner session, not SMTP)");
    const r = await handleBossInboundMail(m as never, env as never);
    expect(r.outcome).toBe("CAMPAIGN");
    const c = await row<any>(`SELECT * FROM outreach_campaigns WHERE mail_id = ?`, r.mailId);
    const receipt = JSON.parse(c.notice);
    expect(c.notice_state).toBe("due");
    expect(receipt.from).toBe("Monique");
    expect(receipt.subject).toBe("Acmelearn drip");
    expect(receipt.details.join("\n")).toMatch(/email 1 goes to Dana Fakename .*\bCentral\b/); // "within the hour (Central)" in a weekday 9-17 Central hour, "Monday, Nov 9, at 9 a.m. Central" outside it
    expect(receipt.details.join("\n")).toMatch(/What comes back/);
    // The Mac is off: the addresses are checked before the receipt has gone. The receipt is kept.
    await researched(c.id);
    await campaignVerified(env as never, c.id, [{ email: "dana.fakename@acmelearn.example", result: "valid" }, { email: "robin.sample@acmelearn.example", result: "valid" }, { email: "pat.placeholder@acmelearn.example", result: "valid" }], MON_10AM_CT);
    expect(JSON.parse((await row<any>(`SELECT notice FROM outreach_campaigns WHERE id = ?`, c.id)).notice)).toEqual(receipt);
    // The receipt goes; the done reply, queued behind it, is due next; then nothing is left.
    const { campaignNoticed } = await import("../../src/worker/boss/outreach/campaign");
    await campaignNoticed(env as never, c.id);
    const after = await row<any>(`SELECT notice, notice_state FROM outreach_campaigns WHERE id = ?`, c.id);
    expect(after.notice_state).toBe("due");
    const done = JSON.parse(after.notice);
    await campaignNoticed(env as never, c.id);
    expect((await row<any>(`SELECT notice_state FROM outreach_campaigns WHERE id = ?`, c.id)).notice_state).toBe("sent");
    expect(done.subject).toBe("Re: Acmelearn drip");
    expect(done.thread).toEqual(receipt.thread);
  });
});

describe("the one-pager's own rule", () => {
  it("may name partner pricing and a revenue share, but never a figure, a percentage, a named reading app or 'best'", () => {
    expect(pageProblems("Partner pricing for your families. A revenue share on every family you bring.", outboundProblems)).toEqual([]);
    expect(pageProblems("Partner pricing from $4 a family.", outboundProblems).join()).toMatch(/figure/);
    expect(pageProblems("A 20% revenue share.", outboundProblems).join()).toMatch(/figure/);
    expect(pageProblems("Unlike Epic, every story is new.", outboundProblems).join()).toMatch(/reading app/);
    expect(pageProblems("The best reading app for families.", outboundProblems).join()).toMatch(/better/);
    expect(pageProblems("Book a call with us.", outboundProblems).join()).toMatch(/call/);
    // Emails keep the stricter rule: no money words at all.
    expect(outboundProblems("Partner pricing for your families.").join()).toMatch(/price/);
  });
});

describe("nothing is queued without today's features", () => {
  it("an unreadable capabilities document holds the campaign; the tick queues it once the document reads", async () => {
    features = null;
    const { c } = await campaignFromHer();
    await researched(c.id);
    await campaignVerified(env as never, c.id, [
      { email: "dana.fakename@acmelearn.example", result: "valid" },
      { email: "robin.sample@acmelearn.example", result: "valid" }, { email: "pat.placeholder@acmelearn.example", result: "valid" },
    ], MON_10AM_CT);
    expect(await all(`SELECT 1 FROM outreach_prospects WHERE campaign_id = ?`, c.id)).toHaveLength(0);
    expect((await row<any>(`SELECT state FROM outreach_campaigns WHERE id = ?`, c.id)).state).toBe("verifying");
    features = "## Live today\n\n- Stories get harder as your child reads.\n";
    const { retryHeldCampaigns } = await import("../../src/worker/boss/outreach/campaign");
    expect(await retryHeldCampaigns(env as never, MON_10AM_CT + 3_600_000)).toBe(3);
  });
});

describe("the next organisation starts only when the live campaign ends", () => {
  it("nothing starts while Acmelearn is live; when it ends, the first org held after it is researched", async () => {
    const { c } = await campaignFromHer();
    await researched(c.id);
    await campaignVerified(env as never, c.id, [
      { email: "dana.fakename@acmelearn.example", result: "valid" },
      { email: "robin.sample@acmelearn.example", result: "valid" }, { email: "pat.placeholder@acmelearn.example", result: "valid" },
    ], MON_10AM_CT);
    const b = businessByKey(PARTNERS_KEY)!;
    await holdOrgs(env as never, b, ["Second Org", "Third Org"], "Acmelearn", MON_10AM_CT);

    expect((await advancePartnerOrgs(env as never, MON_10AM_CT + DAY)).started).toEqual([]);
    expect((await row<any>(`SELECT state FROM outreach_partner_orgs WHERE org_name = 'Second Org'`)).state).toBe("waiting");

    // A reply from anyone there ends it.
    const dana = await row<any>(`SELECT * FROM outreach_prospects WHERE campaign_id = ? AND contact_first = 'Dana'`, c.id);
    await env.DB.prepare(`UPDATE outreach_prospects SET state = 'replied' WHERE id = ?`).bind(dana.id).run();
    await stopCompany(env.DB, dana, MON_10AM_CT + 2 * DAY);
    const r = await advancePartnerOrgs(env as never, MON_10AM_CT + 2 * DAY);
    expect(r.started).toEqual([`${PARTNERS_KEY}:Second Org`]);
    expect((await row<any>(`SELECT state FROM outreach_partner_orgs WHERE org_name = 'Acmelearn'`)).state).toBe("done");
    expect((await row<any>(`SELECT state FROM outreach_partner_orgs WHERE org_name = 'Third Org'`)).state).toBe("waiting");
    // And only one at a time.
    expect((await advancePartnerOrgs(env as never, MON_10AM_CT + 3 * DAY)).started).toEqual([]);
  });

  it("a campaign with no reply ends 14 days after its last email, not before", async () => {
    const { c } = await campaignFromHer();
    await researched(c.id);
    // Robin and Pat's every address fails the check: they are out of addresses, and Dana carries on.
    for (const p of ["robin", "pat"]) await outOfAddresses(c.id, p);
    await campaignVerified(env as never, c.id, [{ email: "dana.fakename@acmelearn.example", result: "valid" }], MON_10AM_CT);
    const b = businessByKey(PARTNERS_KEY)!;
    await holdOrgs(env as never, b, ["Second Org"], "Acmelearn", MON_10AM_CT);
    const dana = await row<any>(`SELECT * FROM outreach_prospects WHERE campaign_id = ?`, c.id);
    await env.DB.prepare(`UPDATE outreach_prospects SET state = 'done', step = 4 WHERE id = ?`).bind(dana.id).run();
    const last = MON_10AM_CT + 14 * DAY;
    await env.DB.prepare(`INSERT INTO outreach_sends (id, business_key, prospect_id, to_email, step, is_test, status, sent_at) VALUES ('osd_t2', ?, ?, ?, 3, 0, 'sent', ?)`).bind(PARTNERS_KEY, dana.id, dana.email, last).run();
    expect((await advancePartnerOrgs(env as never, last + 13 * DAY)).started).toEqual([]);
    expect((await advancePartnerOrgs(env as never, last + 14 * DAY)).started).toEqual([`${PARTNERS_KEY}:Second Org`]);
  });

  it("her 'hold these orgs for later, after X' email holds them in her order", async () => {
    await campaignFromHer();
    const r = await handleBossInboundMail(mail("Time2Read: hold these orgs for later, after Acmelearn:\n1. Second Org\n2. The Good and the Third\n- Fourth Org") as never, env as never);
    expect(r.outcome).toBe("ORGS_HELD");
    const order = await all<any>(`SELECT org_name, state FROM outreach_partner_orgs WHERE business_key = ? ORDER BY position`, PARTNERS_KEY);
    expect(order.map((o) => o.org_name)).toEqual(["Acmelearn", "Second Org", "The Good and the Third", "Fourth Org"]);
  });

  it("a semicolon list keeps a name that has commas in it whole", async () => {
    await campaignFromHer();
    const r = await handleBossInboundMail(mail("For Time2Read partnerships, hold these organizations for later, after Acmelearn, in this order: Second Org; Abeka Two; Secular, Eclectic, Academic (SEA) Homeschoolers.") as never, env as never);
    expect(r.outcome).toBe("ORGS_HELD");
    const order = await all<any>(`SELECT org_name FROM outreach_partner_orgs WHERE business_key = ? ORDER BY position`, PARTNERS_KEY);
    expect(order.map((o) => o.org_name)).toEqual(["Acmelearn", "Second Org", "Abeka Two", "Secular, Eclectic, Academic (SEA) Homeschoolers"]);
  });
});

/**
 * "IF THOSE EMAILS BOUNCE IT SHOULD DO SOME RESEARCH FOR THE REAL EMAIL OR IT CAN DO RESEARCH FIRST AND
 * IF FIND NOTHING JUST GUESS AND IT CAN KEEP GUESSING AT THE EMAILS" (owner, 9 Nov 2026).
 */
describe("research first, then guess, and keep guessing", () => {
  const spec = async (id: string) => JSON.parse((await row<any>(`SELECT spec FROM outreach_campaigns WHERE id = ?`, id)).spec);
  const person = async (id: string, first: string) => (await spec(id)).contacts.find((x: any) => x.first === first);
  const toCheck = async (id: string) => (await macCampaignWork(env as never, MON_10AM_CT)).campaigns.find((x) => x.id === id)?.emails ?? [];
  const prospects = (id: string) => all<any>(`SELECT email, state, step FROM outreach_prospects WHERE campaign_id = ? ORDER BY created_at, email`, id);
  const updates = (id: string) => all<any>(`SELECT kind, body, needs_her FROM boss_task_notices WHERE task_id = ? ORDER BY created_at`, id);
  /** A hard bounce for `to`, as the outreach mailbox shows it. */
  const bounceFor = (to: string) => ({
    list: async (q: string) => (q.includes("mailer-daemon") ? [{ id: `bounce-${to}`, threadId: `th-bounce-${to}` }] : []),
    read: async (id: string) => ({ id, threadId: `th-bounce-${to}`, labelIds: [], internalDate: MON_10AM_CT,
      headers: { from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", subject: "Delivery Status Notification (Failure)" }, body: `Final-Recipient: rfc822; ${to}` }),
  });
  /** Her three, researched (nothing found unless given), every address valid: all live. */
  async function liveCampaign(found: Array<{ name: string; email: string; source_url: string }> = []) {
    const { c } = await campaignFromHer();
    await researched(c.id, found);
    await campaignVerified(env as never, c.id, (await toCheck(c.id)).map((email) => ({ email, result: "valid" })), MON_10AM_CT);
    expect((await row<any>(`SELECT state FROM outreach_campaigns WHERE id = ?`, c.id)).state).toBe("live");
    await env.DB.prepare(`UPDATE outreach_campaigns SET notice_state = 'sent' WHERE id = ?`).bind(c.id).run();
    return c;
  }

  it("an address research finds published wins over the one she gave, and the done reply names the page", async () => {
    const { c } = await campaignFromHer();
    await researched(c.id, [{ name: "Dana Fakename", email: "dana.f@acmelearn.example", source_url: "https://acmelearn.example/press" }]);
    expect(await toCheck(c.id)).toEqual(["dana.f@acmelearn.example", "robin.sample@acmelearn.example", "pat.placeholder@acmelearn.example"]);
    await campaignVerified(env as never, c.id, (await toCheck(c.id)).map((email) => ({ email, result: "valid" })), MON_10AM_CT);
    const dana = await row<any>(`SELECT email, source_url FROM outreach_prospects WHERE campaign_id = ? AND contact_first = 'Dana'`, c.id);
    expect(dana).toEqual({ email: "dana.f@acmelearn.example", source_url: "https://acmelearn.example/press" });
    const n = JSON.parse((await row<any>(`SELECT notice FROM outreach_campaigns WHERE id = ?`, c.id)).notice);
    expect(n.details.join("\n")).toMatch(/Dana Fakename: found published at https:\/\/acmelearn\.example\/press/);
  });

  it("nothing found for a person research turned up: first.last at the company's domain is tried first, and the reply says it is a guess", async () => {
    const b = businessByKey(PARTNERS_KEY)!;
    await holdOrgs(env as never, b, ["Second Org"], null, MON_10AM_CT);
    expect((await advancePartnerOrgs(env as never, MON_10AM_CT)).started).toEqual([`${PARTNERS_KEY}:Second Org`]);
    const org = await row<any>(`SELECT id FROM outreach_partner_orgs WHERE org_name = 'Second Org'`);
    const r = await researchFound(env as never, org.id, [{ name: "Lee Example", title: "VP, Partnerships" }], MON_10AM_CT, { domain: "secondorg.example" });
    expect(r.campaignId).toBeTruthy();
    expect(await toCheck(r.campaignId!)).toEqual(["lee.example@secondorg.example"]);
    expect((await person(r.campaignId!, "Lee")).queue.map((q: any) => q.email)).toEqual(["lexample@secondorg.example", "lee@secondorg.example", "leeexample@secondorg.example"]);
    await campaignVerified(env as never, r.campaignId!, [{ email: "lee.example@secondorg.example", result: "unknown" }], MON_10AM_CT);
    expect((await prospects(r.campaignId!)).map((p) => p.email)).toEqual(["lee.example@secondorg.example"]);
    const n = JSON.parse((await row<any>(`SELECT notice FROM outreach_campaigns WHERE id = ?`, r.campaignId)).notice);
    expect(n.subject).toMatch(/Second Org has started/);
    expect(n.details.join("\n")).toMatch(/Lee Example: no published address found, so lee\.example@secondorg\.example is a guess/);
  });

  it("a shape seen published at the company comes before the usual ones", async () => {
    const b = businessByKey(PARTNERS_KEY)!;
    await holdOrgs(env as never, b, ["Second Org"], null, MON_10AM_CT);
    await advancePartnerOrgs(env as never, MON_10AM_CT);
    const org = await row<any>(`SELECT id FROM outreach_partner_orgs WHERE org_name = 'Second Org'`);
    const r = await researchFound(env as never, org.id, [{ name: "Lee Example", title: "VP, Partnerships" }], MON_10AM_CT,
      { domain: "secondorg.example", seen: [{ name: "Kim Press", email: "kpress@secondorg.example" }] });
    expect(await toCheck(r.campaignId!)).toEqual(["lexample@secondorg.example"]);
  });

  it("'invalid' from the check is skipped without sending, and the next address is checked", async () => {
    const { c } = await campaignFromHer();
    await researched(c.id);
    await campaignVerified(env as never, c.id, [{ email: "dana.fakename@acmelearn.example", result: "invalid" }], MON_10AM_CT);
    expect(await prospects(c.id)).toEqual([]);
    // Her address was first.last, so the next shape is flast.
    expect(await toCheck(c.id)).toContain("dfakename@acmelearn.example");
    expect(await toCheck(c.id)).not.toContain("dana.fakename@acmelearn.example");
    await campaignVerified(env as never, c.id, [{ email: "dfakename@acmelearn.example", result: "valid" }], MON_10AM_CT);
    expect((await prospects(c.id)).map((p) => p.email)).toEqual(["dfakename@acmelearn.example"]);
    expect(await all(`SELECT 1 FROM outreach_sends`)).toHaveLength(0);
  });

  it("a hard bounce moves that person to their next address, from email 1; one address in flight; suppressed; a row on Updates, no email", async () => {
    const c = await liveCampaign();
    const dana = await row<any>(`SELECT * FROM outreach_prospects WHERE campaign_id = ? AND contact_first = 'Dana'`, c.id);
    await env.DB.prepare(`UPDATE outreach_prospects SET state = 'in_sequence', step = 2 WHERE id = ?`).bind(dana.id).run();
    await env.DB.prepare(`INSERT INTO outreach_sends (id, business_key, prospect_id, to_email, step, is_test, status, sent_at) VALUES ('osd_b1', ?, ?, ?, 0, 0, 'sent', ?)`).bind(PARTNERS_KEY, dana.id, dana.email, MON_10AM_CT).run();
    await processReplies(env as never, bounceFor("dana.fakename@acmelearn.example") as never, MON_10AM_CT + DAY);
    expect(await isSuppressed(env.DB, "dana.fakename@acmelearn.example")).toBe(true);
    expect((await row<any>(`SELECT state FROM outreach_prospects WHERE id = ?`, dana.id)).state).toBe("bounced");
    // The bounce agent never adds a second address for her: the campaign's next address is the only one.
    expect(await all(`SELECT 1 FROM outreach_bounce_fixes`)).toHaveLength(0);
    expect(await toCheck(c.id)).toEqual(["dfakename@acmelearn.example"]);
    expect((await all<any>(`SELECT 1 FROM outreach_prospects WHERE campaign_id = ? AND contact_first = 'Dana' AND state IN ('new','in_sequence')`, c.id))).toHaveLength(0);
    await campaignVerified(env as never, c.id, [{ email: "dfakename@acmelearn.example", result: "valid" }], MON_10AM_CT + DAY);
    const next = await row<any>(`SELECT * FROM outreach_prospects WHERE campaign_id = ? AND email = 'dfakename@acmelearn.example'`, c.id);
    expect([next.state, next.step]).toEqual(["new", 0]);
    // She keeps her place in line: first, with no wait behind the bounced email.
    expect(await staggerHold(env.DB, businessByKey(PARTNERS_KEY)!, next, MON_10AM_CT + DAY)).toBeNull();
    const u = await updates(c.id);
    expect(u.map((x) => [x.kind, x.needs_her])).toEqual([["campaign_update", 0]]);
    expect(u[0].body).toMatch(/Dana Fakename: dana\.fakename@acmelearn\.example bounced\. Next I check a guess \(dfakename@acmelearn\.example\)/);
    expect((await row<any>(`SELECT notice_state FROM outreach_campaigns WHERE id = ?`, c.id)).notice_state).toBe("sent");
  });

  it("after the cap of four the person is marked 'no working address found' and the others carry on; everyone out = one email", async () => {
    const c = await liveCampaign();
    const robin = await row<any>(`SELECT * FROM outreach_prospects WHERE campaign_id = ? AND contact_first = 'Robin'`, c.id);
    await processReplies(env as never, bounceFor(robin.email) as never, MON_10AM_CT + DAY);
    await outOfAddresses(c.id, "robin");
    const r = await person(c.id, "Robin");
    expect(r.no_address).toBe(true);
    expect(r.tried).toHaveLength(4);
    expect(await toCheck(c.id)).toEqual([]);
    expect((await prospects(c.id)).filter((p) => p.state === "new").map((p) => p.email)).toEqual(["dana.fakename@acmelearn.example", "pat.placeholder@acmelearn.example"]);
    expect((await updates(c.id)).at(-1)!.body).toMatch(/Robin Sample: .*no working address was found after 4 tries\. The others carry on\./);
    expect((await row<any>(`SELECT state, notice_state FROM outreach_campaigns WHERE id = ?`, c.id))).toEqual({ state: "live", notice_state: "sent" });
    // Dana and Pat run out too: now, and only now, one email to her.
    for (const first of ["Dana", "Pat"]) {
      const p = await row<any>(`SELECT * FROM outreach_prospects WHERE campaign_id = ? AND contact_first = ? AND state = 'new'`, c.id, first);
      await processReplies(env as never, bounceFor(p.email) as never, MON_10AM_CT + DAY);
      await outOfAddresses(c.id, first.toLowerCase());
    }
    const end = await row<any>(`SELECT state, notice_state, notice FROM outreach_campaigns WHERE id = ?`, c.id);
    expect([end.state, end.notice_state]).toEqual(["ended", "due"]);
    expect(JSON.parse(end.notice).happened).toMatch(/no working address was found for anyone there/);
  });

  it("people already live on her addresses before this flow keep going; only a bounce sends one to research, then their next address", async () => {
    const c = await liveCampaign();
    // As a campaign built before research-first: no research, no line of addresses.
    const sp = await spec(c.id);
    sp.contacts = sp.contacts.map(({ researched_at, how, given, queue, ...rest }: any) => rest);
    await env.DB.prepare(`UPDATE outreach_campaigns SET spec = ? WHERE id = ?`).bind(JSON.stringify(sp), c.id).run();
    const before = await prospects(c.id);
    expect((await macCampaignWork(env as never, MON_10AM_CT)).campaign_research.find((r) => r.id === c.id)).toBeUndefined();
    expect(await toCheck(c.id)).toEqual([]);
    const robin = await row<any>(`SELECT * FROM outreach_prospects WHERE campaign_id = ? AND contact_first = 'Robin'`, c.id);
    await processReplies(env as never, bounceFor(robin.email) as never, MON_10AM_CT + DAY);
    expect((await macCampaignWork(env as never, MON_10AM_CT + DAY)).campaign_research.find((r) => r.id === c.id)?.people.map((p) => p.name)).toEqual(["Robin Sample"]);
    await researched(c.id, [], [], MON_10AM_CT + DAY);
    expect(await toCheck(c.id)).toEqual(["rsample@acmelearn.example"]);
    // Nobody else was touched: same rows, same states, no new sends.
    expect((await prospects(c.id)).filter((p) => p.email !== robin.email)).toEqual(before.filter((p) => p.email !== robin.email));
  });

  it("a campaign stays open while someone is still on their way to a working address", async () => {
    const c = await liveCampaign();
    const b = businessByKey(PARTNERS_KEY)!;
    await holdOrgs(env as never, b, ["Second Org"], "Acmelearn", MON_10AM_CT);
    const robin = await row<any>(`SELECT * FROM outreach_prospects WHERE campaign_id = ? AND contact_first = 'Robin'`, c.id);
    await processReplies(env as never, bounceFor(robin.email) as never, MON_10AM_CT + DAY);
    await env.DB.prepare(`UPDATE outreach_prospects SET state = 'done' WHERE campaign_id = ? AND state = 'new'`).bind(c.id).run();
    expect((await advancePartnerOrgs(env as never, MON_10AM_CT + 40 * DAY)).started).toEqual([]);
    expect((await row<any>(`SELECT state FROM outreach_campaigns WHERE id = ?`, c.id)).state).toBe("live");
  });

  it("a reply from anyone there stops everyone, a person mid-guess included", async () => {
    const c = await liveCampaign();
    const robin = await row<any>(`SELECT * FROM outreach_prospects WHERE campaign_id = ? AND contact_first = 'Robin'`, c.id);
    await processReplies(env as never, bounceFor(robin.email) as never, MON_10AM_CT + DAY);
    expect(await toCheck(c.id)).toEqual(["rsample@acmelearn.example"]);
    const dana = await row<any>(`SELECT * FROM outreach_prospects WHERE campaign_id = ? AND contact_first = 'Dana'`, c.id);
    await env.DB.prepare(`UPDATE outreach_prospects SET state = 'replied' WHERE id = ?`).bind(dana.id).run();
    await stopCompany(env.DB, dana, MON_10AM_CT + 2 * DAY);
    expect(await toCheck(c.id)).toEqual([]);
    expect((await macCampaignWork(env as never, MON_10AM_CT)).campaign_research.find((r) => r.id === c.id)).toBeUndefined();
    await campaignVerified(env as never, c.id, [{ email: "rsample@acmelearn.example", result: "valid" }], MON_10AM_CT + 2 * DAY);
    expect((await prospects(c.id)).filter((p) => p.state === "new" || p.state === "in_sequence")).toEqual([]);
  });

  it("the bounce brake pauses guessing for the sender (a named stop on Updates); her own addresses still go", async () => {
    const { c } = await campaignFromHer();
    await researched(c.id);
    // Three hard bounces in the window from this sender: the outreach brake's own limit.
    for (const n of [1, 2, 3]) {
      await env.DB.prepare(`INSERT INTO outreach_sends (id, business_key, prospect_id, to_email, step, is_test, status, sent_at) VALUES (?, ?, 'opr_x', ?, 0, 0, 'bounced', ?)`).bind(`osd_bb${n}`, PARTNERS_KEY, `gone${n}@other.example`, MON_10AM_CT - DAY).run();
    }
    await campaignVerified(env as never, c.id, [{ email: "dana.fakename@acmelearn.example", result: "invalid" }, { email: "robin.sample@acmelearn.example", result: "valid" }], MON_10AM_CT);
    const work = await macCampaignWork(env as never, MON_10AM_CT);
    // Dana's next address is a guess: not checked while paused. Pat's (hers) still is.
    expect(work.campaigns.find((x) => x.id === c.id)?.emails).toEqual(["pat.placeholder@acmelearn.example"]);
    expect(work.campaign_stops.join("\n")).toMatch(/NAMED STOP \[GUESSING_PAUSED\]/);
    expect((await prospects(c.id)).map((p) => p.email)).toEqual(["robin.sample@acmelearn.example"]);
    // A guess already checked is held, not queued, while the brake is on.
    await campaignVerified(env as never, c.id, [{ email: "dfakename@acmelearn.example", result: "valid" }], MON_10AM_CT);
    expect((await prospects(c.id)).map((p) => p.email)).toEqual(["robin.sample@acmelearn.example"]);
    const stop = await all<any>(`SELECT kind, needs_her, subject FROM boss_task_notices WHERE kind = 'stop:guessing_paused'`);
    expect(stop).toHaveLength(1);
    expect(stop[0].needs_her).toBe(0);
    // The window clears: the hourly retry queues the held guess.
    const { retryHeldCampaigns } = await import("../../src/worker/boss/outreach/campaign");
    await retryHeldCampaigns(env as never, MON_10AM_CT + 15 * DAY);
    expect((await prospects(c.id)).map((p) => p.email)).toContain("dfakename@acmelearn.example");
  });
});
