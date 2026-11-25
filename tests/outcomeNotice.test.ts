/**
 * The live outcome verdicts in Simone's morning email (her order 24 Nov 2026, after Noelle landed green and acted on
 * 0 of 11 decisions: "u said nothing yesterday"). seq-bin's post-land-check writes one Notices line per verdict
 * through scripts/ops/outcome-notice.mjs; your-day shows NOT WORKING as a red banner, the rest first in Done for you.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { noticeArgs, writeOutcomeNotice } from "../scripts/ops/outcome-notice.mjs";
import { buildDay, outcomeBanners, outcomeRank } from "../scripts/ops/your-day.mjs";
import { addMorningLines } from "../src/shared/boss/mail/morning.mjs";

const KEY = "outcome:seq23/boss-os#557:not-working";
const TEXT = "boss-os #557 Noelle acts on her decisions: NOT WORKING — saw 0 decisions acted on, needed at least 3";
const args = (key: string, text: string): any => noticeArgs(["--key", key, "--text", text]);

/** A Boss OS store that holds what the writer appended, or fails the way it is told to. */
function fakeStore({ getFails = false, drops = false } = {}) {
  const rows: any[] = [];
  const api = { get: async () => { if (getFails) throw new Error("HTTP 503"); return { rows }; } };
  const add = (section: string, body: any, opts: any) => {
    addMorningLines(section, body, opts); // the real writer, on a test dir (a test dir never posts)
    if (drops) return;
    // As the real route does: a told copy is gone, so the first append after the email starts fresh.
    let row = rows.find((r) => r.section === section);
    if (!row || row.status === "told") { if (row) rows.splice(rows.indexOf(row), 1); row = { section, status: "fresh", body: { lines: [] } }; rows.push(row); }
    row.body.lines.push(...body.lines);
  };
  return { api, add, rows };
}

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), "outcome-notice-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("outcome-notice: the arguments", () => {
  it("accepts each verdict's key and line", () => {
    expect(args(KEY, TEXT)).toEqual({ key: KEY, text: TEXT });
    expect(args("outcome:seq23/seq-bin#168:working", "seq-bin #168 verdicts posted: working — saw 2 verdict comments")).not.toHaveProperty("error");
    expect(args("outcome:seq23/seq-bin#168:not-checked:2026-11-25", "seq-bin #168 verdicts posted: NOT CHECKED — the check timed out after 5 min")).not.toHaveProperty("error");
  });
  it("refuses a bad key, an empty or long line, and a line that does not say the key's verdict", () => {
    for (const k of ["", "outcome:boss-os#557:working", "outcome:seq23/boss-os#557:fine", "outcome:seq23/boss-os#557:not-checked", "x:seq23/boss-os#1:working"]) expect(args(k, TEXT).code, k).toBe(2);
    expect(args(KEY, "").code).toBe(2);
    expect(args(KEY, `boss-os #557 x: NOT WORKING — ${"a".repeat(300)}`).code).toBe(2);
    // A NOT WORKING key whose words say "working" would tell her the opposite of the verdict.
    expect(args(KEY, "boss-os #557 Noelle acts: working — saw 3").code).toBe(2);
    expect(args("outcome:seq23/boss-os#557:working", TEXT).code).toBe(2);
  });
  it("keeps the line one sentence, so Done for you never cuts it before its verdict", () => {
    const a: any = args(KEY, "boss-os #557 Posts queued. For six businesses: NOT WORKING — saw 0. Needed 6.");
    expect(a.text).toBe("boss-os #557 Posts queued; For six businesses: NOT WORKING — saw 0; Needed 6.");
    expect(a.text.match(/[.!?](\s|$)/g)).toHaveLength(1);
  });
  it("refuses a line that names an email address (Notices never carry owner or client emails)", () => {
    expect(args(KEY, "boss-os #557 replies: NOT WORKING — none sent to pat@example.com").code).toBe(4);
  });
});

