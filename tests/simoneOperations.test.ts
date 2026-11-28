import { expect, it, vi } from "vitest";
import { checkOperations, outreachReceipt } from "../scripts/ops/lib/simone-operations.mjs";
import { buildDay } from "../scripts/ops/your-day.mjs";

const day = "2026-11-23";
const existing = { id: "office-outreach", name: "Existing job", what: "Check reservations",
  trigger: { launchd: ["com.seq.office-outreach"] } };
const campaign = { id: "pnp-corporate-outreach", name: "Office outreach", what: "Deliver office replies",
  trigger: { duty: "duty-office", launchd: ["com.seq.pnp-outreach"] } };
const source = { sent_today: 0, followups_today: 0, corporate_booked: 0, suppressed: [], taken_over: [], stopped: null,
  replies: [{ kind: "reply", email: "office@example.test", at: "2026-11-22T17:00:00Z", forwarded_at: "2026-11-22T17:01:00Z" }] };

function fixture(gmail = vi.fn(async (_query: string) => [] as { id: string }[])) {
  return {
    schedule: { rows: [existing, campaign, { id: "worker", name: "Worker heartbeat", what: "Check the public result",
      trigger: { repo: "boss-os", file: "wrangler.toml", crons: ["0 * * * *"] } }] },
    scorecard: { exempt: { worker: { kind: "system", reason: "scheduler" } }, rows: [{ id: "office", initiative: "Bookings", result: "Bookings in the database",
      jobs: [existing.id, campaign.id], real: { label: "new bookings" } }] },
    senders: { rows: [{ id: campaign.id, sender: "Camille", what: "Bring each reply to the owner" }] },
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
    readOutreach: () => outreachReceipt(source, gmail),
    day,
  };
}

it("checks runtime and code coverage, reports missed delivery despite the forwarded mark, and renders the daily note", async () => {
  const gmail = vi.fn(async () => []);
  const report = await checkOperations(fixture(gmail));
  expect(report.rows).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "com.seq.unlisted-from-code", coverage: "unlisted" }),
    expect.objectContaining({ id: "com.seq.running-unlisted", coverage: "unlisted" }),
    expect.objectContaining({ id: "com.seq.office-outreach", coverage: "not_running" }),
    expect.objectContaining({ kind: "worker_cron", coverage: "unlisted" }),
    expect.objectContaining({ name: "Worker heartbeat", coverage: "not_running" }),
    expect.objectContaining({ kind: "agent", state: "no_proof" }),
    expect.objectContaining({ kind: "duty", id: "duty-office", state: "missing" }),
    expect.objectContaining({ kind: "mailbox", id: campaign.id, state: "missing" }),
    expect.objectContaining({ kind: "initiative", state: "verified" }),
    expect.objectContaining({ kind: "site", state: "verified" }),
  ]));
  expect(gmail).toHaveBeenCalledOnce();
  expect(gmail).toHaveBeenCalledWith(expect.stringContaining("from:office@example.test"));
  const misses = report.issues.filter((line: string) => /Owner's mailbox/.test(line));
  expect(misses).toHaveLength(1);
  expect(misses[0]).toMatch(/^NOT WORKING: .*found no copy/);
  expect(JSON.stringify(report)).not.toContain("office@example.test");
  const now = Date.parse(day + "T12:00:00Z");
  const note = buildDay({ diary: [], tasks: [], approvals: [], repoChanges: [], briefing: null, feed: { items: [] },
    morning: { operations: { lines: [...misses, report.proposal] } } }, now);
  expect(note.text).toContain("Simone’s operating check");
  expect(note.text).toContain(misses[0]);
  expect(note.text).toContain("This week");
});

it("keeps Gmail outages and ambiguous matches open, and errors if an inventory source returns zero rows", async () => {
  const denied = vi.fn(async () => { throw Error("provider down"); });
  const report = await checkOperations(fixture(denied));
  expect(report.issues).toContainEqual(expect.stringMatching(/^COULDN'T CHECK: .*couldn't confirm 1 recorded outreach reply/));
  expect(report.rows.find((row: { kind: string }) => row.kind === "mailbox")).toMatchObject({ state: "unknown" });
  await expect(outreachReceipt(source, async () => [{ id: "unrelated" }])).resolves.toMatchObject({ state: "unknown" });
  await expect(outreachReceipt({ ...source, replies: [{ ...source.replies[0], message_id: "<exact@example.test>" }] },
    async (query: string) => query.startsWith("rfc822msgid:exact@example.test") ? [{ id: "found" }] : [])).resolves.toMatchObject({ state: "verified" });
  const empty = fixture();
  empty.inputs.duties = [];
  await expect(checkOperations(empty)).rejects.toThrow("OPERATIONS_LIST_EMPTY");
});
