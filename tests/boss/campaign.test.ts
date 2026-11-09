import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import worker from "../../src/worker/boss/index";
import { handleBossInboundMail } from "../../src/worker/boss/intake/inboundMail";
import { BOSS_INTAKE_MAILBOX } from "../../src/shared/boss/intake/mail.mjs";
import { advancePartnerOrgs, campaignVerified, holdOrgs, staggerHold, stopCompany } from "../../src/worker/boss/outreach/campaign";
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
  await env.DB.exec("DELETE FROM outreach_settings WHERE key LIKE 'probe:%'; DELETE FROM boss_inbound_mail; DELETE FROM outreach_campaigns; DELETE FROM outreach_partner_orgs; DELETE FROM outreach_sends;");
  await env.DB.prepare(`DELETE FROM outreach_prospects WHERE business_key = ?`).bind(PARTNERS_KEY).run();
});

async function campaignFromHer() {
  const r = await handleBossInboundMail(mail(HER_REQUEST) as never, env as never);
  const c = await row<any>(`SELECT * FROM outreach_campaigns WHERE mail_id = ?`, r.mailId);
  return { r, c, spec: c ? JSON.parse(c.spec) : null };
}

describe("her drip-campaign email becomes a campaign, end to end", () => {
  it("Monique takes it by rule: two people sequenced in her order, the president held, the PO inbox skipped, no desk triaged", async () => {
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
    ]);
    expect(spec.contacts.filter((x: any) => x.role === "held").map((x: any) => x.email)).toEqual(["pat.placeholder@acmelearn.example"]);
    expect(spec.skipped.map((x: any) => x.email)).toEqual(["purchaseorders@acmelearn.example"]);
    // Nobody else got the work: no task was opened on any desk for this email.
    expect(await all(`SELECT id FROM tasks WHERE json_extract(input, '$.mail_id') = ?`, r.mailId)).toHaveLength(0);
    expect(r.reply).toMatch(/email 2: https:\/\/boss\.sequoiataylor\.com\/p\/[A-Za-z0-9_-]{16,}/);
    // Emails 3 and 4 are on her card from the start.
    expect(await row(`SELECT 1 AS x FROM judgement_calls WHERE resume_kind = 'outreach_copy' AND json_extract(resume_detail, '$.business_key') = ?`, PARTNERS_KEY)).not.toBeNull();
  });

  it("only a NeverBounce 'valid' address is queued; one person at the company at a time, seven days apart; a reply stops both", async () => {
    const { c } = await campaignFromHer();
    await campaignVerified(env as never, c.id, [
      { email: "dana.fakename@acmelearn.example", result: "valid" },
      { email: "robin.sample@acmelearn.example", result: "valid" },
    ], MON_10AM_CT);
    const ps = await all<any>(`SELECT * FROM outreach_prospects WHERE campaign_id = ? ORDER BY created_at`, c.id);
    expect(ps.map((p) => p.contact_first)).toEqual(["Dana", "Robin"]);
    expect(await all(`SELECT 1 FROM outreach_prospects WHERE email = 'pat.placeholder@acmelearn.example'`)).toHaveLength(0);
    expect((await row<any>(`SELECT state, notice_state FROM outreach_campaigns WHERE id = ?`, c.id))).toEqual({ state: "live", notice_state: "due" });

    const b = businessByKey(PARTNERS_KEY)!;
    expect(await staggerHold(env.DB, b, ps[0], MON_10AM_CT)).toBeNull();
    expect(await staggerHold(env.DB, b, ps[1], MON_10AM_CT)).toMatch(/earlier/);
    await env.DB.prepare(`UPDATE outreach_prospects SET state = 'in_sequence', step = 1 WHERE id = ?`).bind(ps[0].id).run();
    await env.DB.prepare(`INSERT INTO outreach_sends (id, business_key, prospect_id, to_email, step, is_test, status, sent_at) VALUES ('osd_t1', ?, ?, ?, 0, 0, 'sent', ?)`)
      .bind(PARTNERS_KEY, ps[0].id, ps[0].email, MON_10AM_CT).run();
    expect(await staggerHold(env.DB, b, ps[1], MON_10AM_CT + 6 * DAY)).toMatch(/7 days/);
    expect(await staggerHold(env.DB, b, ps[1], MON_10AM_CT + 7 * DAY)).toBeNull();

    // The first email, as built: her words' rules hold, the person's name and the angle are in.
    const m = composeEmail({ business: b, step: 0, to: ps[0].email, org: ps[0].org_name, metro: "", unsubToken: ps[0].unsub_token, postalAddress: "1 Test Street, Testville, TN 00000", contactFirst: "Dana", angle: "brand", pageUrl: "https://example.test/p" });
    expect(m.body).toMatch(/^Hi Dana,/);
    expect(m.body).toContain("Acmelearn");
    expect(outboundProblems(m.body.replace(/Acmelearn/g, ""))).toEqual([]);
    expect(m.raw).not.toMatch(/^Cc:/m);
    // Email 2 carries the one-pager.
    const m2 = composeEmail({ business: b, step: 1, to: ps[0].email, org: ps[0].org_name, metro: "", unsubToken: ps[0].unsub_token, postalAddress: "1 Test Street, Testville, TN 00000", contactFirst: "Dana", angle: "brand", pageUrl: "https://example.test/p", firstSubject: m.subject });
    expect(m2.body).toContain("https://example.test/p");

    // A reply from Dana stops Robin too.
    expect(await stopCompany(env.DB, ps[0], MON_10AM_CT + DAY)).toBe(1);
    expect((await row<any>(`SELECT state FROM outreach_prospects WHERE id = ?`, ps[1].id)).state).toBe("done");
  });

  it("an address NeverBounce does not call valid is never queued, and she is told who and why", async () => {
    const { c } = await campaignFromHer();
    await campaignVerified(env as never, c.id, [
      { email: "dana.fakename@acmelearn.example", result: "catchall" },
      { email: "robin.sample@acmelearn.example", result: "invalid" },
    ], MON_10AM_CT);
    expect(await all(`SELECT 1 FROM outreach_prospects WHERE campaign_id = ?`, c.id)).toHaveLength(0);
    const n = JSON.parse((await row<any>(`SELECT notice FROM outreach_campaigns WHERE id = ?`, c.id)).notice);
    expect(n.happened).toMatch(/did not start/);
    expect(n.details.join("\n")).toMatch(/Dana Fakename: address check said catchall/);
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
    await campaignVerified(env as never, c.id, [{ email: "dana.fakename@acmelearn.example", result: "valid" }, { email: "robin.sample@acmelearn.example", result: "valid" }], MON_10AM_CT + 30 * H + 1);
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
    expect(receipt.details.join("\n")).toMatch(/email 1 goes to Dana Fakename .* Central/);
    expect(receipt.details.join("\n")).toMatch(/What comes back/);
    // The Mac is off: the addresses are checked before the receipt has gone. The receipt is kept.
    await campaignVerified(env as never, c.id, [{ email: "dana.fakename@acmelearn.example", result: "valid" }, { email: "robin.sample@acmelearn.example", result: "valid" }], MON_10AM_CT);
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
    await campaignVerified(env as never, c.id, [
      { email: "dana.fakename@acmelearn.example", result: "valid" },
      { email: "robin.sample@acmelearn.example", result: "valid" },
    ], MON_10AM_CT);
    expect(await all(`SELECT 1 FROM outreach_prospects WHERE campaign_id = ?`, c.id)).toHaveLength(0);
    expect((await row<any>(`SELECT state FROM outreach_campaigns WHERE id = ?`, c.id)).state).toBe("verifying");
    features = "## Live today\n\n- Stories get harder as your child reads.\n";
    const { retryHeldCampaigns } = await import("../../src/worker/boss/outreach/campaign");
    expect(await retryHeldCampaigns(env as never, MON_10AM_CT + 3_600_000)).toBe(2);
  });
});

describe("the next organisation starts only when the live campaign ends", () => {
  it("nothing starts while Acmelearn is live; when it ends, the first org held after it is researched", async () => {
    const { c } = await campaignFromHer();
    await campaignVerified(env as never, c.id, [
      { email: "dana.fakename@acmelearn.example", result: "valid" },
      { email: "robin.sample@acmelearn.example", result: "valid" },
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
    await campaignVerified(env as never, c.id, [{ email: "dana.fakename@acmelearn.example", result: "valid" }, { email: "robin.sample@acmelearn.example", result: "invalid" }], MON_10AM_CT);
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
});
