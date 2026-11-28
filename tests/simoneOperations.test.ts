import { expect, it, vi } from "vitest";
import { checkOperations, readArrivals, receiptFor, rowAddresses } from "../scripts/ops/lib/simone-operations.mjs";
import { buildDay } from "../scripts/ops/your-day.mjs";

const day = "2026-11-23";
const NOW = Date.parse("2026-11-23T15:00:00Z");
const existing = { id: "office-outreach", name: "Existing job", what: "Check reservations",
  trigger: { launchd: ["com.seq.office-outreach"] } };
const campaign = { id: "pnp-corporate-outreach", name: "Office outreach", what: "Deliver office replies",
  trigger: { duty: "duty-office", launchd: ["com.seq.pnp-outreach"] } };
const RESEND = "0a1b2c3d-1111-4222-8333-444455556666";
// A reply on 21 Nov, "forwarded" by the mailer, but on no morning email: the 22 and 23 Nov mornings went without it.
const feed = { replies: [{ id: "in1", kind: "reply", email: "office@example.test", at: "2026-11-21T17:00:00Z", forward_handed_at: "2026-11-21T17:00:01Z", message_id: "<r1@example.test>", text: "Can you quote?", auth: "pass" }] };
const morning = (d: string, keys: string[] = []) => ({ day: d, built_at: Date.parse(`${d}T12:40:00Z`), sent_at: Date.parse(`${d}T12:41:00Z`), keys,
  mail: { id: RESEND, message_id: `<yd-${d}@example.test>`, from_addr: "simone@sequoiataylor.com", layout: "digest", sent_at: Date.parse(`${d}T12:41:00Z`) } });
const arrivals = { sent: [{ id: RESEND, message_id: "<m1@example.test>", from_addr: "simone@sequoiataylor.com", layout: "digest", sent_at: Date.parse("2026-11-22T12:41:00Z") }],
  mornings: [morning("2026-11-22"), morning("2026-11-23")] };

function fixture(resend = vi.fn(async () => "delivered"), replyFeed: unknown = feed) {
  const receipts = readArrivals({ arrivals, feed: replyFeed as never, resend, now: NOW });
  return {
    schedule: { rows: [existing, campaign, { id: "worker", name: "Worker heartbeat", what: "Check the public result",
      trigger: { repo: "boss-os", file: "wrangler.toml", crons: ["0 * * * *"] } }] },
    scorecard: { exempt: { worker: { kind: "system", reason: "scheduler" } }, rows: [{ id: "office", initiative: "Bookings", result: "Bookings in the database",
      jobs: [existing.id, campaign.id], real: { label: "new bookings" } }] },
    senders: { rows: [{ id: campaign.id, sender: "Camille", what: "Bring each reply to the owner" },
      { id: "simone-your-day", sender: "Simone", from: "Simone <simone@sequoiataylor.com>", what: "The morning email" }] },
    sites: { rows: [{ id: "site", name: "Site", url: "https://example.test", status: "live" }] },
    inputs: { duties: [{ id: "duty-office", name: "Forward office replies", employeeId: "camille", scheduled: true }],
      agents: [{ id: "camille", name: "Camille", role: "Operations" }],
      mailboxes: [{ id: campaign.id, name: "Office replies", handler: "outreach" }] },
    launchd: { configured: new Set(["com.seq.pnp-outreach", "com.seq.unlisted-from-code"]),
      loaded: new Set(["com.seq.pnp-outreach", "com.seq.running-unlisted"]), disabled: new Set<string>() },
    files: [{ repo: "boss-os", files: [{ file: "wrangler.toml", crons: ["0 * * * *", "*/3 * * * *"] }], active: null }],
    deployed: new Map([["boss-os:wrangler.toml", new Set(["*/3 * * * *"])]]),
    readSite: async () => ({ state: "verified", evidence: "Public HTML served." }),
    readScore: async () => ({ state: "verified", evidence: "Two booking records read." }),
    readOutreach: async () => (await receipts).replies,
    readSender: async (row: { runs?: string; from?: string }) => (await receipts).forSender(row),
    day,
  };
}

it("checks runtime and code coverage, reports a reply that never reached a morning email despite the forward, and renders the daily note", async () => {
  const report = await checkOperations(fixture());
  expect(report.rows).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "com.seq.unlisted-from-code", coverage: "unlisted" }),
    expect.objectContaining({ id: "com.seq.running-unlisted", coverage: "unlisted" }),
    expect.objectContaining({ id: "com.seq.office-outreach", coverage: "not_running" }),
    expect.objectContaining({ kind: "worker_cron", coverage: "unlisted" }),
    expect.objectContaining({ name: "Worker heartbeat", coverage: "not_running" }),
    expect.objectContaining({ kind: "agent", state: "no_proof" }),
    expect.objectContaining({ kind: "duty", id: "duty-office", state: "missing" }),
    expect.objectContaining({ kind: "mailbox", id: campaign.id, state: "missing" }),
    expect.objectContaining({ kind: "sender", id: "simone-your-day", state: "verified" }),
    expect.objectContaining({ kind: "initiative", state: "verified" }),
    expect.objectContaining({ kind: "site", state: "verified" }),
  ]));
  const misses = report.issues.filter((line: string) => /office replies/.test(line));
  expect(misses).toHaveLength(1);
  expect(misses[0]).toMatch(/^NOT WORKING: .*Not arrived: 1 of 1 office replies in your morning email/);
  expect(JSON.stringify(report)).not.toContain("office@example.test");
  expect(JSON.stringify(report)).not.toContain("Can you quote");
  const note = buildDay({ diary: [], tasks: [], approvals: [], repoChanges: [], briefing: null, feed: { items: [] },
    morning: { operations: { lines: [...misses, report.proposal] } } }, NOW);
  expect(note.text).toContain("Simone’s operating check");
  expect(note.text).toContain(misses[0]);
});

