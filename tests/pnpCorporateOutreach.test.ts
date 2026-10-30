// @ts-nocheck -- Mac ESM runner: injected effects never reach live services.
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { blocked, contactRules, parseContract, renderEmail, planSends, stopReason, validProspect, chicagoDay, assertStatus } from "../src/shared/boss/pnp/outreach.mjs";
import { runOutreach, publishedProspect, research, senderClient, writeProgress } from "../scripts/ops/pnp-corporate-outreach.mjs";
import { renderPlist } from "../scripts/ops/render-pnp-outreach-plist.mjs";
import { readMorningSections, clearToldSections } from "../src/shared/boss/mail/morning.mjs";
import { buildDay } from "../scripts/ops/your-day.mjs";

const NOW = Date.parse("2026-11-12T16:20:00Z");
const status = (extra = {}) => ({ sent_today: 0, followups_today: 0, suppressed: [], taken_over: [], replies: [], corporate_booked: 0, stopped: null, do_not_contact: [], ...extra });
const prospect = (i = 1, extra = {}) => ({ id: `test_${i}`, company: `Example Office ${i}`, domain: `office${i}.example.test`, contact_first: "Jordan", contact_email: `office@office${i}.example.test`, role: "office manager", kind: "party", line: "Your office serves the local community.", source_url: "https://example.test/contact", line_source_url: "https://example.test/about", state: "verified", nb_verdict: "valid", ...extra });
const template = parseContract(fs.readFileSync("tests/fixtures/pnp/contract.txt", "utf8"));
const firstText = "Hi Jordan,\n\nI run Example Decor, a Memphis decorating team. Your office serves the local community.\n\nEach December we put up Christmas decor for offices and lobbies (tree, garland, entry and reception styling) and decorate company holiday parties. We set everything up before anyone arrives and take it all down after.\n\nWe keep it small, just 4 business bookings this December, mostly weekday installs so your office isn't disrupted.\n\nIf Example Office 1 has anything planned, send your date and space here and we'll come back with ideas and a quote:\nexample.test/request\n\nAlex\nExample Decor";

function harness(rows = [prospect()], extra = {}) {
  const sender = { status: vi.fn(async () => status()), settings: vi.fn(async () => ({ do_not_contact: [] })), send: vi.fn(async () => ({ ok: true, message_id: "<synthetic-message>" })) };
  const desk = { get: vi.fn(async () => ({ rows })), post: vi.fn(async () => ({ claimed: true })) };
  return { now: NOW, live: true, sender, desk, template, discover: vi.fn(async () => []), published: vi.fn(async () => true), verify: vi.fn(async () => ({ verdicts: [] })), preview: vi.fn(), report: vi.fn(), recordStop: vi.fn(), ...extra };
}

describe("approved campaign text", () => {
  it("template exactness: party, lobby and only follow-up are verbatim", () => {
    expect(renderEmail(template, prospect())).toEqual({ subject: "Christmas decor for Example Office 1?", text: firstText });
    expect(renderEmail(template, prospect(1, { kind: "lobby" })).text).toBe(firstText.replace("Each December we put up Christmas decor for offices and lobbies (tree, garland, entry and reception styling) and decorate company holiday parties. We set everything up before anyone arrives and take it all down after.", "Each December we decorate building lobbies (tree, garland, entry and front-desk styling) for the season, installed on a weekday morning and taken down in January."));
    expect(renderEmail(template, prospect(), true)).toEqual({ subject: "Re: Christmas decor for Example Office 1?", text: "Hi Jordan, bringing this back up in case holiday decor is still on your list. We only take 4 business jobs in December, so earlier dates are easier to hold.\n\nIf it's not for this year, no worries at all.\n\nAlex\nExample Decor" });
    expect(() => parseContract("no approved copy")).toThrow();
    // The fixture carries a FOOTER section after the follow-up, as the real contract does: it is the sender's, never the words.
    expect(fs.readFileSync("tests/fixtures/pnp/contract.txt", "utf8")).toMatch(/\nFOOTER/);
    expect(template.followup).not.toMatch(/FOOTER|mailing_address/);
  });
});

