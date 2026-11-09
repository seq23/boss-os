/**
 * PARTNER CAMPAIGNS, END TO END FROM HER EMAIL (owner, 8 Nov 2026: "if i emailed this to boss@ i need
 * them to take this and do it end 2 end"). The Worker half; the rules are
 * src/shared/boss/outreach/campaign.mjs.
 *
 *   1. HER EMAIL (`campaignFromMail`, called by the intake before the commands and the triage):
 *      "have an agent create a drip campaign to sell a Time2Read partnership to these people: …".
 *      Monique, who runs every outreach business in the catalog, takes it: the business from her
 *      words, the people from her list (every named person; a purchase-order or billing inbox
 *      skipped), the one-pager made. All four emails go automatically. She is answered on her own
 *      thread at once.
 *   2. NEVERBOUNCE ON THE MAC (`macCampaignWork` → simone-commands.mjs → `campaignVerified`): only
 *      "valid" becomes a prospect of the outreach engine; anything else is named back to her.
 *   3. THE ENGINE SENDS (engine.ts): one person at a company at a time, `staggerDays` apart, each in
 *      their own thread, never cc'd (`staggerHold`); any human reply from anyone there stops every
 *      sequence at that company and goes to her (`stopCompany`).
 *   4. THE NEXT ORGANISATION (`advancePartnerOrgs`, on the hourly tick): when the live campaign ends
 *      (a reply, or 14 days after the last email), the next organisation she listed is researched on
 *      the Mac (t2r-groups.mjs: public pages, the page each address was on, NeverBounce) and its
 *      campaign built here by the same builder (`researchFound`). She is told when a new one starts.
 *
 * People's names and addresses live in D1 only (`outreach_campaigns.spec`, `outreach_prospects`).
 */
import type { Env } from "../env";
import { newId } from "../lib/id";
import { logEvent } from "../lib/log";
import { audit } from "../lib/audit";
import { chicagoParts, DAY_MS } from "./brakes";
import { randomToken } from "./lists";
import { isSuppressed } from "./suppression";
import { outboundProblems } from "../../../shared/boss/t2rGroups/rules.mjs";
import { BUSINESSES, businessByKey, partnerBusinesses, type Business, type PartnerPage } from "./catalog";
import {
  brandNamedIn, campaignPlan, capabilitiesFrom, holdOrgsIn, pageProblems, isCampaignAsk, researchedContact, type PlannedContact,
} from "../../../shared/boss/outreach/campaign.mjs";

/** What a person is pitched on, in her words. */
const pitchWords = (angle: string | undefined) =>
  angle === "alliance" ? "a wider alliance" : angle === "distribution" ? "a bundle or a link from their tools" : "co-marketing to their families";

/** The one-pager's public address: `/p/<token>`, mapped by bossMount.ts to the ungated route (routes/outreach.ts). */
export const PAGE_BASE = "https://boss.sequoiataylor.com/p/";
export const pageUrl = (token: string) => `${PAGE_BASE}${encodeURIComponent(token)}`;
/** A campaign with no reply ends this long after its last email. */
export const CAMPAIGN_QUIET_DAYS = 14;

export interface CampaignSpec {
  contacts: Array<PlannedContact & { verdict?: string; prospect_id?: string; source_url?: string }>;
  skipped: Array<{ email: string; why: string }>;
  /** Her message's Message-ID: Monique's later email goes In-Reply-To it. */
  thread: string[];
  subject: string;
  /** The thread's subject: her email's, or "<org> partnership campaign"; later notes say "Re:" it. */
  thread_subject?: string;
  /** What the product does today, read from its capabilities document when the campaign was built. */
  today?: string[];
  today_read_at?: number;
}

/** The product's live features, from its own repo, now. `[]` when unreadable. */
export async function readCapabilities(b: Business, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  if (!b.partner) return [];
  try {
    const r = await fetchImpl(b.partner.page.capabilitiesUrl, { signal: AbortSignal.timeout(10_000), headers: { "user-agent": "boss-os-campaigns" } });
    // A line the one-pager's rule refuses (a figure, a brand, "in 8 languages") is dropped, never served.
    return r.ok ? capabilitiesFrom(await r.text()).filter((t) => !pageProblems(t, outboundProblems).length).slice(0, 24) : [];
  } catch { return []; }
}

export interface CampaignRow {
  id: string; business_key: string; org_name: string; org_domain: string | null; mail_id: string | null;
  source: string; state: string; spec: string; page_token: string; notice: string | null; notice_state: string;
  ended_reason: string | null; ended_at: number | null; created_at: number; updated_at: number;
}

const j = (s: string | null | undefined): any => { try { return JSON.parse(s || "{}") ?? {}; } catch { return {}; } };

/** When a first email queued now actually goes: the next weekday 9–17 Central hour. Plain words. */
export function firstSendWhen(now: number): string {
  for (let h = 0; h < 24 * 8; h++) {
    const at = now + h * 3_600_000;
    const p = chicagoParts(at);
    if (p.weekday >= 1 && p.weekday <= 5 && p.hour >= 9 && p.hour <= 16) {
      if (h === 0) return "within the hour (Central)";
      const d = new Date(at);
      const day = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "long", month: "short", day: "numeric" }).format(d);
      return `${day}, at ${p.hour === 9 ? "9 a.m." : `${p.hour > 12 ? p.hour - 12 : p.hour} ${p.hour >= 12 ? "p.m." : "a.m."}`} Central`;
    }
  }
  return "on the next weekday, from 9 a.m. Central";
}

