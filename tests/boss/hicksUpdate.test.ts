/**
 * THE HICKS QUARTERLY UPDATE (owner, 3 Nov 2026): it NEVER sends without her approval, and it LEADS
 * WITH THE WIN. Also: a subject is never reused, a metric that is down is never listed as a win, the
 * carried-over line comes first and is marked used only on approval. Synthetic data only: no client
 * name or address appears here.
 */
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../../src/worker/boss/index";
import { apiJson } from "./helpers";
import { runHicksUpdate } from "../../src/worker/boss/clients/hicksUpdate";
import WORKER_SOURCE from "../../src/worker/boss/clients/hicksUpdate.ts?raw";
import SHARED_SOURCE from "../../src/shared/boss/clients/hicksUpdate.mjs?raw";
import {
  composeDraft, draftProblems, quarterDue, researchWins, freshSubject, plainFixes, SUBJECTS,
} from "../../src/shared/boss/clients/hicksUpdate.mjs";

// First Monday of February 2027 is 1 Feb; 08:30 Central = 14:30 UTC.
const DUE = Date.parse("2027-02-01T14:30:00Z");
const PAST = ["Good news on hicksconsulting.org: more people are visiting from Google", "Your Google visits are up again"];

async function pem(): Promise<string> {
  const kp = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", kp.privateKey)) as ArrayBuffer);
  let bin = ""; for (const b of der) bin += String.fromCharCode(b);
  return `-----BEGIN PRIVATE KEY-----\n${btoa(bin)}\n-----END PRIVATE KEY-----`;
}

/** A fake Google + GitHub. `nowClicks`/`prevClicks` per window; every URL asked for is recorded. */
function fakeNet(nowClicks: number, prevClicks: number) {
  const urls: string[] = [];
  const f = (async (input: any, init?: any) => {
    const url = String(input?.url ?? input);
    urls.push(url);
    if (url.includes("oauth2.googleapis.com/token")) return Response.json({ access_token: "t" });
    if (url.endsWith("/webmasters/v3/sites")) return Response.json({ siteEntry: [{ siteUrl: "sc-domain:hicksconsulting.org" }] });
    if (url.includes("searchAnalytics/query")) {
      const b = JSON.parse(init.body);
      if (b.dimensions[0] === "date") {
        const rows = [];
        for (let d = Date.parse(b.startDate); d <= Date.parse(b.endDate); d += 86_400_000) rows.push({ keys: [new Date(d).toISOString().slice(0, 10)], clicks: 0 });
        rows[rows.length - 1]!.clicks = nowClicks; rows[0]!.clicks = prevClicks;
        return Response.json({ rows });
      }
      return Response.json({ rows: [] });
    }
    if (url.includes("api.github.com")) return Response.json([{ title: "Fix rich-results schema errors", merged_at: "2026-12-01T00:00:00Z" }, { title: "ci: timeouts", merged_at: "2026-12-02T00:00:00Z" }]);
    if (url.includes("raw.githubusercontent.com")) return Response.json({ days: {} });
    return new Response("unexpected", { status: 599 });
  }) as typeof fetch;
  return { f, urls };
}

async function tap(path: string, method = "GET") {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://boss.test${path}`, { method, redirect: "manual" }), env, ctx);
  await waitOnExecutionContext(ctx);
  return { status: res.status, location: res.headers.get("location"), text: await res.text() };
}
const row = () => env.DB.prepare(`SELECT * FROM client_update_drafts WHERE quarter = '2027-02'`).first<any>();

beforeEach(async () => {
  await env.DB.exec("DELETE FROM client_update_drafts WHERE quarter = '2027-02'; UPDATE client_update_carryover SET used_at = NULL, used_in = NULL;");
  (env as any).GSC_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "bot@example.iam.gserviceaccount.com", private_key: await pem() });
});

