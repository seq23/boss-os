import { describe, expect, it } from "vitest";
import { reconcileList, screenMessage } from "../scripts/ops/lp-positive.mjs";
import * as bulk from "../scripts/ops/mail-bulk.mjs";
import * as ledger from "../scripts/ops/interest-ledger.mjs";

/**
 * THE LP POSITIVE LIST ADMITS ONLY REPLIES TO OUR OUTREACH.
 *
 * On 5 October 2026 seven of the thirteen names on Monique's running list were not LPs: a Google
 * Cloud sales drip ("Book a meeting with…", never a reply to anything), a vendor selling a
 * raise-capital programme, Monique's own monthly email and Porter's own mail, a school's
 * autoresponder, and two newsletters. Every one contained a positive phrase, because that is what
 * drips and newsletters say, and the reader classified on wording alone.
 *
 * EVERY FIXTURE HERE IS SYNTHETIC. LP identities are confidential and this repository is public;
 * no real name, address or quoted sentence may enter this file. Every sender is at a reserved
 * `.test` domain or one of our own, and the suite asserts that before it asserts anything else.
 *
 * The screen is driven exactly as the run drives it: a raw RFC 822 message in, a drop reason or a
 * classified candidate out. `sentByUs` is answered from a fixed set of our message-ids, the way the
 * run answers it from a Gmail search scoped to the mailbox.
 */

const MAILBOX = "sequoia@westpeek.ventures";
/** Message-ids of outreach "we" sent; a reply that threads onto one of these is a reply to us. */
const OUR_IDS = new Set(["outreach-0001@westpeek.ventures", "outreach-0002@westpeek.ventures"]);
const sentByUs = (id: string) => OUR_IDS.has(id);

type Fixture = {
  shape: string;
  raw: string;
  /** What a correct screen says about it. */
  want: { drop: true; reason: string | RegExp } | { drop: false; bucket: "call" | "warm" };
};

const msg = (headers: Record<string, string>, body: string) =>
  `${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\r\n")}\r\n\r\n${body}`;