/**
 * A NOTE MONIQUE OWES HER. One waits at a time: if an earlier one has not gone yet (the Mac is off,
 * a send failed), the new one queues behind it in `spec.pending_notices` and goes after it
 * (`campaignNoticed`). Nothing is overwritten and nothing is lost.
 */
async function owe(env: Env, id: string, notice: Record<string, unknown>, now: number) {
  const body = JSON.stringify({ from: "Monique", ...notice });
  const cur = await env.DB.prepare(`SELECT notice_state, spec FROM outreach_campaigns WHERE id = ?`).bind(id).first<{ notice_state: string; spec: string }>();
  if (cur?.notice_state === "due") {
    const spec = j(cur.spec);
    spec.pending_notices = [...(spec.pending_notices ?? []), body];
    await env.DB.prepare(`UPDATE outreach_campaigns SET spec = ?, updated_at = ? WHERE id = ?`).bind(JSON.stringify(spec), now, id).run();
    return;
  }
  await env.DB.prepare(`UPDATE outreach_campaigns SET notice = ?, notice_state = 'due', updated_at = ? WHERE id = ?`).bind(body, now, id).run();
}

/**
 * THE BUILDER, ONE FOR BOTH DOORS (her email, the research of the next organisation). Records the
 * campaign, makes it the business's active organisation and puts emails 3 and 4 on her card.
 */
export async function buildCampaign(env: Env, input: {
  business: Business; org: string; orgDomain: string | null; contacts: CampaignSpec["contacts"]; skipped: CampaignSpec["skipped"];
  thread: string[]; subject: string; mailId: string | null; source: "owner_email" | "research"; now: number;
}): Promise<CampaignRow> {
  const { business: b, now } = input;
  const id = newId("cmp");
  const today = await readCapabilities(b);
  const threadSubject = input.subject.replace(/^((re|fwd?)\s*:\s*)+/i, "").trim() || `${input.org} partnership campaign`;
  // No email of hers to answer: every note of Monique's on this campaign references one root id, so they thread.
  const thread = input.thread.length ? input.thread : [`<${id}@boss.sequoiataylor.com>`];
  const spec: CampaignSpec = { contacts: input.contacts, skipped: input.skipped, thread, subject: input.subject, thread_subject: threadSubject, today, today_read_at: today.length ? now : undefined };
  await env.DB.prepare(
    `INSERT INTO outreach_campaigns (id, business_key, org_name, org_domain, mail_id, source, state, spec, page_token, created_at, updated_at)
     VALUES (?,?,?,?,?,?,'verifying',?,?,?,?)`,
  ).bind(id, b.key, input.org, input.orgDomain, input.mailId, input.source, JSON.stringify(spec), randomToken(), now, now).run();
  // The organisation is now the business's active one: a row of its own list, or a new one on top.
  const listed = await env.DB.prepare(`SELECT id FROM outreach_partner_orgs WHERE business_key = ? AND lower(org_name) = lower(?)`).bind(b.key, input.org).first<{ id: string }>();
  if (listed) await env.DB.prepare(`UPDATE outreach_partner_orgs SET state = 'active', campaign_id = ?, updated_at = ? WHERE id = ?`).bind(id, now, listed.id).run();
  else {
    const top = await env.DB.prepare(`SELECT MIN(position) AS p FROM outreach_partner_orgs WHERE business_key = ?`).bind(b.key).first<{ p: number | null }>();
    await env.DB.prepare(`INSERT INTO outreach_partner_orgs (id, business_key, org_name, position, state, campaign_id, created_at, updated_at) VALUES (?,?,?,?,'active',?,?,?)`)
      .bind(newId("pog"), b.key, input.org, (top?.p ?? 1) - 1, id, now, now).run();
  }
  await audit(env.DB, { actor: "boss", lane: "ops", entityType: "outreach_campaign", entityId: id, action: "campaign_built", detail: { business_key: b.key, source: input.source, people: input.contacts.length } });
  return (await env.DB.prepare(`SELECT * FROM outreach_campaigns WHERE id = ?`).bind(id).first<CampaignRow>())!;
}

export interface CampaignMailResult { reply: string; outcome: "CAMPAIGN" | "CAMPAIGN_REFUSED" | "ORGS_HELD"; campaignId: string | null }