it("a reply carried on a morning email that arrived is proven; one before any morning is still due", async () => {
  const key = "reply:pnp:<r1@example.test>";
  const carried = { ...arrivals, mornings: [morning("2026-11-22", [key]), morning("2026-11-23")] };
  const proven = await readArrivals({ arrivals: carried, feed, resend: async () => "delivered", now: NOW });
  expect(proven.replies).toMatchObject({ state: "verified" });
  // The morning that carried it bounced: not arrived, whatever the forward said.
  const bounced = await readArrivals({ arrivals: carried, feed, resend: async (row: { message_id?: string | null }) => (String(row.message_id).includes("2026-11-22") ? "bounced" : "delivered"), now: NOW });
  expect(bounced.replies).toMatchObject({ state: "missing" });
  const fresh = { replies: [{ ...feed.replies[0], at: "2026-11-23T14:00:00Z" }] };
  expect((await readArrivals({ arrivals, feed: fresh, resend: async () => "delivered", now: NOW })).replies).toMatchObject({ state: "nothing_due" });
});

it("an outage or an empty read is couldn't-check, never arrived (rule 0)", async () => {
  const down = await checkOperations(fixture(vi.fn(async () => { throw Error("provider down"); })));
  expect(down.rows.find((r: { id: string }) => r.id === "simone-your-day")).toMatchObject({ state: "unknown" });
  expect(down.issues).toContainEqual(expect.stringMatching(/^COULDN'T CHECK: .*Couldn't check 1 of 1 emails from simone@sequoiataylor.com yesterday/));
  expect(await receiptFor({ id: "pending:abc", message_id: "<x@example.test>", sent_at: NOW - 1e7 }, { now: NOW })).toBe("unknown");
  expect(await receiptFor({ id: RESEND, sent_at: NOW - 1e7 }, { resend: async () => "sent", now: NOW })).toBe("not_arrived");
  expect(await receiptFor({ id: RESEND, sent_at: NOW - 60_000 }, { resend: async () => "sent", now: NOW })).toBe("pending");
  // Her Gmail, when Boss OS may read it: found is arrived; absent past the window is not.
  expect(await receiptFor({ id: "pending:a", message_id: "<x@example.test>", sent_at: NOW - 1e7 }, { mailbox: async () => true, now: NOW })).toBe("arrived");
  expect(await receiptFor({ id: "pending:a", message_id: "<x@example.test>", sent_at: NOW - 1e7 }, { mailbox: async () => false, now: NOW })).toBe("not_arrived");
  const noFeed = await readArrivals({ arrivals, feed: null, resend: async () => "delivered", now: NOW });
  expect(noFeed.replies).toMatchObject({ state: "unknown" });
  const nothing = await readArrivals({ arrivals: { sent: [], mornings: [] }, feed, resend: async () => "delivered", now: NOW });
  expect(nothing.forSender({ from: "Simone <simone@sequoiataylor.com>" })).toMatchObject({ state: "unknown" });
  expect(nothing.replies).toMatchObject({ state: "unknown" });
  await expect(readArrivals({ arrivals: undefined as never, feed, now: NOW })).rejects.toThrow("arrival inputs");
  expect(rowAddresses({ runs: "folded" })).toEqual(["digest"]);
  expect(rowAddresses({ from: "Wynn <wynn@joinwestpeek.com>" })).toEqual([]);
  const empty = fixture();
  empty.inputs.duties = [];
  await expect(checkOperations(empty)).rejects.toThrow("OPERATIONS_LIST_EMPTY");
});

it("gives Simone a daily registry verdict for a handled source, zero output, and unavailable evidence", async () => {
  const args = fixture();
  const job = { owner: "Camille", kind: "reads-meaning", source: { count: "duty-input" }, handled: { count: "duty-handled" } };
  const schedule = {
    ...args.schedule,
    rows: [...args.schedule.rows, { id: "daily-check", name: "Daily source", what: "Read the source",
      slots: ["daily 04:00"], trigger: { duty: "duty-source" } }],
    workerJobs: { "daily-check": job },
  };
  const read = async (duties: Record<string, { source: number; handled: number }> | null) => {
    const inputs = { ...args.inputs, workerEvidence: { day: "2026-11-22", duties } };
    const report = await checkOperations({ ...args, schedule, inputs });
    return { row: report.rows.find(({ id }) => id === "worker-check:daily-check"), issues: report.issues };
  };
  expect((await read({ "duty-source": { source: 2, handled: 2 } })).row).toMatchObject({ state: "verified" });
  expect(await read({ "duty-source": { source: 2, handled: 0 } })).toMatchObject({
    row: { state: "missing" },
    issues: expect.arrayContaining(["NOT WORKING: Camille · Daily source — 2026-11-22: handled 0 of 2 source items."]),
  });
  expect((await read(null)).row).toMatchObject({ state: "unknown", evidence: expect.stringContaining("couldn't check") });
});