/** The seven false-positive shapes and the two true replies. Addresses are reserved `.test` names. */
const FIXTURES: Fixture[] = [
  {
    shape: "a sales-development drip with a List-Unsubscribe header, never a reply to anything",
    raw: msg({
      From: "Cloud Sales <sdr@cloud-vendor.test>",
      To: MAILBOX,
      Subject: "Book a meeting with our startup team",
      "List-Unsubscribe": "<mailto:unsub@cloud-vendor.test>",
      "Message-Id": "<drip-1@cloud-vendor.test>",
    }, "Hi there,\r\n\r\nHappy to connect this week — book a call on my calendar and let's set up a time.\r\n"),
    want: { drop: true, reason: "bulk_list_unsubscribe" },
  },
  {
    shape: "a vendor pitching a raise-capital programme, positive wording, no thread onto our mail",
    raw: msg({
      From: "Growth Team <hello@capital-programme.test>",
      To: MAILBOX,
      Subject: "Raise your next round faster",
      "Message-Id": "<pitch-1@capital-programme.test>",
    }, "Sequoia,\r\n\r\nWe help funds like yours raise. Let's set up a call next week?\r\n"),
    want: { drop: true, reason: "not_a_reply" },
  },
  {
    shape: "Monique's own monthly email, from our own domain, quoting every positive phrase there is",
    raw: msg({
      From: "Monique <monique@sequoiataylor.com>",
      To: MAILBOX,
      Subject: "LP positive replies — 3 want a call, 2 to keep warm",
      "Message-Id": "<monthly-1@sequoiataylor.com>",
    }, "Sequoia,\r\n\r\nWANTS A CALL (3)\r\n  happy to connect ... book a call ... keep me posted\r\n"),
    want: { drop: true, reason: "own_domain" },
  },
  {
    shape: "Porter's own mail, from our other domain",
    raw: msg({
      From: "Porter <porter@joinwestpeek.com>",
      To: MAILBOX,
      Subject: "Re: website job",
      "Message-Id": "<porter-1@joinwestpeek.com>",
    }, "Preview is up — let's set up a time to look at it together.\r\n"),
    want: { drop: true, reason: "own_domain" },
  },
  {
    shape: "an institution's autoresponder, Auto-Submitted, 'keep in touch' in the canned text",
    raw: msg({
      From: "Admissions Office <admissions@some-school.test>",
      To: MAILBOX,
      Subject: "Re: Your message",
      "Auto-Submitted": "auto-replied",
      "Message-Id": "<auto-1@some-school.test>",
    }, "Thank you for writing. If your email pertains to academic competitions, please keep in touch with the office.\r\n"),
    want: { drop: true, reason: "bulk_auto_submitted" },
  },
  {
    shape: "a newsletter from a marketing platform",
    raw: msg({
      From: "Weekly Notes <weekly@substack.com>",
      To: MAILBOX,
      Subject: "This week: stay in touch with your LPs",
      "List-Id": "<weekly.substack.com>",
      "Message-Id": "<nl-1@substack.com>",
    }, "Three tips to keep in touch with investors this quarter.\r\n"),
    want: { drop: true, reason: /^bulk_/ },
  },
  {
    shape: "a fund's newsletter: no list headers at all, warm wording, and nothing of ours quoted",
    raw: msg({
      From: "Small Notes <notes@some-fund.test>",
      To: MAILBOX,
      Subject: "Small Notes #42",
      "Message-Id": "<notes-42@some-fund.test>",
    }, "This week on Small Notes: why you should keep in touch with everyone you meet. Reply any time.\r\n"),
    want: { drop: true, reason: "not_a_reply" },
  },
  {
    shape: "a TRUE reply that threads onto our outreach by In-Reply-To and offers a call",
    raw: msg({
      From: "\"A. Person\" <aperson@endowment-one.test>",
      To: MAILBOX,
      Subject: "Re: West Peek — introduction",
      "In-Reply-To": "<outreach-0001@westpeek.ventures>",
      References: "<outreach-0001@westpeek.ventures>",
      "Message-Id": "<reply-1@endowment-one.test>",
    }, "Thanks for reaching out. Happy to connect — let's set up a call next week.\r\n"),
    want: { drop: false, bucket: "call" },
  },
  {
    shape: "a TRUE reply whose headers were stripped by a gateway but whose body quotes our outreach",
    raw: msg({
      From: "B. Person <bperson@foundation-two.test>",
      To: MAILBOX,
      Subject: "Re: West Peek — introduction",
      "Message-Id": "<reply-2@foundation-two.test>",
    }, [
      "Not until October on our side, but please keep me posted and send the deck when it is ready.",
      "",
      `On Tue, 2 Sep 2026, Sequoia Taylor <${MAILBOX}> wrote:`,
      "> Hi — I lead West Peek and wanted to introduce the fund.",
    ].join("\r\n")),
    want: { drop: false, bucket: "warm" },
  },
];

describe("the LP positive screen admits only replies to our outreach", () => {
  it("has fixtures for every false-positive class and both true-reply shapes (zero fixtures is a failure)", () => {
    expect(FIXTURES.length).toBeGreaterThan(0);
    const reasons = FIXTURES.map((f) => (f.want.drop ? String(f.want.reason) : f.want.bucket));
    for (const needed of ["bulk_list_unsubscribe", "own_domain", "bulk_auto_submitted", "not_a_reply", "call", "warm"]) {
      expect(reasons, `no fixture exercises ${needed}`).toContain(needed);
    }
    expect(FIXTURES.filter((f) => f.want.drop).length).toBe(7);
    expect(FIXTURES.filter((f) => !f.want.drop).length).toBe(2);
  });

  it("carries no real identity: every sender is at a reserved .test domain, a known marketing platform, or our own", () => {
    for (const f of FIXTURES) {
      const from = bulk.addressIn(bulk.headersFromRaw(f.raw).from);
      expect(from, f.shape).toMatch(/@(?:[\w.-]+\.test|substack\.com|westpeek\.ventures|sequoiataylor\.com|joinwestpeek\.com)$/);
    }
  });

  for (const f of FIXTURES) {
    it(f.shape, async () => {
      const r = await screenMessage(f.raw, { mailbox: MAILBOX, sentByUs });
      if (f.want.drop) {
        expect(r.drop, `expected a drop, got ${JSON.stringify(r)}`).toBe(true);
        if (r.drop) expect(r.reason).toMatch(f.want.reason instanceof RegExp ? f.want.reason : new RegExp(`^${f.want.reason}$`));
      } else {
        expect(r.drop, `expected a candidate, got ${JSON.stringify(r)}`).toBe(false);
        if (!r.drop) expect(r.bucket).toBe(f.want.bucket);
      }
    });
  }

  it("the structural filter is ONE module: the ledger and the LP reader share the same function", () => {
    expect(ledger.bulkReason).toBe(bulk.bulkReason);
  });

  it("a quoted address counts as reply evidence only in quoting position, not in an unsubscribe link", () => {
    expect(bulk.quotesMailbox(`Unsubscribe: https://x.test/u?email=${MAILBOX}`, MAILBOX)).toBe(false);
    expect(bulk.quotesMailbox(`On Mon, Sequoia <${MAILBOX}> wrote:\n> hi`, MAILBOX)).toBe(true);
    expect(bulk.quotesMailbox(`> From: ${MAILBOX}`, MAILBOX)).toBe(true);
  });
});