function sentenceList(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/** Hold organisations for later, in her order, after the one she named (or at the end). */
export async function holdOrgs(env: Env, b: Business, orgs: string[], after: string | null, now: number): Promise<{ added: string[]; already: string[] }> {
  const rows = (await env.DB.prepare(`SELECT id, org_name, position FROM outreach_partner_orgs WHERE business_key = ? ORDER BY position`).bind(b.key).all<{ id: string; org_name: string; position: number }>()).results ?? [];
  const anchor = after ? rows.find((r) => r.org_name.toLowerCase() === after.toLowerCase()) : null;
  let pos = anchor ? anchor.position : (rows.at(-1)?.position ?? 0);
  // Make room after the anchor: everything behind it moves back by the number added.
  const fresh = orgs.filter((o) => !rows.some((r) => r.org_name.toLowerCase() === o.toLowerCase()));
  if (anchor && fresh.length) await env.DB.prepare(`UPDATE outreach_partner_orgs SET position = position + ? WHERE business_key = ? AND position > ?`).bind(fresh.length, b.key, anchor.position).run();
  if (after && !anchor) {
    // The organisation she named first is not on the list yet: it goes first, as done-or-active elsewhere.
    pos = rows.at(-1)?.position ?? 0;
  }
  for (const o of fresh) {
    pos += 1;
    await env.DB.prepare(`INSERT INTO outreach_partner_orgs (id, business_key, org_name, position, state, created_at, updated_at) VALUES (?,?,?,?,'waiting',?,?)`)
      .bind(newId("pog"), b.key, o.slice(0, 120), pos, now, now).run();
  }
  return { added: fresh, already: orgs.filter((o) => !fresh.includes(o)) };
}

/**
 * HER EMAIL, IF IT IS A CAMPAIGN (or "hold these orgs for later"). Null = not one, and the intake
 * goes on exactly as before. Monique signs the reply.
 */
export async function campaignFromMail(env: Env, input: { text: string; subject: string; mailId: string; messageId: string | null; now: number; viaConsole?: boolean }): Promise<CampaignMailResult | null> {
  const text = `${input.subject}\n${input.text}`;
  const partners = partnerBusinesses();
  const brands = BUSINESSES.map((b) => b.brand);
  const hold = holdOrgsIn(input.text) ?? holdOrgsIn(text);
  if (hold && !isCampaignAsk(input.text)) {
    const pick = campaignPlan(text, partners).business;
    const b = pick ? businessByKey(pick.key) : null;
    if (!b) {
      const named = brandNamedIn(text, brands);
      return { reply: `Monique here. I can hold organisations for a partner campaign${named ? `, but ${named} has no partner campaign yet` : ", but your email names no business with one (Time2Read has one)"}, so nothing was held.`, outcome: "CAMPAIGN_REFUSED", campaignId: null };
    }
    const r = await holdOrgs(env, b, hold.orgs, hold.after, input.now);
    const order = ((await env.DB.prepare(`SELECT org_name, state FROM outreach_partner_orgs WHERE business_key = ? AND state IN ('active','waiting','researching') ORDER BY position`).bind(b.key).all<{ org_name: string; state: string }>()).results ?? []);
    return {
      reply: `Monique here. Held for ${b.brand} partnerships, in your order: ${sentenceList(r.added)}.${r.already.length ? ` Already on the list: ${sentenceList(r.already)}.` : ""} ` +
        `Each starts when the one before it ends (a reply, or two weeks after its last email): I'll find the right people's published addresses, check each address, and write to you when each one starts. The order now: ${order.map((o) => o.org_name).join(" → ")}.`,
      outcome: "ORGS_HELD", campaignId: null,
    };
  }
  if (!isCampaignAsk(input.text)) return null;
  const plan = campaignPlan(text, partners);
  if (!plan.business) {
    const named = brandNamedIn(text, brands);
    return { reply: `Monique here. I can't build this campaign yet: ${named ? `${named} has no partner sequence in my outreach list` : "your email doesn't name a business I run partner campaigns for (Time2Read has one)"}. Nothing was sent.`, outcome: "CAMPAIGN_REFUSED", campaignId: null };
  }
  const b = businessByKey(plan.business.key)!;
  if (plan.problems.length || !plan.org) {
    return { reply: `Monique here. I didn't start the ${b.brand} campaign: ${plan.problems.join("; ") || "I couldn't tell which company the people work at"}. Nothing was sent.`, outcome: "CAMPAIGN_REFUSED", campaignId: null };
  }
  const row = await buildCampaign(env, {
    business: b, org: plan.org, orgDomain: plan.orgDomain, contacts: plan.contacts, skipped: plan.skipped,
    // Her own email is the thread's root; typed in from her session, Monique's receipt starts it.
    thread: input.messageId && !input.viaConsole ? [input.messageId] : [], subject: input.subject, mailId: input.mailId, source: "owner_email", now: input.now,
  });
  const receipt = receiptFor(b, plan.org, plan.contacts, plan.skipped, row, input.now);
  // Typed in from her own session (the console door), there is no email of hers to answer: the same
  // receipt goes to her as Monique's own email, the first of the thread the done reply joins.
  if (input.viaConsole) await owe(env, row.id, { subject: (j(row.spec) as CampaignSpec).thread_subject, happened: receipt.happened, details: receipt.details, thread: (j(row.spec) as CampaignSpec).thread }, input.now);
  return { reply: [`Monique here. ${receipt.happened}`, ...receipt.details.map((d) => `- ${d}`)].join("\n"), outcome: "CAMPAIGN", campaignId: row.id };
}

/**
 * THE RECEIPT (owner, 8 Nov 2026): who has it, the steps, when email 1 goes (Central), and what
 * comes back to her and when. The intake's reply to her email, or Monique's own first email.
 */
export function receiptFor(b: Business, org: string, contacts: PlannedContact[], skipped: Array<{ email: string; why: string }>, row: CampaignRow, now: number) {
  const send = contacts.filter((c) => c.role === "send");
  const first = send[0];
  return {
    happened: `I have your ${b.brand} partnership campaign for ${org}.`,
    details: [
      `Now: I check ${send.length === 1 ? "the address" : `the ${send.length} addresses`} first. Only a valid one is written to, and nothing is guessed.`,
      ...(first ? [`Then: email 1 goes to ${first.name} (${first.title || "no title given"}) ${firstSendWhen(now)}, from ${b.sender}, pitched on ${pitchWords(first.angle)}.`] : []),
      ...send.slice(1).map((c, i) => `${c.name} (${c.title || "no title given"}) starts ${(i + 1) * b.partner!.staggerDays} days after ${first!.name}'s first email, in a separate thread, pitched on ${pitchWords(c.angle)}.`),
      `Each person gets up to four emails (day 0, 3, 7 and 14 from their first), all automatic.`,
      ...skipped.map((s) => `${s.email}: skipped, ${s.why}.`),
      `The one-pager they get with email 2: ${pageUrl(row.page_token)}`,
      `What comes back: a reply on this thread once the addresses are checked (within about 10 minutes while your Mac is on), saying who was queued. Any reply from anyone at ${org} stops every email there and comes to you as a card.`,
    ],
  };
}

/** What the Mac checks with NeverBounce: every campaign still verifying, its people to write to. */
export async function macCampaignWork(env: Env) {
  const verifying = (await env.DB.prepare(`SELECT id, spec FROM outreach_campaigns WHERE state = 'verifying' ORDER BY created_at LIMIT 10`).all<{ id: string; spec: string }>()).results ?? [];
  const notices = (await env.DB.prepare(`SELECT id, notice FROM outreach_campaigns WHERE notice_state = 'due' ORDER BY updated_at LIMIT 10`).all<{ id: string; notice: string }>()).results ?? [];
  return {
    campaigns: verifying.map((r) => ({ id: r.id, emails: (j(r.spec).contacts ?? []).filter((c: any) => c.role === "send" && !c.verdict).map((c: any) => c.email) })),
    campaign_notices: notices.map((r) => ({ id: r.id, notice: j(r.notice) })),
  };
}

/**
 * NEVERBOUNCE'S WORD. "valid" becomes a prospect; anything else is named to her, never retried with a
 * guess. The first email's time and every result go to her on her own thread.
 */
export async function campaignVerified(env: Env, id: string, verdicts: Array<{ email: string; result: string }>, now: number): Promise<{ queued: number }> {
  const row = await env.DB.prepare(`SELECT * FROM outreach_campaigns WHERE id = ?`).bind(id).first<CampaignRow>();
  if (!row || row.state !== "verifying") return { queued: 0 };
  const b = businessByKey(row.business_key);
  if (!b?.partner) return { queued: 0 };
  const spec = j(row.spec) as CampaignSpec;
  const by = new Map(verdicts.map((v) => [String(v.email).toLowerCase(), String(v.result)]));
  let queued = 0;
  if (!spec.today?.length) {
    const today = await readCapabilities(b);
    if (today.length) { spec.today = today; spec.today_read_at = now; }
  }
  const mayQueue = Boolean(spec.today?.length);
  for (const c of spec.contacts) {
    if (c.role !== "send") continue;
    const v = by.get(c.email) ?? c.verdict;
    if (!v) continue;
    c.verdict = v;
    if (v !== "valid" || c.prospect_id || !mayQueue) continue;
    if (await isSuppressed(env.DB, c.email)) { c.verdict = "on the do-not-contact list"; continue; }
    const pid = newId("opr");
    const ins = await env.DB.prepare(
      `INSERT INTO outreach_prospects (id, business_key, email, email_domain, org_name, segment, metro, website, source, source_url,
         mx_verified_at, state, step, unsub_token, created_at, updated_at, contact_first, contact_title, angle, campaign_id, page_token)
       VALUES (?,?,?,?,?,'partner','',NULL,?,?,?,'new',0,?,?,?,?,?,?,?,?) ON CONFLICT(business_key, email) DO NOTHING`,
    ).bind(pid, b.key, c.email, c.email.split("@")[1], row.org_name, row.source, c.source_url ?? "her email", now, randomToken(),
      now + (c.order ?? 0), now, c.first, c.title, c.angle, row.id, row.page_token).run();
    if ((ins.meta.changes ?? 0) > 0) { c.prospect_id = pid; queued += 1; }
    else c.verdict = "already written to by this business";
  }
  const pending = spec.contacts.some((c) => c.role === "send" && !c.verdict);
  // Nothing is queued without the product's live features (the one-pager's "today"). The verdicts
  // are kept; the hourly tick reads the features again (retryHeldCampaigns).
  if (pending || !mayQueue) {
    await env.DB.prepare(`UPDATE outreach_campaigns SET spec = ?, updated_at = ? WHERE id = ?`).bind(JSON.stringify(spec), now, id).run();
    return { queued };
  }
  const live = spec.contacts.filter((c) => c.prospect_id);
  await env.DB.prepare(`UPDATE outreach_campaigns SET spec = ?, state = ?, ended_reason = ?, ended_at = ?, updated_at = ? WHERE id = ?`)
    .bind(JSON.stringify(spec), live.length ? "live" : "ended", live.length ? null : "no address passed the address check", live.length ? null : now, now, id).run();
  // In send order, then the skipped (owner, 8 Nov 2026).
  const ordered = [...spec.contacts.filter((c) => c.role === "send").sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), ...spec.contacts.filter((c) => c.role !== "send")];
  const detail = ordered.map((c) => c.prospect_id ? `${c.name}: address checked, valid, queued.` : `${c.name}: address check said ${c.verdict}, so not emailed.`);
  const first = live[0];
  const happened = first
    ? `The ${b.brand} campaign for ${row.org_name} is queued: email 1 to ${first.name} goes ${firstSendWhen(now)}, from ${b.sender}.${live.slice(1).map((c, i) => ` ${c.name}'s first email goes ${(i + 1) * b.partner!.staggerDays} days after ${first.name}'s, in a separate thread.`).join("")} Up to four emails each, all automatic; any reply stops them all.`
    : `The ${b.brand} campaign for ${row.org_name} did not start: no address passed the address check, so nobody was emailed and no address was guessed.`;
  await owe(env, id, {
    subject: `Re: ${spec.thread_subject ?? `${row.org_name} partnership campaign`}`,
    happened,
    details: [...detail, ...spec.skipped.map((s) => `${s.email}: skipped, ${s.why}.`), `The one-pager: ${pageUrl(row.page_token)}`,
      ...(b.partner.page.bonus && !(await refreshBonusProbe(env, b, now, { force: true })) ? ["HeyGetOnMyLevel is left off the one-pager for now: its level check is not working, and the line comes back on its own once it does."] : [])],
    thread: spec.thread,
  }, now);
  await logEvent(env.DB, { level: "info", scope: "outreach", event: "campaign_verified", entityId: id, detail: { queued, live: live.length } }).catch(() => {});
  return { queued };
}