describe("outcome-notice: the write, once, proven in Boss OS", () => {
  it("writes the keyed line into notices and reads it back from Boss OS", async () => {
    const dir = tmp(); const s = fakeStore();
    await expect(writeOutcomeNotice({ key: KEY, text: TEXT }, { api: s.api, dir, add: s.add })).resolves.toEqual({ written: true, why: "kept in Boss OS" });
    const mac = JSON.parse(readFileSync(join(dir, "notices.json"), "utf8"));
    expect(mac.lines).toEqual([{ text: TEXT, key: KEY, links: [] }]);
  });
  it("replay: a second run writes nothing (one line per repo#pr+verdict)", async () => {
    const dir = tmp(); const s = fakeStore();
    await writeOutcomeNotice({ key: KEY, text: TEXT }, { api: s.api, dir, add: s.add });
    await expect(writeOutcomeNotice({ key: KEY, text: TEXT }, { api: s.api, dir, add: s.add })).resolves.toMatchObject({ written: false });
    expect(s.rows[0].body.lines).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(dir, "notices.json"), "utf8")).lines).toHaveLength(1);
  });
  it("a Mac file holding the line whose post never arrived is written again (Boss OS decides)", async () => {
    const dir = tmp();
    addMorningLines("notices", { lines: [{ text: TEXT, key: KEY, links: [] }] }, { dir });
    const s = fakeStore();
    await expect(writeOutcomeNotice({ key: KEY, text: TEXT }, { api: s.api, dir, add: s.add })).resolves.toMatchObject({ written: true });
  });
  it("Rule 0: Boss OS not holding the line after the write is a named stop, never written", async () => {
    const s = fakeStore({ drops: true });
    await expect(writeOutcomeNotice({ key: KEY, text: TEXT }, { api: s.api, dir: tmp(), add: s.add })).rejects.toMatchObject({ code: 1, message: expect.stringMatching(/NOTICE_NOT_STORED/) });
  });
  it("outage: Boss OS unreadable is a named stop before anything is written", async () => {
    const dir = tmp(); const s = fakeStore({ getFails: true });
    await expect(writeOutcomeNotice({ key: KEY, text: TEXT }, { api: s.api, dir, add: s.add })).rejects.toMatchObject({ code: 1, message: expect.stringMatching(/NOTICE_UNREAD/) });
    expect(() => readFileSync(join(dir, "notices.json"))).toThrow();
  });
  it("a told notices row does not count as written (GET hides told rows; a fresh day writes again)", async () => {
    const s = fakeStore();
    s.rows.push({ section: "notices", status: "told", body: { lines: [{ text: TEXT, key: KEY }] } });
    await expect(writeOutcomeNotice({ key: KEY, text: TEXT }, { api: s.api, dir: tmp(), add: s.add })).resolves.toMatchObject({ written: true });
  });
});

describe("your-day: outcome verdicts lead Done for you", () => {
  const NOW = Date.parse("2026-11-25T11:30:00Z");
  const line = (text: string, key?: string) => (key ? { text, key, links: [] } : { text, links: [] });
  const day = (notices: any[], told: string[] = []) =>
    buildDay({ diary: [], tasks: [], approvals: [], repoChanges: [], briefing: null, feed: { items: [] }, told: { done: told },
      morning: { notices: { section: "notices", at: new Date(NOW).toISOString(), decide: [], rows: [], lines: notices } } }, NOW);
  const doneText = (d: any) => String(d.text);

  it("ranks NOT CHECKED, then working, then everything else", () => {
    expect([
      line("x"), line("w", "outcome:seq23/a#1:working"), line("c", "outcome:seq23/a#2:not-checked:2026-11-25"),
    ].sort((a, b) => outcomeRank(a) - outcomeRank(b)).map((l) => l.text)).toEqual(["c", "w", "x"]);
  });
  // Review of #567 (24 Nov 2026): a failure is never in the green "Done for you" box. It is a red banner at the
  // top of the email, beside stopped jobs, and says NOT WORKING.
  it("in the real email: a NOT WORKING verdict is a red banner above Decide, never a Done for you line", () => {
    const d = day([
      line("Monique sent 4 follow-ups."), line("Danielle fixed the sitemap."),
      line("seq-bin #168 verdicts posted: working — saw 2 verdict comments", "outcome:seq23/seq-bin#168:working"),
      line(TEXT, KEY),
    ]);
    const text = doneText(d);
    const at = text.indexOf("NOT WORKING");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(text.indexOf("Done for you"));
    expect(text.slice(at, at + 400)).toMatch(/Noelle acts on her decisions/);
    const done = text.slice(text.indexOf("Done for you"));
    expect(done).not.toMatch(/Noelle acts on her decisions/i);
    expect(done.split("\n")[1]).toMatch(/^- seq-bin verdicts posted: working — saw 2 verdict comments — See it: /);
    expect(String(d.html)).toMatch(/NOT WORKING/);
  });
  it("outcomeBanners: one red banner per morning, every failure listed; nothing else makes one", () => {
    expect(outcomeBanners([line("a"), line("w", "outcome:seq23/a#1:working")])).toEqual([]);
    const b = outcomeBanners([line(TEXT, KEY), line("x: NOT WORKING — y", "outcome:seq23/b#2:not-working")]);
    expect(b).toHaveLength(1);
    expect(b[0]!.tone).toBe("red");
    expect(b[0]!.lines).toEqual([TEXT, "x: NOT WORKING — y"]);
  });
  it("a working verdict already told is not told again; a NOT CHECKED one carries its day, so it shows each morning", () => {
    const w = line("seq-bin #168 verdicts posted: working — saw 2", "outcome:seq23/seq-bin#168:working");
    expect(doneText(day([w]))).toContain("seq-bin verdicts posted: working — saw 2");
    expect(doneText(day([w], ["outcome:seq23/seq-bin#168:working"]))).not.toContain("seq-bin verdicts posted");
    const c1 = line("seq-bin #168 verdicts posted: NOT CHECKED — the check timed out", "outcome:seq23/seq-bin#168:not-checked:2026-11-25");
    expect(doneText(day([c1], ["outcome:seq23/seq-bin#168:not-checked:2026-11-24"]))).toContain("seq-bin verdicts posted: not checked — the check timed out");
  });
});
