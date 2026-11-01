import { createExecutionContext, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../../src/worker/boss/index";
import { apiJson, row } from "./helpers";
import { DAY_MS } from "../../src/worker/boss/outreach/brakes";
import { BUSINESSES, OUTREACH_MAILBOX, businessByKey } from "../../src/worker/boss/outreach/catalog";
import { runOutreachTick } from "../../src/worker/boss/outreach/engine";
import { feedScoreboard, groupSendGate, queueReady, summary } from "../../src/worker/boss/outreach/groups";
import { outboundProblems } from "../../src/shared/boss/t2rGroups/rules.mjs";
import { numbersRows } from "../../src/shared/boss/brains/brain.mjs";

/**
 * MONIQUE'S TIME-2-READ GROUPS & INSTITUTIONS (owner, 31 Oct 2026), end to end through the real
 * Worker: the desk, the gates and the hourly outreach tick. Synthetic groups only (*.example).
 * The guards she asked for, each a named test: no tier-3 send while it is off, no price in anything
 * sent, one follow-up at most, NeverBounce before the first email.
 */

const TUESDAY_10AM = Date.UTC(2026, 9, 13, 15, 0, 0); // 10:00 Chicago
const HOUR = 3_600_000;
const G = "time2read_groups";

async function fakeServiceAccount(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  );
  const der = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(der))).replace(/(.{64})/g, "$1\n");
  return JSON.stringify({ client_email: "gsc-bot@test.iam.gserviceaccount.com", private_key: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n` });
}
let SA: string;

interface Inbound { id: string; threadId: string; from: string; subject: string; body: string }
const GOOD_DKIM = `v=DKIM1; k=rsa; p=${"MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA".repeat(4)}`;

function fakeGmail(inbound: Inbound[] = []) {
  const sends: { from: string; to: string; raw: string; text: string }[] = [];
  let n = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://oauth2.googleapis.com/token")) return Response.json({ access_token: "ya29.fake" });
    if (url.startsWith("https://cloudflare-dns.com/dns-query")) {
      const name = decodeURIComponent(/name=([^&]+)/.exec(url)?.[1] ?? "");
      const data = name.startsWith("google._domainkey.") ? [GOOD_DKIM] : name.startsWith("_dmarc.") ? ["v=DMARC1; p=none;"] : ["v=spf1 include:_spf.google.com ~all"];
      return Response.json({ Status: 0, Answer: data.map((d) => ({ name, type: 16, data: `"${d}"` })) });
    }
    if (url.endsWith("/messages/send")) {
      const body = JSON.parse(String(init?.body));
      const raw = atob(body.raw.replace(/-/g, "+").replace(/_/g, "/"));
      const part = /Content-Type: text\/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/.exec(raw)?.[1] ?? "";
      const text = decodeURIComponent(escape(atob(part.replace(/\r\n/g, ""))));
      sends.push({ from: /^From: .*<([^>]+)>/m.exec(raw)?.[1] ?? "", to: /^To: (.+)$/m.exec(raw)?.[1]?.trim() ?? "", raw, text });
      n += 1;
      return Response.json({ id: `m${n}`, threadId: body.threadId ?? `t${n}` });
    }
    if (url.includes("/settings/sendAs")) return Response.json({ sendAs: [{ sendAsEmail: OUTREACH_MAILBOX, isPrimary: true }] });
    if (url.includes("format=metadata")) {
      const id = /messages\/([^?]+)/.exec(url)?.[1] ?? "";
      const sent = sends[Number(id.slice(1)) - 1];
      const name = /metadataHeaders=([^&]+)/.exec(url)?.[1];
      return Response.json({ id, payload: { headers: name === "From" ? [{ name: "From", value: `X <${sent?.from}>` }] : [{ name: "Message-ID", value: `<${id}@mail.gmail.com>` }] } });
    }
    if (url.includes("/messages?")) {
      const q = decodeURIComponent(/q=([^&]+)/.exec(url)?.[1] ?? "");
      return Response.json({ messages: q.includes("mailer-daemon") ? [] : inbound.map((m) => ({ id: m.id, threadId: m.threadId })) });
    }
    if (url.includes("format=full")) {
      const id = /messages\/([^?]+)/.exec(url)?.[1] ?? "";
      const m = inbound.find((x) => x.id === id)!;
      const data = btoa(unescape(encodeURIComponent(m.body))).replace(/\+/g, "-").replace(/\//g, "_");
      return Response.json({ id: m.id, threadId: m.threadId, internalDate: String(TUESDAY_10AM), payload: { mimeType: "text/plain", headers: [{ name: "From", value: m.from }, { name: "Subject", value: m.subject }], body: { data } } });
    }
    return Response.json({ elements: [] });
  }) as typeof fetch;
  return { fetchImpl, sends };
}

const tickEnv = () => ({ ...env, GSC_SERVICE_ACCOUNT_JSON: SA }) as any;
const post = (body: unknown) => apiJson("/api/t2r-groups", { method: "POST", body });
const group = (i: number, over: Record<string, unknown> = {}) => ({
  org_name: `Maple Grove Homeschool Co-op ${i}`, kind: "homeschool co-op", email: `info@maplegrove${i}.example`,
  region: "Austin, TX", source_url: `https://maplegrove${i}.example/contact`, ...over,
});