/** The note went. The next one waiting behind it, if any, is now due. */
export async function campaignNoticed(env: Env, id: string): Promise<void> {
  const cur = await env.DB.prepare(`SELECT spec FROM outreach_campaigns WHERE id = ?`).bind(id).first<{ spec: string }>();
  const spec = j(cur?.spec);
  const next = (spec.pending_notices ?? []).shift();
  if (next) {
    await env.DB.prepare(`UPDATE outreach_campaigns SET notice = ?, notice_state = 'due', spec = ?, updated_at = ? WHERE id = ?`).bind(next, JSON.stringify(spec), Date.now(), id).run();
    return;
  }
  await env.DB.prepare(`UPDATE outreach_campaigns SET notice_state = 'sent' WHERE id = ?`).bind(id).run();
}

// ─── The engine's half ─────────────────────────────────────────────────────

/**
 * ONE PERSON AT A COMPANY AT A TIME. A first email waits while someone earlier in the same campaign
 * has not had theirs, and until `staggerDays` after the latest first email there. Null = it may go.
 */
export async function staggerHold(db: D1Database, b: Business, p: any, now: number): Promise<string | null> {
  if (!b.partner || !p.campaign_id || Number(p.step) !== 0) return null;
  const earlier = await db.prepare(
    `SELECT 1 FROM outreach_prospects WHERE campaign_id = ? AND id != ? AND state = 'new' AND step = 0 AND created_at < ? LIMIT 1`,
  ).bind(p.campaign_id, p.id, p.created_at).first();
  if (earlier) return "someone earlier at this company has not had their first email yet";
  const last = await db.prepare(
    `SELECT MAX(s.sent_at) AS at FROM outreach_sends s JOIN outreach_prospects o ON o.id = s.prospect_id
      WHERE o.campaign_id = ? AND s.step = 0 AND s.is_test = 0 AND s.status != 'failed'`,
  ).bind(p.campaign_id).first<{ at: number | null }>();
  if (last?.at && now < last.at + b.partner.staggerDays * DAY_MS) return `the next person at this company starts ${b.partner.staggerDays} days after the last first email`;
  return null;
}

