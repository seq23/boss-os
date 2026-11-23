/**
 * ONE STUCK ITEM NEVER HALTS A LIST, AND A STALLED JOB IS SAID OUT LOUD (18 Nov 2026).
 * The one shared guard for every list-working job (src/shared/boss/duties/stall.mjs): the behaviour of
 * `eachItem`, the stall alert's words, sent once, its red line at the top of the morning email, and a
 * sweep of every Mac job for the 16 Nov shape (a per-item catch that ends the whole loop).
 * Synthetic data only.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs ops libs, no types
import { eachItem, stallFrom, stallBanners, HER_ACTIONS } from "../src/shared/boss/duties/stall.mjs";
// @ts-expect-error — plain .mjs ops libs, no types
import { reportStall } from "../scripts/ops/lib/stall-report.mjs";
// @ts-expect-error — plain .mjs ops libs, no types
import { kdpStallOf } from "../scripts/ops/kdp-new-title.mjs";
import { buildDay } from "../scripts/ops/your-day.mjs";

const quiet = (fn: (x: any) => void = () => {}) => ({ log: fn });

describe("eachItem: one stuck item never halts the list", () => {
  it("an item that throws is set aside and every other item still runs", async () => {
    const seen: string[] = [];
    const r = await eachItem(["a", "b", "c"], async (x: string) => { if (x === "a") throw Object.assign(new Error("Amazon blocked it"), { stop: "CONTENT_REJECTED" }); seen.push(x); return x; }, quiet());
    expect(seen).toEqual(["b", "c"]);
    expect(r.setAside).toEqual([{ item: "a", code: "CONTENT_REJECTED", why: "Amazon blocked it" }]);
    expect(r.stopped).toBeNull();
    expect(r.done.map((d: any) => d.result)).toEqual(["b", "c"]);
  });
  it("only a run-level stop ends the run, and what was left is returned", async () => {
    const r = await eachItem([1, 2, 3, 4], async (n: number) => { if (n === 2) throw Object.assign(new Error("signed out"), { stop: "SIGNIN" }); return n; }, quiet());
    expect(r.done.map((d: any) => d.item)).toEqual([1]);
    expect(r.stopped).toMatchObject({ item: 2, code: "SIGNIN" });
    expect(r.left).toEqual([3, 4]);
  });
  it("says each item it set aside, by name", async () => {
    const lines: string[] = [];
    await eachItem([{ title: "Synthetic Book" }], async () => { throw new Error("no field"); }, quiet((l: string) => lines.push(l)));
    expect(lines).toEqual([expect.stringMatching(/^NAMED STOP \[ITEM_SET_ASIDE\] Synthetic Book: FAILED — no field/)]);
  });
});

describe("the stall alert", () => {
  const stall = stallFrom({ job: "kdp-new-title", what: "Kindle publishing", noun: ["book", "books"], waiting: 10, blocker: { count: 1, noun: ["blocked book", "blocked books"], name: "Synthetic Book", why: "blocked by Amazon" } });
  it("says what stopped, how much waits and behind what, in the subject and a red banner", () => {
    expect(stall.subject).toBe("🔴 STOPPED: Kindle publishing — 10 books stuck behind 1 blocked book");
    expect(stall.banner).toMatchObject({ tone: "red", title: "STOPPED: Kindle publishing — 10 books stuck behind 1 blocked book" });
    expect(stall.banner.lines[0]).toContain('"Synthetic Book" (blocked by Amazon)');
    expect(stall.stop).toBe("STALLED_KDP_NEW_TITLE");
    expect(stall.mail.layout.banners[0]).toMatchObject({ tone: "red", title: stall.banner.title });
  });
  it("is no stall when the run moved something or nothing waits", () => {
    expect(stallFrom({ job: "j", what: "W", noun: ["x", "xs"], waiting: 10, moved: 1, blocker: { noun: ["y"] } })).toBeNull();
    expect(stallFrom({ job: "j", what: "W", noun: ["x", "xs"], waiting: 0, blocker: { noun: ["y"] } })).toBeNull();
  });
  it("is emailed once per stall, kept quiet while it lasts, and cleared when the job moves", async () => {
    const posts: any[] = []; const sent: any[] = [];
    let action = "opened";
    const post = async (_p: string, b: any) => { posts.push(b); return b.cleared ? { action: "closed" } : { action }; };
    const send = async (m: any) => { sent.push(m.subject); return true; };
    await reportStall({ post, send, job: "kdp-new-title", stall, log: () => {} });
    action = "kept";
    await reportStall({ post, send, job: "kdp-new-title", stall, log: () => {} });
    expect(sent).toEqual([stall.subject]);
    const r = await reportStall({ post, send, job: "kdp-new-title", stall: null, log: () => {} });
    expect(r.action).toBe("closed");
    expect(posts.at(-1)).toEqual({ repo: "seq23/boss-os", stop: "STALLED_KDP_NEW_TITLE", cleared: true });
  });
  it("the Kindle run: a sign-in stop with books waiting is a stall; a run that moved one clears it; Amazon's weekly limit leaves it", () => {
    const base = { approved: 11, moved: 0, setAside: [], held: [], runStop: null, weekly: false, draftCap: false };
    expect(kdpStallOf({ ...base, runStop: "SIGNIN_NOT_DONE" }).stall.subject).toBe("🔴 STOPPED: Kindle publishing — 11 books stuck behind the KDP sign-in");
    // 23 Nov 2026 live read: the morning banner (next_step) said only "Nothing went out"; a sign-in stop is hers, so it says what moves them.
    expect(kdpStallOf({ ...base, runStop: "SIGNIN_NOT_DONE" }).stall.next_step).toMatch(/sign in to Amazon in the Chrome window/);
    expect(kdpStallOf({ ...base, runStop: "PROFILE_IN_USE" }).stall.next_step).not.toMatch(/sign in/);
    expect(kdpStallOf({ ...base, moved: 1, setAside: [{ title: "X", code: "FIELD_NOT_FOUND" }] })).toEqual({ clear: true });
    expect(kdpStallOf({ ...base, weekly: true })).toEqual({});
    expect(kdpStallOf({ ...base, approved: 0 })).toEqual({ clear: true });
  });
  it("an open stall row is a red line at the very top of the morning email, until it closes", () => {
    const rows = [
      { status: "open", source_key: "seq23/boss-os#STALLED_KDP_NEW_TITLE", title: stall.subject, next_step: stall.next_step },
      { status: "closed", source_key: "seq23/boss-os#STALLED_OTHER", title: "🔴 STOPPED: Old", next_step: "x" },
      { status: "open", source_key: "seq23/some-repo#BUILD_RED", title: "Not a stall", next_step: "x" },
    ];
    const banners = stallBanners(rows);
    expect(banners).toEqual([{ tone: "red", title: stall.banner.title, lines: [stall.next_step] }]);
    const e = buildDay({ stallBanners: banners, diary: [], tasks: [], approvals: [], repoChanges: [], briefing: null, feed: { items: [] }, morning: {}, prospects: { replies: [], sent: [], next: [], totals: {}, stops: [] } } as any, Date.parse("2026-11-18T12:00:00Z"));
    const at = e.text.toLowerCase().indexOf("stopped: kindle publishing — 10 books stuck behind 1 blocked book");
    expect(at).toBeGreaterThan(-1);
    // Only line 1 (why she gets it) and the in-bed gate come before it: above every section.
    const before = e.text.slice(0, at).split("\n").filter((l: string) => l.trim() && !/^🔴/u.test(l.trim()));
    expect(before.length).toBeLessThanOrEqual(2);
    expect(before[0]).toMatch(/^Good morning\./);
    expect(e.html).toContain("10 books stuck behind 1 blocked book");
  });
  it("the banner carries her action and a working link even when the stored row predates them (23 Nov 2026)", () => {
    const ORIGIN = "https://boss.sequoiataylor.com";
    // The row was written before the action existed: its next_step says only that nothing went out.
    const stale = { id: "oloop_abc123", status: "open", source_key: "seq23/boss-os#STALLED_KDP_NEW_TITLE", title: "🔴 STOPPED: Kindle publishing — 11 books stuck behind the KDP sign-in", next_step: "Nothing went out." };
    const [b] = stallBanners([stale], { origin: ORIGIN });
    expect(b.lines).toEqual(["Nothing went out.", HER_ACTIONS["the KDP sign-in"]]);
    // The action names the real run time from the schedule, not a guess.
    expect(b.lines[1]).toMatch(/\(Sun 10:15 pm CT\)/);
    expect(b.button).toEqual({ label: "See it on Open Loops", url: `${ORIGIN}/?tab=loops&loop=oloop_abc123` });
    // A fresh row already carrying the action does not say it twice.
    const fresh = kdpStallOf({ approved: 11, moved: 0, setAside: [], held: [], runStop: "SIGNIN_NOT_DONE", weekly: false, draftCap: false }).stall;
    const [f] = stallBanners([{ ...stale, next_step: fresh.next_step }], { origin: ORIGIN });
    expect(f.lines.filter((l: string) => l.includes(HER_ACTIONS["the KDP sign-in"]))).toHaveLength(1);
    // No id: the Open Loops page itself. No https origin: no button rather than a broken one.
    expect(stallBanners([{ ...stale, id: undefined }], { origin: ORIGIN })[0].button.url).toBe(`${ORIGIN}/?tab=loops`);
    expect(stallBanners([stale], { origin: "" })[0]).not.toHaveProperty("button");
    expect(stallBanners([stale], { origin: "http://boss.example.com" })[0]).not.toHaveProperty("button");
  });
  it("a failed Open Loops read is a banner that says so, never an empty top that reads as all clear", () => {
    const ORIGIN = "https://boss.sequoiataylor.com";
    for (const failed of [null, undefined, { error: "x" }]) {
      const out = stallBanners(failed as any, { origin: ORIGIN });
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ tone: "red", button: { url: `${ORIGIN}/?tab=loops` } });
    }
    expect(stallBanners([], { origin: ORIGIN }), "a read that worked and found nothing is quiet").toEqual([]);
  });
});

/** The 16 Nov shape: inside a loop, a catch block whose own body ends the loop with a bare `break;`. */
export function haltingCatches(src: string): number[] {
  const lines = src.split("\n");
  const hits: number[] = [];
  lines.forEach((l, i) => {
    const m = /^(\s*)\}?\s*catch\s*(\([^)]*\))?\s*\{\s*$/.exec(l);
    if (!m) return;
    const indent = (m[1] ?? "").length;
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j] ?? "";
      const ind = t.length - t.trimStart().length;
      if (t.trim().startsWith("}") && ind <= indent) break;
      if (ind === indent + 2 && /^\s*break;/.test(t)) { hits.push(i + 1); break; }
    }
  });
  return hits;
}

describe("the sweep: no Mac job lets one item's failure end its whole list", () => {
  it("finds the 16 Nov shape in synthetic code, and not a conditional run-level stop", () => {
    const bad = ["  for (const b of todo) {", "    try {", "      await go(b);", "    } catch (e0) {", "      say(\"STOPPED\");", "      break; // the window is closed now", "    }", "  }"].join("\n");
    const ok = bad.replace("      break; // the window is closed now", "      if (stopEndsRun(e0.stop)) break;");
    expect(haltingCatches(bad)).toEqual([4]);
    expect(haltingCatches(ok)).toEqual([]);
  });
  it("every Mac job is clean", () => {
    const dir = "scripts/ops";
    const files = readdirSync(dir).filter((f) => f.endsWith(".mjs"));
    expect(files.length).toBeGreaterThan(50);
    const found = files.flatMap((f) => haltingCatches(readFileSync(join(dir, f), "utf8")).map((n) => `${f}:${n}`));
    expect(found).toEqual([]);
  });
});