describe("the running list is reconciled on every run: rejected entries leave, out loud; unseen entries stay", () => {
  const person = (address: string, bucket: "call" | "warm", first_seen: string) => ({ address, name: "", bucket, first_seen, quote: "" });

  it("removes the seven shapes with their reasons and keeps the two true replies", () => {
    const existing = [
      person("sdr@cloud-vendor.test", "call", "2026-07-17"),
      person("hello@capital-programme.test", "call", "2026-08-28"),
      person("monique@sequoiataylor.com", "call", "2026-09-15"),
      person("porter@joinwestpeek.com", "warm", "2026-09-22"),
      person("admissions@some-school.test", "warm", "2026-07-01"),
      person("weekly@substack.com", "warm", "2026-07-13"),
      person("notes@some-fund.test", "warm", "2026-09-09"),
      person("aperson@endowment-one.test", "call", "2026-08-15"),
      person("bperson@foundation-two.test", "warm", "2026-08-30"),
    ];
    const rejected = new Map([
      ["sdr@cloud-vendor.test", "bulk_list_unsubscribe"],
      ["hello@capital-programme.test", "not_a_reply"],
      ["admissions@some-school.test", "bulk_auto_submitted"],
      ["weekly@substack.com", "bulk_list_id"],
      ["notes@some-fund.test", "not_a_reply"],
    ]);
    const accepted = new Set(["aperson@endowment-one.test", "bperson@foundation-two.test"]);
    const found = new Map([
      ["aperson@endowment-one.test", person("aperson@endowment-one.test", "call", "2026-08-15")],
      ["bperson@foundation-two.test", person("bperson@foundation-two.test", "call", "2026-08-30")],
    ]);
    const out = reconcileList(existing, { found, accepted, rejected });
    expect(out.removed.map((r) => r.address).sort()).toEqual([
      "admissions@some-school.test", "hello@capital-programme.test", "monique@sequoiataylor.com",
      "notes@some-fund.test", "porter@joinwestpeek.com", "sdr@cloud-vendor.test", "weekly@substack.com",
    ]);
    // Our own domains are removed on the domain alone, even when this run never saw a message from them.
    expect(out.removed.find((r) => r.address === "monique@sequoiataylor.com")?.reason).toBe("own_domain");
    expect(out.removed.find((r) => r.address === "sdr@cloud-vendor.test")?.reason).toBe("bulk_list_unsubscribe");
    expect(out.people.map((p) => p.address)).toEqual(["aperson@endowment-one.test", "bperson@foundation-two.test"]);
    expect(out.promoted).toBe(1);
    expect(out.people.find((p) => p.address === "bperson@foundation-two.test")?.bucket).toBe("call");
  });

  it("an entry this run did not see at all is kept — windowing never drops an LP", () => {
    const existing = [person("cperson@trust-three.test", "warm", "2026-07-20")];
    const out = reconcileList(existing, { found: new Map(), accepted: new Set(), rejected: new Map() });
    expect(out.people.map((p) => p.address)).toEqual(["cperson@trust-three.test"]);
    expect(out.removed).toEqual([]);
  });

  it("an address accepted on one message is not removed because another of its messages was rejected", () => {
    const existing = [person("aperson@endowment-one.test", "call", "2026-08-15")];
    const out = reconcileList(existing, {
      found: new Map(), accepted: new Set(["aperson@endowment-one.test"]),
      rejected: new Map([["aperson@endowment-one.test", "bulk_auto_subject"]]),
    });
    expect(out.people).toHaveLength(1);
  });
});