/** ANY HUMAN REPLY FROM ANYONE AT THE COMPANY STOPS EVERY SEQUENCE THERE. Returns how many stopped. */
export async function stopCompany(db: D1Database, p: any, now: number): Promise<number> {
  if (!p?.campaign_id) return 0;
  const r = await db.prepare(
    `UPDATE outreach_prospects SET state = 'done', next_due_at = NULL, updated_at = ? WHERE campaign_id = ? AND id != ? AND state IN ('new','in_sequence')`,
  ).bind(now, p.campaign_id, p.id).run();
  await db.prepare(`UPDATE outreach_campaigns SET state = 'ended', ended_reason = COALESCE(ended_reason, 'a reply came in'), ended_at = COALESCE(ended_at, ?), updated_at = ? WHERE id = ? AND state != 'ended'`)
    .bind(now, now, p.campaign_id).run();
  return r.meta.changes ?? 0;
}

// ─── The next organisation ─────────────────────────────────────────────────

/**
 * ON THE HOURLY TICK. A live campaign with nobody left in a sequence ends 14 days after its last
 * email; an ended campaign closes its organisation; and a business with no organisation active or
 * being researched starts the next one waiting (the Mac researches it). Nothing starts while one is live.
 */
export async function advancePartnerOrgs(env: Env, now: number): Promise<{ ended: number; started: string[] }> {
  const db = env.DB;
  let ended = 0;
  const live = (await db.prepare(`SELECT id FROM outreach_campaigns WHERE state = 'live'`).all<{ id: string }>()).results ?? [];
  for (const c of live) {
    const open = await db.prepare(`SELECT COUNT(*) AS n FROM outreach_prospects WHERE campaign_id = ? AND state IN ('new','in_sequence')`).bind(c.id).first<{ n: number }>();
    if ((open?.n ?? 0) > 0) continue;
    const replied = await db.prepare(`SELECT 1 FROM outreach_prospects WHERE campaign_id = ? AND state = 'replied' LIMIT 1`).bind(c.id).first();
    const last = await db.prepare(`SELECT MAX(s.sent_at) AS at FROM outreach_sends s JOIN outreach_prospects o ON o.id = s.prospect_id WHERE o.campaign_id = ? AND s.is_test = 0`).bind(c.id).first<{ at: number | null }>();
    if (!replied && last?.at && now < last.at + CAMPAIGN_QUIET_DAYS * DAY_MS) continue;
    await db.prepare(`UPDATE outreach_campaigns SET state = 'ended', ended_reason = ?, ended_at = ?, updated_at = ? WHERE id = ?`)
      .bind(replied ? "a reply came in" : `no reply ${CAMPAIGN_QUIET_DAYS} days after the last email`, now, now, c.id).run();
    ended += 1;
  }
  await db.prepare(
    `UPDATE outreach_partner_orgs SET state = 'done', updated_at = ? WHERE state = 'active' AND campaign_id IN (SELECT id FROM outreach_campaigns WHERE state = 'ended')`,
  ).bind(now).run();
  const started: string[] = [];
  for (const b of BUSINESSES.filter((x) => x.partner)) {
    const busy = await db.prepare(
      `SELECT 1 FROM outreach_partner_orgs WHERE business_key = ? AND state IN ('active','researching') LIMIT 1`,
    ).bind(b.key).first();
    const running = await db.prepare(`SELECT 1 FROM outreach_campaigns WHERE business_key = ? AND state IN ('verifying','live') LIMIT 1`).bind(b.key).first();
    if (busy || running) continue;
    const next = await db.prepare(`SELECT id, org_name FROM outreach_partner_orgs WHERE business_key = ? AND state = 'waiting' ORDER BY position LIMIT 1`).bind(b.key).first<{ id: string; org_name: string }>();
    if (!next) continue;
    await db.prepare(`UPDATE outreach_partner_orgs SET state = 'researching', updated_at = ? WHERE id = ?`).bind(now, next.id).run();
    started.push(`${b.key}:${next.org_name}`);
    await logEvent(db, { level: "info", scope: "outreach", event: "partner_org_research", entityId: next.id, detail: { business_key: b.key } }).catch(() => {});
  }
  return { ended, started };
}