beforeEach(async () => {
  SA ??= await fakeServiceAccount();
  for (const t of ["outreach_prospects", "outreach_suppression", "outreach_sends", "outreach_replies", "outreach_domain_state", "t2r_groups"]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.prepare(`UPDATE t2r_group_tiers SET enabled = CASE WHEN tier = 3 THEN 0 ELSE 1 END`).run();
  await env.DB.prepare(`UPDATE outreach_settings SET value = 'off' WHERE key = 'kill_switch'`).run();
  await env.DB.prepare(`UPDATE outreach_settings SET value = 'live' WHERE key = 'sending'`).run();
  // Every other business has a full queue (done), so the tick builds no lists and sends only groups.
  for (const b of BUSINESSES) {
    await env.DB.prepare(
      `INSERT INTO outreach_domain_state (business_key, route_state, route_sender, postal_address, ramp_started_at, updated_at) VALUES (?, 'ready', ?, '100 Main St, Suite 1, Houston, TX 77002', ?, ?)`,
    ).bind(b.key, b.sender, TUESDAY_10AM - 60 * DAY_MS, TUESDAY_10AM).run();
    for (let i = 0; i < 50; i++) {
      await env.DB.prepare(
        `INSERT INTO outreach_prospects (id, business_key, email, email_domain, segment, source, source_url, mx_verified_at, state, step, unsub_token, created_at, updated_at)
         VALUES (?,?,?,?,'x','filler','https://filler.example',0,'new',0,?,0,0)`,
      ).bind(`f_${b.key}_${i}`, b.key, `filler${i}@${b.key}.example.org`, `${b.key}.example.org`, `tok_f_${b.key}_${i}`).run();
    }
  }
  // Fillers wait, but only the group business is under test: park the others' queues.
  await env.DB.prepare(`UPDATE outreach_prospects SET state = 'done' WHERE source = 'filler'`).run();
});

/** Import → NeverBounce → code → queue, through the desk, as the Mac job does it. */
async function ready(i: number, over: Record<string, unknown> = {}) {
  const g = group(i, over);
  await post({ op: "import", rows: [g] });
  await post({ op: "verdicts", verdicts: [{ email: g.email, result: "valid" }] });
  const due = (await apiJson("/api/t2r-groups/codes-due")).body.data.codes as any[];
  for (const c of due) await post({ op: "code", id: c.id, ok: true });
  await post({ op: "queue" });
  return g;
}

describe("the duty and its tiers are data", () => {
  it("tier 3 (schools, districts) is OFF until Phase 8; tiers 1 and 2 are on", async () => {
    const tiers = (await env.DB.prepare(`SELECT tier, enabled, why_off FROM t2r_group_tiers ORDER BY tier`).all<any>()).results;
    expect(tiers.map((t: any) => [t.tier, t.enabled])).toEqual([[1, 1], [2, 1], [3, 0]]);
    expect(tiers[2].why_off).toMatch(/Phase 8.*teacher dashboard.*rosters.*privacy.*reading gains/);
  });
  it("is Monique's weekday duty, a Mac job that reports to its row", async () => {
    const d = await row<any>(`SELECT * FROM standing_duties WHERE id = 'duty_t2r_groups'`);
    expect(d.employee_id).toBe("emp_relationship");
    expect(JSON.parse(d.task_input).local_job).toBe("t2r-groups.mjs");
    expect(JSON.parse(d.weekdays)).toEqual([1, 2, 3, 4, 5]);
    expect([d.local_hour, d.local_minute, d.timezone]).toEqual([8, 15, "America/Chicago"]);
  });
  it("tier 3 flips only by its setting, and a tier turned off says why", async () => {
    expect((await apiJson("/api/t2r-groups/tiers/3", { method: "PUT", body: { enabled: "yes" } })).status).toBe(400);
    await apiJson("/api/t2r-groups/tiers/2", { method: "PUT", body: { enabled: false, why_off: "Paused for the holidays." } });
    expect(await row<any>(`SELECT enabled, why_off FROM t2r_group_tiers WHERE tier = 2`)).toEqual({ enabled: 0, why_off: "Paused for the holidays." });
    const r = (await post({ op: "import", rows: [group(9, { kind: "tutoring center", org_name: "Example Tutoring" })] })).body.data;
    expect(r.refused[0].why).toBe("tier 2 is off");
    await apiJson("/api/t2r-groups/tiers/3", { method: "PUT", body: { enabled: true } });
    expect((await row<any>(`SELECT enabled, why_off FROM t2r_group_tiers WHERE tier = 3`))).toEqual({ enabled: 1, why_off: null });
  });
  it("the desk needs a session", async () => {
    const res = await worker.fetch(new Request("https://boss.test/api/t2r-groups/plan"), env, createExecutionContext());
    expect(res.status).toBe(401);
    const plan = (await apiJson("/api/t2r-groups/plan")).body.data;
    expect(plan.tiers.filter((t: any) => t.enabled).map((t: any) => t.tier)).toEqual([1, 2]);
  });
});

describe("prospects: public pages, published group addresses, never a guess", () => {
  it("refuses a guessed personal address, a missing source page and a tier that is off; keeps a good one", async () => {
    const r = (await post({ op: "import", rows: [
      group(1),
      group(2, { email: "jane.smith@maplegrove2.example" }),
      group(3, { source_url: "" }),
      group(4, { kind: "school district", org_name: "Example ISD", email: "info@exampleisd.example" }),
      group(5, { email: "maplegrovecoop5@gmail.com" }),
    ] })).body.data;
    expect(r.recorded).toBe(2);
    expect(r.refused.map((x: any) => x.why)).toEqual([
      expect.stringMatching(/not a published role or group address/),
      expect.stringMatching(/no public https page/),
      "tier 3 is off",
    ]);
    const rows = (await env.DB.prepare(`SELECT email, tier, source_url FROM t2r_groups ORDER BY email`).all<any>()).results;
    expect(rows.every((x: any) => x.source_url.startsWith("https://"))).toBe(true);
  });
});

describe("the guards", () => {
  it("NeverBounce before the first email: no verdict, or anything but valid, never reaches the engine", async () => {
    await post({ op: "import", rows: [group(1), group(2)] });
    await post({ op: "verdicts", verdicts: [{ email: group(2).email, result: "catchall" }] });
    expect((await apiJson("/api/t2r-groups/codes-due")).body.data.codes).toEqual([]);
    expect(await queueReady(env.DB, TUESDAY_10AM)).toBe(0);
    const skipped = await row<any>(`SELECT state, skip_reason FROM t2r_groups WHERE email = ?`, group(2).email);
    expect(skipped).toEqual({ state: "skipped", skip_reason: "NeverBounce said catchall" });
    // Even a prospect that reached the queue some other way is refused at send time.
    await ready(3);
    await env.DB.prepare(`UPDATE t2r_groups SET nb_verdict = NULL WHERE email = ?`).bind(group(3).email).run();
    const g = fakeGmail();
    await runOutreachTick(tickEnv(), TUESDAY_10AM, g.fetchImpl);
    expect(g.sends.filter((s) => s.to === group(3).email)).toHaveLength(0);
  });

  it("no tier-3 send while it is off — not queued, and refused at send time if it ever got there", async () => {
    // Forced in directly, as if the import guard had failed: a school district, valid, coded.
    await env.DB.prepare(
      `INSERT INTO t2r_groups (id, tier, kind, org_name, email, email_domain, source_url, state, nb_verdict, code, code_state, found_at, updated_at)
       VALUES ('t2g_isd', 3, 'school district', 'Example ISD', 'info@isd.example', 'isd.example', 'https://isd.example/contact', 'coded', 'valid', 'EXAMPL15AAA', 'live', 0, 0)`,
    ).run();
    expect(await queueReady(env.DB, TUESDAY_10AM)).toBe(0);
    await env.DB.prepare(`INSERT INTO outreach_prospects (id, business_key, email, email_domain, segment, source, source_url, mx_verified_at, state, step, unsub_token, created_at, updated_at)
      VALUES ('opr_isd', ?, 'info@isd.example', 'isd.example', 'school district', 't2r_groups_research', 'https://isd.example/contact', 0, 'new', 0, 'tok_isd', 0, 0)`).bind(G).run();
    await env.DB.prepare(`UPDATE t2r_groups SET prospect_id = 'opr_isd' WHERE id = 't2g_isd'`).run();
    expect(await groupSendGate(env.DB, "opr_isd")).toEqual({ refuse: "tier 3 is off" });
    const g = fakeGmail();
    await runOutreachTick(tickEnv(), TUESDAY_10AM, g.fetchImpl);
    expect(g.sends.filter((s) => s.to === "info@isd.example")).toHaveLength(0);
    expect((await row<any>(`SELECT state FROM outreach_prospects WHERE id = 'opr_isd'`)).state).toBe("done");
  });

  it("sends from st@time-2-read.com with the group's own code and no price; ONE follow-up, never a third email", async () => {
    await ready(1);
    const code = (await row<any>(`SELECT code FROM t2r_groups WHERE email = ?`, group(1).email)).code;
    expect(code).toMatch(/^MAPLEG15[A-Z2-9]{3}$/);
    const g = fakeGmail();
    await runOutreachTick(tickEnv(), TUESDAY_10AM, g.fetchImpl);
    const first = g.sends.filter((s) => s.to === group(1).email);
    expect(first).toHaveLength(1);
    expect(first[0]!.from).toBe("st@time-2-read.com");
    expect(first[0]!.text).toContain(code);
    // Then every weekday hour for three weeks: exactly one more email, the follow-up, and nothing after.
    for (let d = 1; d <= 21; d++) await runOutreachTick(tickEnv(), TUESDAY_10AM + d * DAY_MS, g.fetchImpl);
    const all = g.sends.filter((s) => s.to === group(1).email);
    expect(all).toHaveLength(2);
    expect(all[1]!.raw).toMatch(/^Subject: Re: A free reading trial for /m);
    for (const s of all) {
      const words = s.text.slice(0, s.text.indexOf("\n--\n"));
      expect(outboundProblems(words), words).toEqual([]);
      expect(words).not.toMatch(/\$|\bprice|\bper month/i);
    }
    const p = await row<any>(`SELECT state, step, next_due_at FROM outreach_prospects WHERE business_key = ? AND email = ?`, G, group(1).email);
    expect(p).toEqual({ state: "done", step: 2, next_due_at: null });
  });

  it("at most 10 new groups a weekday, even when the ramp would allow 40", async () => {
    for (let i = 1; i <= 14; i++) await ready(i);
    const g = fakeGmail();
    for (let h = 0; h < 7; h++) await runOutreachTick(tickEnv(), TUESDAY_10AM + h * HOUR, g.fetchImpl);
    expect(g.sends.filter((s) => /maplegrove/.test(s.to))).toHaveLength(10);
    // The next weekday the rest go.
    await runOutreachTick(tickEnv(), TUESDAY_10AM + DAY_MS, g.fetchImpl);
    expect(g.sends.filter((s) => /maplegrove/.test(s.to) && !/^Subject: Re:/m.test(s.raw))).toHaveLength(14);
  });

  it("never follows up to a bounced address", async () => {
    await ready(1);
    const g = fakeGmail();
    await runOutreachTick(tickEnv(), TUESDAY_10AM, g.fetchImpl);
    await env.DB.prepare(`UPDATE outreach_prospects SET state = 'bounced', next_due_at = NULL WHERE email = ?`).bind(group(1).email).run();
    for (let d = 1; d <= 10; d++) await runOutreachTick(tickEnv(), TUESDAY_10AM + d * DAY_MS, g.fetchImpl);
    expect(g.sends.filter((s) => s.to === group(1).email)).toHaveLength(1);
  });
});

describe("replies: real ones to her, a price question with a suggested price, Monique never quotes", () => {
  it("cards a price question for her with a suggestion, and writes nothing back to them", async () => {
    await ready(1);
    const g = fakeGmail();
    await runOutreachTick(tickEnv(), TUESDAY_10AM, g.fetchImpl);
    const p = await row<any>(`SELECT thread_id FROM outreach_prospects WHERE business_key = ? AND email = ?`, G, group(1).email);
    const replyGmail = fakeGmail([{ id: "rp1", threadId: p.thread_id, from: `Co-op <${group(1).email}>`, subject: "Re: x", body: "We have about 30 families. How much would it be after the trial?" }]);
    await runOutreachTick(tickEnv(), TUESDAY_10AM + HOUR, replyGmail.fetchImpl);
    expect(replyGmail.sends).toHaveLength(0);
    const r = await row<any>(`SELECT approval_id FROM outreach_replies WHERE gmail_message_id = 'rp1'`);
    const a = await row<any>(`SELECT title, summary FROM approvals WHERE id = ?`, r.approval_id);
    expect(a.title).toMatch(/asked the price/);
    expect(a.summary).toMatch(/Suggested: \$6\.99 per family a month .* for 30 families/);
    expect(a.summary).toMatch(/Monique never quotes a price/);
    expect(a.summary).toContain("goes to your drafts");
  });
});

describe("what she reads", () => {
  it("the Monday line and the scoreboard rows come from this duty, and codes in use say 'not tracked yet' until read", async () => {
    await ready(1);
    await runOutreachTick(tickEnv(), TUESDAY_10AM, fakeGmail().fetchImpl);
    let s = await summary(env.DB);
    expect(s.line).toBe("Time-2-Read groups: 1 emailed, 0 replied, codes in use not tracked yet");
    const code = (await row<any>(`SELECT code FROM t2r_groups WHERE email = ?`, group(1).email)).code;
    await post({ op: "usage", codes: [{ code, checkouts_started: 3, signups: 1 }, { code: "HOMESCHOOL15", checkouts_started: 9 }] });
    s = await summary(env.DB);
    expect(s.line).toBe("Time-2-Read groups: 1 emailed, 0 replied, 1 code in use");
    await feedScoreboard(env as any, TUESDAY_10AM);
    const brain = await row<any>(`SELECT body_md FROM brains WHERE slug = 'time-2-read'`);
    const nums = Object.fromEntries(numbersRows(brain.body_md).map((r: any) => [r.metric, r]));
    expect(nums["Institutional pipeline"].value).toBe("0 in talks · 1 groups emailed · 1 codes in use");
    expect(nums["Outreach replies"].value).toBe("0");
    expect(nums["Outreach replies"].source).toBe("Boss OS: Monique's Time-2-Read groups duty");
    // Unchanged numbers write no second revision.
    const before = (await row<any>(`SELECT COUNT(*) AS n FROM brain_revisions WHERE slug = 'time-2-read'`)).n;
    expect((await feedScoreboard(env as any, TUESDAY_10AM + HOUR)).changed).toBe(false);
    expect((await row<any>(`SELECT COUNT(*) AS n FROM brain_revisions WHERE slug = 'time-2-read'`)).n).toBe(before);
  });
  it("the groups business is in the catalog with two steps and its own weekday limit", () => {
    const b = businessByKey(G)!;
    expect(b.steps).toHaveLength(2);
    expect(b.newPerDay).toBe(10);
    expect(b.sender).toBe("st@time-2-read.com");
    expect(b.segments).toEqual([]);
  });
});
