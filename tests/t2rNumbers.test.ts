/**
 * Time-2-Read's weekly money numbers (scripts/brains/t2r-numbers.mjs, owner's approval 1 Nov 2026).
 * The math is pinned, the test accounts stay out, and a source that cannot be read writes a named
 * reason into the brain cell, never a zero.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  METRICS, computeValues, countSignups, countSubscribers, isExcludedUser, isLiveStripeKey, monthPairWords,
  mrr, numbersSection, parseExcludeList, parseListPrice, payingWords, previousMonthKey, rateWords, stripeTrials, trialRate,
} from "../scripts/brains/t2r-numbers.mjs";
import { numbersRows, seedFor } from "../src/shared/boss/brains/brain.mjs";

const NOW = Date.parse("2026-11-04T13:30:00Z"); // a Wednesday, 07:30 Central
const DAY = 86_400_000;
const PRICE = { monthly: 12.99, annual: 99 };

const brain = () => {
  const md = seedFor("time-2-read", "Time-2-Read");
  const table = [
    "| Metric | Definition | Source | Value | Last updated |",
    "|---|---|---|---|---|",
    "| Paying subscribers | Active paid subs | Supabase | [MISSING] | — |",
    "| MRR | Monthly × price + annual × price ÷ 12 | Stripe | [MISSING] | — |",
    "| Trial starts | 7-day trials started | Stripe | [MISSING] | — |",
    "| Trial → paid rate | converted ÷ ended | Stripe | [MISSING] | — |",
    "| Free signups | New accounts | Supabase auth | [MISSING] | — |",
    "| Outreach replies | Human replies | Boss OS | 4 | 2026-10-31 |",
    "| List price | Premium monthly / annual | PRICING.md | $12.99 / $99 | 2026-10-25 |",
  ].join("\n");
  return md.replace(/## Numbers\n[\s\S]*?(?=\n## )/, `## Numbers\n${table}\n`);
};

describe("the metric math", () => {
  it("MRR = monthly × price + annual × price ÷ 12, to the cent", () => {
    expect(mrr({ monthly: 3, annual: 2 }, PRICE)).toBe(55.47); // 38.97 + 16.50
    expect(mrr({ monthly: 0, annual: 1 }, PRICE)).toBe(8.25);
    expect(mrr({ monthly: 0, annual: 0 }, PRICE)).toBe(0);
  });
  it("NEGATIVE: an annual plan is never counted as twelve months of revenue", () => {
    expect(mrr({ monthly: 0, annual: 1 }, PRICE)).not.toBe(99);
    expect(mrr({ monthly: 1, annual: 1 }, PRICE)).not.toBe(12.99 + 99);
  });
  it("trial → paid rate is converted ÷ ended, and no ended trials is null, never 0%", () => {
    expect(trialRate(3, 4)).toBe(75);
    expect(trialRate(1, 3)).toBe(33.3);
    expect(trialRate(0, 2)).toBe(0);
    expect(trialRate(0, 0)).toBeNull();
    expect(() => trialRate(5, 4)).toThrow(/impossible/);
  });
  it("reads the price from the brain's List price row", () => {
    expect(parseListPrice("$12.99 / $99")).toEqual(PRICE);
    expect(parseListPrice("[MISSING]")).toBeNull();
    expect(parseListPrice("$12.99")).toBeNull();
  });
  it("months roll over the year", () => {
    expect(previousMonthKey("2026-01")).toBe("2025-12");
    expect(previousMonthKey("2026-11")).toBe("2026-10");
  });
});

describe("who counts", () => {
  const excluded = parseExcludeList("# hers\nowner@example-owner.com\n\nTester@Example-Owner.com # second\n");
  it("the list is lowercase emails, comments dropped", () => {
    expect([...excluded].sort()).toEqual(["owner@example-owner.com", "tester@example-owner.com"]);
  });
  it("excludes her listed accounts, flagged test accounts and anonymous ones", () => {
    expect(isExcludedUser({ email: "OWNER@example-owner.com" }, excluded)).toBe(true);
    expect(isExcludedUser({ email: "a+test1@gmail.com" }, excluded)).toBe(true);
    expect(isExcludedUser({ email: "x@y.com", app_metadata: { test: true } }, excluded)).toBe(true);
    expect(isExcludedUser({ email: "x@y.com", is_anonymous: true }, excluded)).toBe(true);
    expect(isExcludedUser({ email: "reader@y.com" }, excluded)).toBe(false);
  });
  it("paying = subscribed with a Stripe customer, past the trial window; inside it is 'in trial'", () => {
    const iso = (t: number) => new Date(t).toISOString();
    const rows = [
      { user_id: "a", email: "a@x.com", subscribed: true, stripe_customer_id: "cus_a", subscription_tier: "monthly", updated_at: iso(NOW - 30 * DAY) },
      { user_id: "b", email: "b@x.com", subscribed: true, stripe_customer_id: "cus_b", subscription_tier: "annual", updated_at: iso(NOW - 9 * DAY) },
      { user_id: "c", email: "c@x.com", subscribed: true, stripe_customer_id: "cus_c", subscription_tier: "monthly", updated_at: iso(NOW - 2 * DAY) },
      { user_id: "d", email: "d@x.com", subscribed: true, stripe_customer_id: "cus_d", subscription_tier: "monthly", updated_at: iso(NOW - 10 * DAY) }, // 15-day code
      { user_id: "e", email: "e@x.com", subscribed: false, stripe_customer_id: "cus_e", subscription_tier: null, updated_at: iso(NOW - 40 * DAY) },
      { user_id: "f", email: "f@x.com", subscribed: true, stripe_customer_id: null, subscription_tier: "monthly", updated_at: iso(NOW - 40 * DAY) }, // comped
      { user_id: "g", email: "owner@example-owner.com", subscribed: true, stripe_customer_id: "cus_g", subscription_tier: "annual", updated_at: iso(NOW - 40 * DAY) },
    ];
    const c = countSubscribers(rows, { excludedIds: new Set(), excludedEmails: excluded, trialDaysByUser: new Map([["d", 15]]), now: NOW });
    expect(c).toEqual({ monthly: 1, annual: 1, inTrial: 2, unknownTier: 0 });
    expect(payingWords(c)).toBe("2 (1 monthly · 1 annual); 2 more in trial");
    expect(mrr(c, PRICE)).toBe(21.24);
  });
  it("signups count by Central month, this one and the last, without test accounts", () => {
    const users = [
      { email: "r1@x.com", created_at: "2026-11-02T10:00:00Z" },
      { email: "r2@x.com", created_at: "2026-11-01T04:00:00Z" }, // 23:00 Central on 31 Oct
      { email: "r3@x.com", created_at: "2026-10-15T10:00:00Z" },
      { email: "owner@example-owner.com", created_at: "2026-11-02T10:00:00Z" },
      { email: "r4@x.com", created_at: "2026-08-15T10:00:00Z" },
    ];
    const s = countSignups(users, { excluded, now: NOW });
    expect(s).toMatchObject({ thisKey: "2026-11", lastKey: "2026-10", thisMonth: 1, lastMonth: 2 });
    expect(monthPairWords(s.thisMonth, s.lastMonth, s.thisKey, s.lastKey)).toBe("1 in Nov so far · 2 in Oct");
  });
});

describe("live Stripe trials", () => {
  const sec = (t: number) => Math.floor(t / 1000);
  const sub = (o: Record<string, unknown>) => ({ livemode: true, customer: { email: "r@x.com" }, ...o });
  it("starts by trial_start month; converted ÷ ended by trial_end month", () => {
    const subs = [
      sub({ trial_start: sec(NOW - 2 * DAY), trial_end: sec(NOW + 5 * DAY), status: "trialing" }),
      sub({ trial_start: sec(Date.parse("2026-10-20T15:00:00Z")), trial_end: sec(Date.parse("2026-10-27T15:00:00Z")), status: "active" }),
      sub({ trial_start: sec(Date.parse("2026-10-10T15:00:00Z")), trial_end: sec(Date.parse("2026-10-17T15:00:00Z")), status: "canceled", canceled_at: sec(Date.parse("2026-10-12T15:00:00Z")) }),
      sub({ trial_start: sec(Date.parse("2026-10-01T15:00:00Z")), trial_end: sec(Date.parse("2026-10-08T15:00:00Z")), status: "canceled", canceled_at: sec(Date.parse("2026-10-25T15:00:00Z")) }),
      sub({ customer: { email: "owner@example-owner.com" }, trial_start: sec(NOW - DAY), trial_end: sec(NOW - 1000), status: "active" }),
    ];
    const t = stripeTrials(subs, { excludedEmails: parseExcludeList("owner@example-owner.com"), now: NOW });
    expect(t.by["2026-11"]).toEqual({ starts: 1, ended: 0, converted: 0 });
    expect(t.by["2026-10"]).toEqual({ starts: 3, ended: 3, converted: 2 });
    expect(rateWords(t)).toBe("no trials ended in Nov · 66.7% in Oct (2 of 3)");
  });
  it("NEGATIVE: a test-mode object or key is refused, never shown as a real number", () => {
    expect(() => stripeTrials([{ livemode: false, trial_start: 1, trial_end: 2 }], { excludedEmails: new Set(), now: NOW })).toThrow(/test-mode/);
    expect(isLiveStripeKey("sk_test_abc")).toBe(false);
    expect(isLiveStripeKey("rk_live_abc")).toBe(true);
  });
});

describe("Rule 0: the brain cells", () => {
  it("writes only Value and Last updated, and leaves the other rows alone", () => {
    const md = brain();
    const text = numbersSection(md, { [METRICS.paying]: "2 (1 monthly · 1 annual); 0 more in trial", [METRICS.mrr]: "$21.24 at list price" }, "2026-11-04")!;
    const rows = numbersRows(`## Numbers\n${text}\n`);
    const paying = rows.find((r) => r.metric === "Paying subscribers")!;
    expect(paying).toMatchObject({ definition: "Active paid subs", source: "Supabase", value: "2 (1 monthly · 1 annual); 0 more in trial", last_updated: "2026-11-04" });
    expect(rows.find((r) => r.metric === "Outreach replies")).toMatchObject({ value: "4", last_updated: "2026-10-31" });
    expect(rows.find((r) => r.metric === "Trial starts")?.value).toBeNull();
    expect(rows).toHaveLength(7);
  });
  it("a value with a pipe cannot break the table", () => {
    const text = numbersSection(brain(), { [METRICS.mrr]: "a | b" }, "2026-11-04")!;
    expect(numbersRows(`## Numbers\n${text}\n`).find((r) => r.metric === "MRR")?.value).toBe("a / b");
  });
  it("no test-account list: every cell is a named reason, nothing is fetched", async () => {
    let fetched = 0;
    const v = await computeValues({ md: brain(), env: { DAILYSTORY_SUPABASE_SERVICE_ROLE_KEY: "k" }, now: NOW, excludeText: null, fetchImpl: (async () => { fetched++; throw new Error("no"); }) as any });
    expect(fetched).toBe(0);
    for (const m of Object.values(METRICS)) expect(v[m]).toMatch(/^not read: test-account list missing/);
  });
  it("no keys: named reasons, never a zero; a test Stripe key is refused", async () => {
    const v = await computeValues({ md: brain(), env: { T2R_STRIPE_LIVE_RESTRICTED_KEY: "sk_test_x" }, now: NOW, excludeText: "", fetchImpl: (async () => { throw new Error("no"); }) as any });
    expect(v[METRICS.paying]).toMatch(/^not read: DAILYSTORY_SUPABASE_SERVICE_ROLE_KEY/);
    expect(v[METRICS.trialRate]).toMatch(/^not read: .*not a live-mode key/);
    for (const m of Object.values(METRICS)) expect(v[m]).not.toMatch(/^\$?0\b/);
  });
  it("a Supabase failure names the status in the cell", async () => {
    const v = await computeValues({ md: brain(), env: { DAILYSTORY_SUPABASE_SERVICE_ROLE_KEY: "k" }, now: NOW, excludeText: "", fetchImpl: (async () => new Response("", { status: 401 })) as any });
    expect(v[METRICS.paying]).toBe("not read: Supabase /rest/v1/subscribers answered 401");
    expect(v[METRICS.signups]).toBe(v[METRICS.paying]);
    expect(v[METRICS.trialStarts]).toMatch(/^not read: needs a live Time-2-Read Stripe restricted key/);
  });
  it("end to end from the tables: aggregates only in the cells", async () => {
    const iso = (t: number) => new Date(t).toISOString();
    const fetchImpl = (async (url: string) => {
      const j = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (url.includes("/rest/v1/subscribers")) return j([{ user_id: "a", email: "reader@x.com", subscribed: true, stripe_customer_id: "cus_a", subscription_tier: "monthly", updated_at: iso(NOW - 20 * DAY) }]);
      if (url.includes("access_code_redemptions")) return j([]);
      if (url.includes("/auth/v1/admin/users")) return j({ users: [{ id: "a", email: "reader@x.com", created_at: "2026-11-02T10:00:00Z" }, { id: "o", email: "owner@example-owner.com", created_at: "2026-11-02T10:00:00Z" }] });
      throw new Error(url);
    }) as any;
    const v = await computeValues({ md: brain(), env: { DAILYSTORY_SUPABASE_SERVICE_ROLE_KEY: "k" }, now: NOW, excludeText: "owner@example-owner.com", fetchImpl });
    expect(v[METRICS.paying]).toBe("1 (1 monthly · 0 annual); 0 more in trial");
    expect(v[METRICS.mrr]).toBe("$12.99 at list price");
    expect(v[METRICS.signups]).toBe("1 in Nov so far · 0 in Oct");
    expect(JSON.stringify(v)).not.toMatch(/@/);
  });
});

describe("the job runs in the cloud, Wednesday 07:30 Central (moved off the Mac 1 Nov 2026)", () => {
  it("is scheduled by its workflow with its private exclusion list as state, and not on the Mac", () => {
    const wf = readFileSync(".github/workflows/job-t2r-numbers.yml", "utf8");
    expect(wf).toMatch(/brains:t2r-numbers/);
    expect(wf).toMatch(/cron: '30 7 \* \* 3'\s+# America\/Chicago[^\n]*\n\s+timezone: America\/Chicago/);
    expect(wf).toMatch(/state: t2r-test-accounts\.txt/);
    const installer = readFileSync("scripts/ops/install-agent-launchd.sh", "utf8");
    expect(installer).toMatch(/cloud_moved "\$T2R_NUMBERS_LABEL"/);
    expect(installer).not.toMatch(/brains:t2r-numbers/);
  });
});