/** Campaigns whose every address is checked but whose features list was unreadable: read it again. */
export async function retryHeldCampaigns(env: Env, now: number): Promise<number> {
  const rows = (await env.DB.prepare(`SELECT id, spec FROM outreach_campaigns WHERE state = 'verifying' ORDER BY created_at LIMIT 5`).all<{ id: string; spec: string }>()).results ?? [];
  let n = 0;
  for (const r of rows) {
    const spec = j(r.spec) as CampaignSpec;
    if ((spec.contacts ?? []).some((c) => c.role === "send" && !c.verdict)) continue;
    const before = await campaignVerified(env, r.id, [], now);
    n += before.queued;
  }
  return n;
}

/** What the Mac researches: organisations in state 'researching', with the brand they are for. */
export async function researchDue(env: Env) {
  const rows = (await env.DB.prepare(`SELECT id, business_key, org_name FROM outreach_partner_orgs WHERE state = 'researching' ORDER BY updated_at LIMIT 3`).all<{ id: string; business_key: string; org_name: string }>()).results ?? [];
  return rows.map((r) => ({ id: r.id, business_key: r.business_key, org: r.org_name, brand: businessByKey(r.business_key)?.brand ?? r.business_key }));
}

/**
 * THE RESEARCH CAME BACK: people with published addresses, the page each was on, NeverBounce's word.
 * The same builder makes the campaign; nobody found = the organisation is skipped, named to her, and
 * the next one starts on the next tick.
 */
export async function researchFound(env: Env, orgId: string, found: Array<{ name: string; title?: string; email: string; source_url: string; verdict: string }>, now: number): Promise<{ campaignId: string | null; queued: number; skipped?: string }> {
  const org = await env.DB.prepare(`SELECT * FROM outreach_partner_orgs WHERE id = ? AND state = 'researching'`).bind(orgId).first<any>();
  if (!org) return { campaignId: null, queued: 0 };
  const b = businessByKey(org.business_key);
  if (!b?.partner) return { campaignId: null, queued: 0 };
  const people: CampaignSpec["contacts"] = [];
  const domains = new Set<string>();
  for (const f of found ?? []) {
    const c = researchedContact(f);
    if (!c || !/^https:\/\//.test(String(f.source_url ?? ""))) continue;
    if (people.some((x) => x.email === c.email)) continue;
    domains.add(c.email.split("@")[1]!);
    people.push({ ...c, order: c.role === "send" ? people.filter((x) => x.role === "send").length : undefined, source_url: String(f.source_url) });
  }
  const verdicts = (found ?? []).map((f) => ({ email: String(f.email).toLowerCase(), result: String(f.verdict) }));
  if (!people.some((c) => c.role === "send" && verdicts.find((v) => v.email === c.email)?.result === "valid")) {
    const why = people.length ? "no published address there passed the address check" : "no published address of a partnerships, business development or marketing lead was found on a public page";
    await env.DB.prepare(`UPDATE outreach_partner_orgs SET state = 'skipped', note = ?, updated_at = ? WHERE id = ?`).bind(why, now, orgId).run();
    // She is told on the next campaign's notice; this one is a line in the log and the org's note.
    await logEvent(env.DB, { level: "warn", scope: "outreach", event: "partner_org_skipped", entityId: orgId, detail: { why } }).catch(() => {});
    return { campaignId: null, queued: 0, skipped: why };
  }
  const row = await buildCampaign(env, {
    business: b, org: org.org_name, orgDomain: domains.size === 1 ? [...domains][0]! : null, contacts: people, skipped: [],
    thread: [], subject: "", mailId: null, source: "research", now,
  });
  const skippedBefore = (await env.DB.prepare(`SELECT org_name, note FROM outreach_partner_orgs WHERE business_key = ? AND state = 'skipped' AND updated_at >= ?`).bind(b.key, now - 30 * DAY_MS).all<{ org_name: string; note: string }>()).results ?? [];
  const r = await campaignVerified(env, row.id, verdicts, now);
  // The notice says a NEW organisation started, and why any before it were passed over.
  const n = await env.DB.prepare(`SELECT notice FROM outreach_campaigns WHERE id = ?`).bind(row.id).first<{ notice: string }>();
  const notice = j(n?.notice);
  notice.subject = `Next ${b.brand} partner: ${org.org_name} has started`;
  notice.details = [
    ...(notice.details ?? []),
    ...people.filter((c) => c.source_url).map((c) => `${c.name}'s address was published at ${c.source_url}`),
    ...skippedBefore.map((s) => `${s.org_name} was passed over: ${s.note}.`),
  ];
  // The note campaignVerified just owed, reworded in place (never owed twice).
  await env.DB.prepare(`UPDATE outreach_campaigns SET notice = ?, updated_at = ? WHERE id = ?`).bind(JSON.stringify(notice), now, row.id).run();
  return { campaignId: row.id, queued: r.queued };
}

// ─── The live probe behind a bonus line ────────────────────────────────────

/**
 * HEYGETONMYLEVEL'S LEVEL CHECK, PROBED THE WAY ITS OWN SITE CALLS IT (owner, 8 Nov 2026: name it only
 * while it works). The site's bundle names its backend and public key; the probe asks for one
 * passage, exactly as "Start Reading" does, and passes only on a passage with words in it. Never
 * cached: every render asks again. Any failure = false, and the line is left out.
 */
export async function hgomlLevelCheckLive(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const site = "https://heygetonmylevel.com";
    const home = await (await fetchImpl(`${site}/`, { signal: AbortSignal.timeout(8000) })).text();
    const bundle = /src="(\/assets\/index-[^"]+\.js)"/.exec(home)?.[1];
    if (!bundle) return false;
    const js = await (await fetchImpl(`${site}${bundle}`, { signal: AbortSignal.timeout(8000) })).text();
    const base = /https:\/\/[a-z0-9]+\.supabase\.co/.exec(js)?.[0];
    const key = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.exec(js)?.[0];
    if (!base || !key) return false;
    const r = await fetchImpl(`${base}/functions/v1/generate-reading`, {
      method: "POST", signal: AbortSignal.timeout(60_000),
      headers: { "content-type": "application/json", apikey: key, authorization: `Bearer ${key}` },
      body: JSON.stringify({ type: "passage", gradeLevel: 3, language: "en", cache: true }),
    });
    if (!r.ok) return false;
    const j = await r.json<any>().catch(() => null);
    return typeof j?.text === "string" && j.text.trim().split(/\s+/).length >= 20;
  } catch { return false; }
}