describe("sequence limits", () => {
  it("cap 12/day includes earlier and uncertain attempts; building managers first", () => {
    const rows = Array.from({ length: 20 }, (_, i) => prospect(i, { kind: i > 14 ? "lobby" : "party" }));
    expect(planSends(rows, status(), NOW)).toHaveLength(12);
    expect(planSends(rows, status(), NOW).slice(0, 5).every((s) => s.row.kind === "lobby")).toBe(true);
    expect(planSends(rows, status({ sent_today: 11 }), NOW)).toHaveLength(1);
    expect(planSends(rows, status({ sent_today: 12 }), NOW)).toHaveLength(0);
    const attempted = rows.slice(0, 12).map((r) => ({ ...r, first_attempt_at: NOW }));
    expect(planSends([...attempted, ...rows.slice(12)], status(), NOW)).toHaveLength(0);
  });
  it("follow-up max 1, after five days and in the first thread", async () => {
    const sent = prospect(1, { state: "sent1", first_message_id: "<first-synthetic>", first_sent_at: NOW - 5 * 86400000 });
    expect(planSends([sent], status(), NOW).map((s) => s.touch)).toEqual([2]);
    for (const change of [{ first_sent_at: NOW - 4 * 86400000 }, { first_message_id: null }, { state: "sent2" }, { followup_attempt_at: NOW }, { followup_sent_at: NOW }]) expect(planSends([{ ...sent, ...change }], status(), NOW)).toEqual([]);
    const h = harness([sent]); await runOutreach(h);
    expect(h.sender.send.mock.calls[0][0].in_reply_to).toBe("<first-synthetic>");
    expect(planSends(Array.from({ length: 30 }, (_, i) => ({ ...sent, id: `follow_${i}` })), status(), NOW)).toHaveLength(15);
  });
  it("stop at 4 booked before research, verification or any desk access", async () => {
    const h = harness(); h.sender.status.mockResolvedValue(status({ corporate_booked: 4 }));
    expect((await runOutreach(h)).stopped).toMatch(/4/);
    expect(h.desk.get).not.toHaveBeenCalled(); expect(h.discover).not.toHaveBeenCalled(); expect(h.verify).not.toHaveBeenCalled(); expect(h.sender.send).not.toHaveBeenCalled();
    expect(stopReason(status({ corporate_booked: 3 }), NOW)).toBeNull();
    expect(planSends([prospect()], status({ corporate_booked: 4 }), NOW)).toEqual([]);
  });
  it("stop after December 5 in Chicago, including UTC date boundaries", async () => {
    expect(chicagoDay(Date.parse("2026-12-06T05:59:59Z"))).toBe("2026-12-05");
    expect(stopReason(status(), Date.parse("2026-12-06T05:59:59Z"))).toBeNull();
    const h = harness([], { now: Date.parse("2026-12-06T06:00:00Z") });
    expect((await runOutreach(h)).stopped).toMatch(/finished/);
    expect(h.desk.get).not.toHaveBeenCalled(); expect(h.sender.send).not.toHaveBeenCalled();
    expect(planSends([prospect()], status(), Date.parse("2026-12-04T16:20:00Z"))).toHaveLength(1);
  });
  it("weekends and sender stops do no research or sending", async () => {
    for (const extra of [{ now: Date.parse("2026-11-14T16:20:00Z") }, {}]) {
      const h = harness([], extra); if (!extra.now) h.sender.status.mockResolvedValue(status({ stopped: "Season held." }));
      await runOutreach(h); expect(h.desk.get).not.toHaveBeenCalled(); expect(h.sender.send).not.toHaveBeenCalled();
    }
  });
  it("do-not-contact skip covers company, domain and subdomain and never guesses missing settings", () => {
    expect(planSends([prospect()], status({ do_not_contact: ["EXAMPLE OFFICE 1"] }), NOW)).toEqual([]);
    expect(planSends([prospect()], status({ do_not_contact: ["office1.example.test"] }), NOW)).toEqual([]);
    expect(blocked(prospect(), status({ do_not_contact: ["example.test"] }))).toBe("skipped");
    expect(() => contactRules({})).toThrow(); expect(() => assertStatus({ stopped: null })).toThrow();
  });
  it("suppression, takeover and real replies stop the entire domain; OOO does not", () => {
    for (const state of ["suppressed", "taken_over"]) expect(blocked(prospect(), status({ [state]: ["colleague@office1.example.test"] }))).toBe(state);
    expect(blocked(prospect(), status({ replies: [{ email: "colleague@office1.example.test", kind: "question" }] }))).toBe("replied");
    expect(blocked(prospect(), status({ replies: [{ email: prospect().contact_email, kind: "auto_reply" }] }))).toBeNull();
  });
  it("only NeverBounce valid can be sent", () => {
    for (const verdict of [null, "invalid", "catchall", "unknown", "disposable"]) expect(planSends([prospect(1, { nb_verdict: verdict })], status(), NOW)).toEqual([]);
  });
  it("dry run researches and previews but sends nothing and makes no writes or NeverBounce calls", async () => {
    const h = harness([prospect()], { live: false });
    h.discover.mockResolvedValue([prospect(2), prospect(2, { contact_email: "other@office2.example.test" }), { ...prospect(3), source_url: "" }]);
    const r = await runOutreach(h);
    expect(h.discover).toHaveBeenCalledTimes(1); expect(r.candidates).toBe(1);
    expect(h.sender.send).not.toHaveBeenCalled(); expect(h.desk.post).not.toHaveBeenCalled(); expect(h.verify).not.toHaveBeenCalled(); expect(h.report).not.toHaveBeenCalled(); expect(h.recordStop).not.toHaveBeenCalled();
    expect(h.preview.mock.calls[0][0].map((m) => m.to)).toEqual([prospect(1).contact_email, prospect(2).contact_email]);
    expect(h.preview.mock.calls[0][0][1].text).toBe(firstText.replaceAll("Example Office 1", "Example Office 2"));
  });
  it("an unreadable service lets only the dry run continue; live fails closed", async () => {
    const dry = harness([], { live: false }); dry.sender.status.mockRejectedValue(new Error("down")); dry.sender.settings.mockRejectedValue(new Error("down"));
    expect((await runOutreach(dry)).sent).toBe(0); expect(dry.discover).toHaveBeenCalledWith([]); expect(dry.sender.send).not.toHaveBeenCalled();
    const live = harness(); live.sender.status.mockRejectedValue(new Error("down"));
    await expect(runOutreach(live)).rejects.toThrow(); expect(live.desk.get).not.toHaveBeenCalled(); expect(live.sender.send).not.toHaveBeenCalled();
  });
  it("do-not-contact comes from status, then sender settings, then the private Mac copy; none = live stops", async () => {
    const bare = () => { const s = status(); delete s.do_not_contact; return s; };
    const fromLocal = harness([prospect()], { localList: () => ["office1.example.test"] }); fromLocal.sender.status.mockResolvedValue(bare()); fromLocal.sender.settings.mockResolvedValue(null);
    await runOutreach(fromLocal); expect(fromLocal.sender.send).not.toHaveBeenCalled();
    const fromSettings = harness([prospect()]); fromSettings.sender.status.mockResolvedValue(bare()); fromSettings.sender.settings.mockResolvedValue({ do_not_contact: ["Example Office 1"] });
    await runOutreach(fromSettings); expect(fromSettings.sender.send).not.toHaveBeenCalled();
    const none = harness([prospect()]); none.sender.status.mockResolvedValue(bare()); none.sender.settings.mockResolvedValue(null);
    await expect(runOutreach(none)).rejects.toThrow(/do-not-contact/i); expect(none.discover).not.toHaveBeenCalled(); expect(none.sender.send).not.toHaveBeenCalled();
    const f = vi.fn(async () => new Response("missing", { status: 404 }));
    expect(await senderClient({ origin: "https://campaign.example.test", token: "t" }, f).settings()).toBeNull();
    await expect(senderClient({ origin: "https://campaign.example.test", token: "t" }, f).status()).rejects.toThrow();
  });
  it("rechecks status before every send; a new reply or booking blocks the pending touch", async () => {
    for (const update of [{ taken_over: [prospect().contact_email] }, { corporate_booked: 4 }]) {
      const h = harness(); h.sender.status.mockResolvedValueOnce(status()).mockResolvedValue(status(update));
      await runOutreach(h); expect(h.sender.send).not.toHaveBeenCalled();
    }
    const h = harness(); h.desk.post.mockResolvedValue({ claimed: false }); await runOutreach(h); expect(h.sender.send).not.toHaveBeenCalled();
  });
});