describe("it never sends without her approval", () => {
  it("the tick drafts once and parks it pending; no mail endpoint is ever called; GET never approves; Approve opens HER Gmail", async () => {
    const net = fakeNet(40, 20);
    const r = await runHicksUpdate(env as any, DUE, net.f);
    expect(r.ran).toBe(true);
    expect((await runHicksUpdate(env as any, DUE + 3_600_000, net.f)).ran).toBe(false); // claimed once per quarter
    expect(net.urls.some((u) => /gmail|mail\.google|resend|messages\/send|drafts/i.test(u))).toBe(false);
    const d = await row();
    expect(d.status).toBe("pending");

    // The approval email is for her: the notice carries the words and the three taps, nothing is sent.
    const n = await apiJson<any>("/api/clients/hicks-update/notice", { method: "POST" });
    expect(n.body.data.due).toBe(true);
    const card = n.body.data.notice.decide[0];
    expect(card.draft.text).toContain(d.body);
    expect(card.buttons.map((b: any) => b.label)).toEqual(["Approve and open in Gmail", "Change the words", "Skip this quarter"]);

    // A mail scanner's GET changes nothing.
    await tap(`/api/auth/tap/${d.tap_token}?do=approve`);
    expect((await row()).status).toBe("pending");
    expect((await env.DB.prepare(`SELECT used_at FROM client_update_carryover WHERE id = 'cuc_hicks_ai_memphis'`).first<any>()).used_at).toBeNull();

    // Her tap: approved, carry-over marked used, subject recorded, and HER Gmail opens; Boss OS sends nothing.
    const t = await tap(`/api/auth/tap/${d.tap_token}?do=approve`, "POST");
    expect((await row()).status).toBe("approved");
    expect(t.status === 303 ? t.location : t.text).toMatch(/mail\.google\.com\/mail\/\?/);
    expect((await env.DB.prepare(`SELECT used_in FROM client_update_carryover WHERE id = 'cuc_hicks_ai_memphis'`).first<any>()).used_in).toBe(d.id);
    expect(await env.DB.prepare(`SELECT 1 AS x FROM client_update_subjects WHERE subject = ?`).bind(d.subject).first()).not.toBeNull();
  });

  it("skip leaves the carry-over waiting; no transport exists in the job's code", async () => {
    await runHicksUpdate(env as any, DUE, fakeNet(5, 9).f);
    const d = await row();
    await tap(`/api/auth/tap/${d.tap_token}?do=skip`, "POST");
    expect((await row()).status).toBe("skipped");
    expect((await env.DB.prepare(`SELECT used_at FROM client_update_carryover WHERE id = 'cuc_hicks_ai_memphis'`).first<any>()).used_at).toBeNull();
    for (const src of [WORKER_SOURCE, SHARED_SOURCE]) {
      expect(src).not.toMatch(/messages\/send|drafts\/send|sendOne\(|postEmployeeMail|sendAsEmployee|resend\.com|gmail\.googleapis/);
    }
  });

  it("is due only on the first Monday of Feb, May, Aug and Nov from 08:00 Central", () => {
    expect(quarterDue(DUE)).toMatchObject({ due: true, quarter: "2027-02" });
    expect(quarterDue(Date.parse("2027-02-01T13:30:00Z")).due).toBe(false); // 07:30 Central
    expect(quarterDue(Date.parse("2027-02-08T15:00:00Z")).due).toBe(false); // second Monday
    expect(quarterDue(Date.parse("2027-03-01T15:00:00Z")).due).toBe(false); // not a quarter month
    expect(quarterDue(Date.parse("2026-11-02T14:30:00Z"))).toMatchObject({ due: true, quarter: "2026-11" });
  });
});

describe("it leads with the win", () => {
  const fixes = { ok: true as const, items: [] };
  const lead = (text: string) => text.split("\n").filter(Boolean)[1]!;

  it("visits up: the happy line first, the numbers in plain words", () => {
    const d = composeDraft({ name: "Pat", clicks: { ok: true, now: 40, prev: 30, lastSent: 34, lastSentAt: Date.parse("2026-11-03T13:00:00Z") }, fixes, pastSubjects: PAST });
    expect(d.verdict).toBe("win");
    expect(lead(d.text)).toMatch(/^Quick, happy update/);
    expect(d.text).toContain("40 people came to hicksconsulting.org from Google search, up from 34 when I last wrote in November and 30 the four weeks before that.");
    expect(draftProblems(d.text, d.subject)).toEqual([]);
  });

  it("nothing up: says the quarter was steady, never leads with a dip", () => {
    const d = composeDraft({ name: "Pat", clicks: { ok: true, now: 20, prev: 30, lastSent: 34, lastSentAt: null }, fixes, pastSubjects: PAST });
    expect(d.verdict).toBe("steady");
    expect(lead(d.text)).toMatch(/steady quarter/);
    expect(d.text).not.toMatch(/\b(down|dip|fewer|drop|fell)\b/i);
    expect(draftProblems(d.text, d.subject)).toEqual([]);
  });

  it("a research win leads even when visits did not rise", () => {
    const wins = researchWins({ ai: { ok: true, now: { visitors: 4, bots: 0, days: 20 }, prev: { visitors: 0, bots: 0, days: 0 } }, queries: { ok: false, why: "x" }, pages: { ok: false, why: "x" } }).wins;
    const d = composeDraft({ name: "Pat", clicks: { ok: true, now: 20, prev: 30, lastSent: 34, lastSentAt: null }, fixes, wins, pastSubjects: PAST });
    expect(lead(d.text)).toMatch(/^Quick, happy update/);
    expect(d.text).toContain("For the first time we can see people arriving from ChatGPT");
  });

  it("an unread source says not read, never 0", () => {
    const d = composeDraft({ name: "Pat", clicks: { ok: false, why: "no key" }, fixes: { ok: false, why: "no answer" } });
    expect(d.text).toContain("Visits from Google over the last four weeks: not read.");
    expect(d.text).toContain("Fixes this quarter: not read.");
    expect(d.text).not.toMatch(/\b0 people\b/);
  });

  it("a metric that's down, flat or unread is never listed as a win", () => {
    const r = researchWins({
      ai: { ok: true, now: { visitors: 3, bots: 10, days: 28 }, prev: { visitors: 5, bots: 10, days: 28 } },
      queries: { ok: true, now: [{ query: "therapist memphis", position: 14, impressions: 50 }, { query: "kept", position: 4, impressions: 20 }], prev: [{ query: "therapist memphis", position: 8, impressions: 60 }, { query: "kept", position: 3, impressions: 20 }] },
      pages: { ok: false, why: "no answer" },
    });
    expect(r.wins).toEqual([]);
    expect(r.dropped.join(" ")).toMatch(/AI-tool visits/);
    expect(r.unread.join(" ")).toMatch(/not read/);
    const up = researchWins({ ai: { ok: false, why: "x" }, pages: { ok: false, why: "x" }, queries: { ok: true, now: [{ query: "black therapist memphis", position: 6, impressions: 30 }], prev: [{ query: "black therapist memphis", position: 12, impressions: 10 }] } });
    expect(up.wins.map((w) => w.key)).toEqual(["page-one"]);
  });

  it("never repeats a past subject", () => {
    const d = composeDraft({ name: "Pat", clicks: { ok: true, now: 40, prev: 30, lastSent: 34, lastSentAt: null }, fixes, pastSubjects: PAST });
    expect(PAST).not.toContain(d.subject);
    const all = [...PAST, ...SUBJECTS.win];
    const s = freshSubject("win", all, DUE);
    expect(all.map((x) => x.toLowerCase())).not.toContain(s.toLowerCase());
    expect(freshSubject("win", [...all, s], DUE)).not.toBe(s);
  });

  it("the carried-over line is first in the fixes; the Resources schedule and calls never appear", () => {
    const items = plainFixes([
      { title: "feat(publish): Resources posts publish automatically on schedule", merged_at: "1" },
      { title: "Fix rich-results schema errors, compress images", merged_at: "2" },
    ]);
    expect(items.map((i) => i.key)).toEqual(["schema", "speed"]);
    const d = composeDraft({ name: "Pat", clicks: { ok: true, now: 40, prev: 30, lastSent: null, lastSentAt: null }, fixes: { ok: true, items }, carryOver: [{ id: "c1", line: "Carried line." }] });
    const after = d.text.split("What I'm polishing:\n")[1]!;
    expect(after.split("\n")[0]).toBe("- Carried line.");
    expect(d.text).not.toMatch(/resources|\bcall\b/i);
    expect(draftProblems("Hi Pat,\n\nLet's hop on a call.\n\nBest,\nSequoia")).toContain("it suggests a call");
    expect(draftProblems("Hi Pat,\n\nThe Resources posting schedule ran.\n\nBest,\nSequoia")).toContain("it mentions the Resources posting schedule");
  });
});