/** A fresh probe of a page's bonus line, now. */
export async function bonusLive(b: Business, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const bonus = b.partner?.page.bonus;
  if (!bonus) return false;
  return bonus.probe === "hgoml_level_check" ? hgomlLevelCheckLive(fetchImpl) : false;
}

/** Re-probe at most this often from page views (owner, 8 Nov 2026: never burn the sister tool's daily cap). */
export const PROBE_REFRESH_MS = 3_600_000;
/** A probe result older than this is no result: the line stays out. */
export const PROBE_STALE_MS = 24 * 3_600_000;
const probeKey = (b: Business) => `probe:${b.partner?.page.bonus?.probe ?? "none"}`;

/** The last probe result, kept in outreach_settings: `{ ok, at, tried_at }`. */
async function lastProbe(env: Env, b: Business): Promise<{ ok: boolean; at: number; tried_at: number } | null> {
  const r = await env.DB.prepare(`SELECT value FROM outreach_settings WHERE key = ?`).bind(probeKey(b)).first<{ value: string }>();
  return r ? j(r.value) : null;
}

/**
 * RUN THE PROBE AND KEEP ITS ANSWER. From a page view (`force` false) at most once an hour, claimed
 * before it runs so two views never both call; before an email that links the page, always.
 */
export async function refreshBonusProbe(env: Env, b: Business, now: number, { force = false, fetchImpl = fetch }: { force?: boolean; fetchImpl?: typeof fetch } = {}): Promise<boolean | null> {
  if (!b.partner?.page.bonus) return null;
  const last = await lastProbe(env, b);
  if (!force && last && now - Number(last.tried_at ?? 0) < PROBE_REFRESH_MS) return null;
  const claim = JSON.stringify({ ok: last?.ok ?? false, at: last?.at ?? 0, tried_at: now });
  await env.DB.prepare(`INSERT INTO outreach_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, 'probe') ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(probeKey(b), claim, now).run();
  const ok = await bonusLive(b, fetchImpl);
  await env.DB.prepare(`UPDATE outreach_settings SET value = ?, updated_at = ? WHERE key = ?`).bind(JSON.stringify({ ok, at: now, tried_at: now }), now, probeKey(b)).run();
  return ok;
}

/** Whether the bonus line shows on a render: the last probe passed, within 24 hours. No call is made. */
export async function bonusShown(env: Env, b: Business, now: number): Promise<boolean> {
  const last = await lastProbe(env, b);
  return Boolean(last?.ok && now - Number(last.at) < PROBE_STALE_MS);
}

// ─── The one-pager ─────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The one-pager, from the catalog's words with the organisation's name in. Pure. */
export function onePagerHtml(b: Business, org: string, today: string[], withBonus = false): string {
  const page = b.partner!.page as PartnerPage;
  const f = (s: string) => esc(s.replace(/\{org\}/g, org));
  const models = page.models.map((m, i) => `
    <section class="model"><div class="mh"><span class="n">${i + 1}</span><h3>${f(m.name)}</h3></div><p>${f(m.how)}</p>
      <div class="two"><div><h4>${f(org)} brings</h4><p>${f(m.theyBring)}</p></div><div><h4>${esc(b.brand)} brings</h4><p>${f(m.weBring)}</p></div></div>
      ${m.status ? `<p class="status">${f(m.status)}</p>` : ""}</section>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${f(page.title)}</title>
<style>
:root{--bg:#f7fbfc;--surface:#ffffff;--band:#ffffff;--ink:#17323f;--muted:#4f6873;--line:#d8e9ee;--head:#13628a;--teal:#1d8fb3;--gold:#f7ae00;--gold-soft:#fff3cf;--red:#e2382f;--on-head:#ffffff;color-scheme:light}
@media (prefers-color-scheme: dark){:root{--bg:#0f1d24;--surface:#16303b;--band:#ffffff;--ink:#e8f3f6;--muted:#a3bcc5;--line:#24434f;--head:#7fd3ea;--teal:#5cc6e2;--gold:#f7ae00;--gold-soft:#3a3115;--red:#ff6a5f;--on-head:#0f1d24;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.band{background:var(--band);border-bottom:4px solid var(--gold)}.band .in{max-width:760px;margin:0 auto;padding:18px 16px 14px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.band img{height:72px;width:auto;max-width:100%}.band .tag{color:#13628a;font-weight:600}.band .tag b{color:#e2382f}
main{max-width:760px;margin:0 auto;padding:28px 16px 48px;display:flex;flex-direction:column;gap:26px}
h1{color:var(--head);font-size:30px;line-height:1.2;margin:0 0 8px;text-wrap:balance}
h2{color:var(--head);font-size:21px;margin:0 0 10px}h3{margin:0 0 6px;color:var(--head)}
h4{margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
p{margin:0}ul{margin:0;padding-left:20px}li{margin:5px 0}.lede{color:var(--muted)}
.diff{display:grid;gap:12px;margin-top:12px}.row{display:grid;grid-template-columns:1fr 1fr;gap:16px;border-top:1px solid var(--line);padding-top:12px}.row>div{min-width:0}.row>div:last-child p{font-weight:600}
.model{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:18px;margin:12px 0;display:grid;gap:10px}
.mh{display:flex;gap:12px;align-items:center}.n{flex:none;width:30px;height:30px;border-radius:50%;background:var(--gold);color:#13324a;font-weight:700;text-align:center;line-height:30px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}.two>div{min-width:0}@media(max-width:560px){.two,.row{grid-template-columns:1fr}}
.status{font-size:14px;color:var(--muted);border-left:3px solid var(--teal);padding-left:10px}
.bonus{margin-top:12px;border-left:3px solid var(--gold);padding-left:12px;font-weight:600}
.offer{background:var(--gold-soft);border-radius:14px;padding:16px 18px}
.next{background:var(--head);color:var(--on-head);border-radius:14px;padding:16px 18px}.fine{color:var(--muted);font-size:13px}
a{color:var(--teal)}
</style></head><body>
${page.logo ? `<div class="band"><div class="in"><img src="${page.logo}" alt="${esc(b.brand)}"><span class="tag">${f(page.tagline ?? "")}</span></div></div>` : ""}
<main>
<header><h1>${f(page.title)}</h1><p class="lede">${f(page.intro)}</p></header>
<section><h2>How ${esc(b.brand)} is different</h2><p class="lede">${f(page.different.intro)}</p>
<div class="diff">${page.different.rows.map((r) => `<div class="row"><div><h4>The usual reading app</h4><p>${f(r.usual)}</p></div><div><h4>${esc(b.brand)}</h4><p>${f(r.ours)}</p></div></div>`).join("")}</div></section>
<section><h2>${esc(b.brand)} today</h2><ul>${today.map((t) => `<li>${f(t)}</li>`).join("")}</ul>${withBonus && page.bonus ? `<p class="bonus">${f(page.bonus.text)}</p>` : ""}</section>
<section><h2>Three ways to work together</h2>${models}</section>
<section class="offer"><h2>What partners get</h2><ul>${page.offer.map((t) => `<li>${f(t)}</li>`).join("")}</ul></section>
<section><h2>Children's privacy</h2><ul>${page.privacy.map((t) => `<li>${f(t)}</li>`).join("")}</ul></section>
<div class="next">${f(page.next)}</div>
<p class="fine">${f(page.notAffiliated)} · <a href="${esc(b.offerUrl)}">${esc(b.domain)}</a> · ${esc(b.sender)}</p>
</main></body></html>`;
}

/** The page behind a token, or null (an unknown token gets a plain not-found). */
export async function onePagerFor(env: Env, token: string, background?: (p: Promise<unknown>) => void, now = Date.now()): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT business_key, org_name, spec FROM outreach_campaigns WHERE page_token = ?`).bind(token).first<{ business_key: string; org_name: string; spec: string }>();
  const b = row ? businessByKey(row.business_key) : null;
  const today: string[] = j(row?.spec).today ?? [];
  if (!(b?.partner && row && today.length)) return null;
  // Rendered at once from the last probe; the probe refreshes behind the page, at most hourly.
  const html = onePagerHtml(b, row.org_name, today, await bonusShown(env, b, now));
  const refresh = refreshBonusProbe(env, b, now).catch(() => null);
  if (background) background(refresh); else await refresh;
  // The page's own rule (pageProblems): a page that breaks it is never served.
  const bad = pageProblems(html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").split(row.org_name).join(""), outboundProblems);
  if (bad.length) {
    await logEvent(env.DB, { level: "error", scope: "outreach", event: "one_pager_refused", entityId: token.slice(0, 6), detail: { bad } }).catch(() => {});
    return null;
  }
  return html;
}