describe("published research", () => {
  it("no guessed email: source_url and actual public evidence are required", async () => {
    expect(validProspect({ ...prospect(), source_url: "" })).toBe(false);
    expect(planSends([{ ...prospect(), source_url: "" }], status(), NOW)).toEqual([]);
    const read = vi.fn(async () => new Response(`<a href="mailto:${prospect().contact_email}">Contact</a><p>${prospect().line}</p>`, { headers: { "content-type": "text/html" } }));
    expect(await publishedProspect(prospect(), read)).toBe(true);
    expect(await publishedProspect({ ...prospect(), contact_email: "guessed@office1.example.test" }, read)).toBe(false);
    expect(await publishedProspect({ ...prospect(), line: "An invented claim." }, read)).toBe(false);
    expect(await publishedProspect({ ...prospect(), source_url: "https://127.0.0.1/page" }, read)).toBe(false);
  });
  it("research dedupes by domain, skips exclusions and verifies before sending", async () => {
    const h = harness([prospect(9, { state: "found", nb_verdict: null })]);
    h.discover.mockResolvedValue([prospect(2), prospect(2), prospect(3), { ...prospect(4), source_url: "" }]);
    h.sender.status.mockResolvedValue(status({ do_not_contact: ["office3.example.test"] }));
    h.verify.mockResolvedValue({ verdicts: [{ email: prospect(9).contact_email, result: "valid" }] });
    await runOutreach(h);
    expect(h.discover).toHaveBeenCalledTimes(1);
    expect(h.desk.post.mock.calls.find(([p, b]) => b.op === "import")[1].rows).toEqual([prospect(2)]);
    expect(h.desk.post.mock.calls.some(([p, b]) => b.op === "verdict" && b.verdict === "valid")).toBe(true);
  });
  it("uses the registered subscription seats in order, with search and no paid fallback", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pnp-seat-"));
    const calls = [];
    const runSpawn = vi.fn();
    const exec = (seat, result) => async () => async (input, opts) => { calls.push(seat); opts.spawnImpl(seat, ["exec"], {}); return result; };
    try {
      const rows = await research([], { scratchRoot: root, usable: () => ({ ok: true }), runSpawn, executors: { bk_codex: exec("codex", { error: "unavailable" }), bk_claude_code: exec("claude", { delivers: { prospects: [] } }) } });
      expect(rows).toEqual([]); expect(calls).toEqual(["codex", "claude"]);
      expect(runSpawn.mock.calls[0][1][0]).toBe("--search"); expect(runSpawn.mock.calls[1][1]).toContain("--max-turns");
      expect(fs.readdirSync(root)).toEqual([]);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it("bearer token is sent only to the outreach service", async () => {
    const f = vi.fn(async () => Response.json(status()));
    const client = senderClient({ origin: "https://campaign.example.test", token: "synthetic-token" }, f);
    await client.status(); expect(String(f.mock.calls[0][0])).toBe("https://campaign.example.test/api/outreach/status?since=2026-10-30");
    expect(f.mock.calls[0][1].headers.authorization).toBe("Bearer synthetic-token"); expect(f.mock.calls[0][1].redirect).toBe("error");
  });
});

describe("morning and schedule", () => {
  it("shows the exact progress line in the real morning email and says finished once", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pnp-morning-"));
    const options = { dir, stateFile: path.join(dir, ".progress.json"), now: NOW };
    try {
      writeProgress({ status: status({ sent_today: 3, followups_today: 1, taken_over: [prospect().contact_email], corporate_booked: 2 }), stopped: null }, options);
      const morning = readMorningSections({ dir, now: NOW }).sections;
      expect(morning.pnp_outreach.lines).toEqual(["Camille, office Christmas outreach: 4 sent · 1 forwarded to you · 2 booked of 4"]);
      const mail = buildDay({ diary: [], tasks: [], approvals: [], repoChanges: [], feed: { items: [] }, morning }, NOW);
      expect(mail.text).toContain(morning.pnp_outreach.lines[0]);
      writeProgress({ status: status({ corporate_booked: 4 }), stopped: "Full" }, options);
      expect(readMorningSections({ dir, now: NOW }).sections.pnp_outreach.lines[0]).toContain("finished");
      clearToldSections(["pnp_outreach"], { dir });
      writeProgress({ status: status({ corporate_booked: 4 }), stopped: "Full" }, options);
      expect(readMorningSections({ dir, now: NOW }).sections.pnp_outreach).toBeUndefined();
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it("renders weekdays at 10:20 Central, shifted for the coordinator's Mac, without loading", () => {
    const xml = renderPlist({ repo: "/tmp/example-repo", logs: "/tmp/example-logs", offset: 1 });
    expect(xml.match(/<integer>11<\/integer>/g)).toHaveLength(5);
    expect(xml.match(/<integer>20<\/integer>/g)).toHaveLength(5);
    expect(xml).toContain("--live"); expect(xml).toContain("duty-run.sh pnp-corporate-outreach.mjs"); expect(xml).not.toMatch(/__\w+__/);
  });
});
