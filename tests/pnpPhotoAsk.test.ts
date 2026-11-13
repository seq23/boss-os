/**
 * MARKETPLACE LISTINGS USE OUR REAL WORK (owner ruling, 1 Nov 2026): when nothing new has come in for
 * two weeks, ask the owner once in the morning email — at most once a week — and never otherwise.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { photoAskDue, photoAskItem, STUDIO_PHOTOS_SQL, d1Time } from "../src/shared/boss/pnp/photoAsk.mjs";
import { readMorningSections, writeMorningSection } from "../src/shared/boss/mail/morning.mjs";

const DAY = 86_400_000;
const now = Date.parse("2026-11-20T20:00:00Z");

describe("the Marketplace photo ask", () => {
  it("asks only after two weeks with nothing new, and at most once a week, and the item reaches the morning email", () => {
    expect(photoAskDue({ newest: now - 13 * DAY, lastAsked: null, now }).ask).toBe(false);
    expect(photoAskDue({ newest: now - 14 * DAY, lastAsked: null, now }).ask).toBe(true);
    expect(photoAskDue({ newest: null, lastAsked: null, now }).ask).toBe(true);
    expect(photoAskDue({ newest: now - 30 * DAY, lastAsked: now - 6 * DAY, now }).ask).toBe(false);
    expect(photoAskDue({ newest: now - 30 * DAY, lastAsked: now - 7 * DAY, now }).ask).toBe(true);
    const dir = mkdtempSync(join(tmpdir(), "photo-ask-"));
    writeMorningSection("pnp_marketplace", { decide: [photoAskItem({ days: 16 })] }, { dir, now });
    const { sections, skipped } = readMorningSections({ dir, now: now + 10 * 3_600_000 });
    expect(skipped).toEqual([]);
    expect(sections.pnp_marketplace!.decide![0]!.body).toContain("16 days");
    expect(sections.pnp_marketplace!.decide![0]!.body).not.toMatch(/Valerie/);
  });
});

/**
 * A PHOTO SET IS REAL WORK (13 Nov 2026). P&P Studio's photo sets (`pack_photos`) were not counted, so
 * the newest real work read 24 Oct when photos had come in on 12 Nov, and she was about to be asked
 * again. The job's own SQL is run here against P&P Studio's table shapes (creator-studios migrations
 * 0001 and 0020), then judged by the job's own rule.
 */
describe("P&P Studio photo sets count as new real work", () => {
  const studio = (rows: { assets?: string[]; clips?: string[]; sets?: [string, string][] }) => {
    const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE assets (id INTEGER PRIMARY KEY, mime_type TEXT, upload_status TEXT, created_at TEXT); CREATE TABLE clips (id INTEGER PRIMARY KEY, status TEXT, created_at TEXT); CREATE TABLE pack_photos (id INTEGER PRIMARY KEY, upload_status TEXT, created_at TEXT);");
    for (const at of rows.assets ?? []) db.prepare("INSERT INTO assets (mime_type, upload_status, created_at) VALUES ('image/jpeg', 'uploaded', ?)").run(at);
    for (const at of rows.clips ?? []) db.prepare("INSERT INTO clips (status, created_at) VALUES ('approved', ?)").run(at);
    for (const [status, at] of rows.sets ?? []) db.prepare("INSERT INTO pack_photos (upload_status, created_at) VALUES (?, ?)").run(status, at);
    const r = db.prepare(STUDIO_PHOTOS_SQL).get() as { n: number; newest: string | null };
    return { n: Number(r.n), newest: d1Time(r.newest) };
  };
  const old = "2026-10-24T15:00:00.000Z";
  it("a photo set uploaded within two weeks → no ask", () => {
    const got = studio({ assets: [old], clips: ["2026-10-20 12:00:00"], sets: [["uploaded", "2026-11-12T18:30:00.000Z"]] });
    expect(got.n).toBe(3);
    expect(got.newest).toBe(Date.parse("2026-11-12T18:30:00.000Z"));
    expect(photoAskDue({ newest: got.newest, lastAsked: null, now }).ask).toBe(false);
  });
  it("negative: with no recent photo set the same shelf IS asked about; a set still uploading does not count", () => {
    expect(photoAskDue({ newest: studio({ assets: [old] }).newest, lastAsked: null, now }).ask).toBe(true);
    const half = studio({ assets: [old], sets: [["uploading", "2026-11-12T18:30:00.000Z"], ["failed", "2026-11-13T09:00:00.000Z"]] });
    expect(half.n).toBe(1);
    expect(photoAskDue({ newest: half.newest, lastAsked: null, now }).ask).toBe(true);
  });
});
