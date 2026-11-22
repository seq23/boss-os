/**
 * THE ONE SHARED REVIEWER (grid row 6f): the rules that make its verdict trustworthy, and the phase-3
 * gate that keeps a new sender or channel off the maps until a fresh reviewer passed its real output.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EMAIL_SENDS, SOCIAL_POSTS, gateProblems, parseVerdict, passLine, PASS_LINE_RE, reviewRoutes, reviewPrompt } from "../src/shared/boss/shipReview/review.mjs";
import { readDark, nextDarkState, judge, isPrivate, isBlank, parseArgs, capture, pageSlug, tilesFor, MAX_TILES, changedLines, writeCaptureFile, readCaptureFile, YOUTUBE_CHANNEL } from "../scripts/ops/ship-review.mjs";
// @ts-expect-error — plain ESM with no declaration file
import { shipReviewArgs } from "../scripts/ops/repo-change.mjs";

const shots = [{ label: "phone-390-light.png", path: "/x/phone-390-light.png" }, { label: "laptop-1280-light.png", path: "/x/laptop-1280-light.png" }];
const reply = (o: unknown) => `thinking…\n${JSON.stringify(o)}`;
const emailMap = JSON.parse(readFileSync("src/shared/boss/emailMap/manifest.json", "utf8"));
const socialMap = JSON.parse(readFileSync("src/shared/boss/socialMap/manifest.json", "utf8"));
const before = JSON.parse(readFileSync("src/shared/boss/shipReview/live-before-gate.json", "utf8"));

describe("a verdict is trusted only when it is a real review", () => {
  it("PASS with no findings and every capture named is a PASS; land's own pattern reads the line it makes", () => {
    expect(parseVerdict(reply({ verdict: "PASS", looked_at: shots.map((s) => s.label), findings: [] }), shots)).toEqual({ verdict: "PASS", findings: [], already: [], unseen: [] });
    const line = passLine({ reviewer: "boss-os ship-review sr_abc (claude seat)", lookedAt: "x at 390 px" });
    expect(PASS_LINE_RE.test(line)).toBe(true);
    // the same ERE ~/bin/land greps (gate_quality → signoff)
    expect(new RegExp("^[[:space:]>*-]*Ship-ready: *PASS *(—|–|-{1,2}|:) *.+ looked at .+".replace("[[:space:]>*-]", "[\\s>*-]")).test(line)).toBe(true);
  });
  it("a reply that skipped a capture, a FAIL with nothing to fix, a PASS that lists problems, or no JSON is no review", () => {
    expect(parseVerdict(reply({ verdict: "PASS", looked_at: ["phone-390-light.png"], findings: [] }), shots).error).toMatch(/laptop-1280/);
    expect(parseVerdict(reply({ verdict: "FAIL", looked_at: shots.map((s) => s.label), findings: [] }), shots).error).toBeTruthy();
    expect(parseVerdict(reply({ verdict: "PASS", looked_at: shots.map((s) => s.label), findings: ["cut off"] }), shots).error).toBeTruthy();
    expect(parseVerdict("Looks great to me!", shots).error).toBeTruthy();
  });
  it("the request's surface decides the rules, and planned placeholders are named as not findings", () => {
    const doc = reviewPrompt({ kind: "page", target: "book", builder: "b", checklist: "c", shots, surface: "operator-doc", planned: ["[Sequoia fills]"] });
    expect(doc).toMatch(/SURFACE: operator-doc\. A PRIVATE operator document/);
    expect(doc).toMatch(/Do NOT judge marketing polish/);
    expect(doc).toMatch(/PLANNED, NOT FINDINGS[\s\S]*- \[Sequoia fills\]/);
    expect(doc).toMatch(/any OTHER placeholder or unfinished text still is a finding/);
    expect(reviewPrompt({ kind: "page", target: "x", builder: "b", checklist: "c", shots })).toMatch(/SURFACE: public-page/);
    expect(reviewPrompt({ kind: "page", target: "x", builder: "b", checklist: "c", shots })).not.toMatch(/PLANNED, NOT FINDINGS/);
    const a = parseArgs(["--kind", "page", "--target", "t", "--builder", "b", "--surface", "operator-doc", "--planned", "x", "--planned", "y"]);
    expect(a.planned).toEqual(["x", "y"]);
    expect(() => parseArgs(["--kind", "page", "--target", "t", "--builder", "b", "--surface", "brochure"])).toThrow(/BAD_ARGS/);
  });
  it("several pages are labelled by their path; a change's brief rides in the prompt", () => {
    expect(pageSlug("https://x.pages.dev/questions/is-dental-anxiety-real/")).toBe("questions-is-dental-anxiety-real");
    expect(pageSlug("https://x.pages.dev/")).toBe("home");
    expect(reviewPrompt({ kind: "page", target: "t", builder: "b", checklist: "c", shots, brief: "Changed: footer note" })).toMatch(/WHAT CHANGED AND WHAT TO JUDGE[\s\S]*footer note/);
  });
  it("with a brief, the verdict is the change's: problems already there are kept apart, never the verdict", () => {
    const r = (o: unknown) => JSON.stringify(o);
    const L = shots.map((s) => s.label);
    const pass = parseVerdict(r({ verdict: "PASS", looked_at: L, findings: [{ what: "old footer is grey", in_change: false }] }), shots, { scoped: true });
    expect(pass).toMatchObject({ verdict: "PASS", findings: [], already: [{ what: "old footer is grey" }] });
    expect(parseVerdict(r({ verdict: "FAIL", looked_at: L, findings: [{ what: "old footer is grey", in_change: false }] }), shots, { scoped: true }).error).toMatch(/no finding in the change/);
    expect(parseVerdict(r({ verdict: "PASS", looked_at: L, findings: [{ what: "new label wraps", in_change: true }] }), shots, { scoped: true }).error).toBeTruthy();
    // without a brief every finding decides the verdict, as before
    expect(parseVerdict(r({ verdict: "PASS", looked_at: L, findings: [{ what: "x", in_change: false }] }), shots).error).toBeTruthy();
    expect(reviewPrompt({ kind: "page", target: "t", builder: "b", checklist: "c", shots, brief: "b" })).toMatch(/in_change/);
  });
  it("what no capture showed is the harness's NAMED STOP, never a finding and never a PASS", () => {
    const r = (o: unknown) => JSON.stringify(o);
    const L = shots.map((s) => s.label);
    // 20 Nov 2026 (cynthia #25, hicks #72): "can't see the change" was a FAIL on the work.
    const onlyUnseen = parseVerdict(r({ verdict: "FAIL", looked_at: L, unseen: ["the footer note below the fold"], findings: [{ what: "old grey footer", in_change: false }] }), shots, { scoped: true });
    expect(onlyUnseen).toMatchObject({ verdict: "UNSEEN", findings: [], unseen: ["the footer note below the fold"], already: [{ what: "old grey footer" }] });
    expect(parseVerdict(r({ verdict: "PASS", looked_at: L, unseen: ["dark mode"], findings: [] }), shots)).toMatchObject({ verdict: "UNSEEN" });
    const real = parseVerdict(r({ verdict: "FAIL", looked_at: L, unseen: ["the menu open"], findings: [{ what: "new link has no name", in_change: true }] }), shots, { scoped: true });
    expect(real).toMatchObject({ verdict: "FAIL", findings: [{ what: "new link has no name" }], unseen: ["the menu open"] });
    expect(parseVerdict(r({ verdict: "FAIL", looked_at: ["phone-390-light.png"], unseen: ["x"], findings: [] }), shots).error).toMatch(/did not say it looked at/);
  });
  it("a PR review is given the change itself: changed lines per file, never lockfiles or images", () => {
    const diff = ["diff --git a/site/insights.html b/site/insights.html", "--- a/site/insights.html", "+++ b/site/insights.html", "@@ -1,3 +1,3 @@", " same", "-Support is tailored to you.", "+Support is shaped to respect you.",
      "diff --git a/package-lock.json b/package-lock.json", "--- a/package-lock.json", "+++ b/package-lock.json", "+\"x\": 1", "+++ b/logo.png", "+binary"].join("\n");
    const c = changedLines(diff);
    expect(c).toBe("site/insights.html:\n- Support is tailored to you.\n+ Support is shaped to respect you.");
    expect(changedLines(diff, 60)).toMatch(/1 more changed line not shown/);
    expect(reviewPrompt({ kind: "page", target: "t", builder: "b", checklist: "c", shots, change: c })).toMatch(/THE CHANGE ITSELF[\s\S]*tailored to you/);
  });
  it("a capture taken on GitHub comes back as the same shots and facts; private work never goes there", async () => {
    const { mkdtempSync, writeFileSync: w } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(`${tmpdir()}/cap-`);
    w(`${dir}/phone-390-light-1of2.png`, "x"); w(`${dir}/laptop-1280-light.png`, "x");
    writeCaptureFile(dir, { shots: [{ label: "phone-390-light-1of2.png", path: `/runner/cap/phone-390-light-1of2.png` }, { label: "laptop-1280-light.png", path: `/runner/cap/laptop-1280-light.png` }], facts: ["no horizontal scroll at 390 px"] });
    expect(readCaptureFile(dir)).toEqual({ shots: [{ label: "phone-390-light-1of2.png", path: `${dir}/phone-390-light-1of2.png` }, { label: "laptop-1280-light.png", path: `${dir}/laptop-1280-light.png` }], facts: ["no horizontal scroll at 390 px"] });
    expect(() => readCaptureFile(`${dir}/nothing`)).toThrow(/GITHUB_CAPTURE/);
    const { main } = await import("../scripts/ops/ship-review.mjs");
    await expect(main(["--kind", "email", "--target", "x.html", "--builder", "b", "--on-github", "--no-store"], { env: { ...process.env, SHIP_READY_SKILL: "package.json" }, log: () => {}, print: () => {} })).rejects.toThrow(/public web pages only/);
  });
  it("the whole page is captured, in at most MAX_TILES parts with no gap and no cut", () => {
    for (const [h, w] of [[844, 390], [3201, 390], [6500, 390], [41_000, 390], [2401, 1280]] as const) {
      const t = tilesFor(h, w);
      expect(t.length).toBeLessThanOrEqual(MAX_TILES);
      expect(t[0]!.y).toBe(0);
      for (let i = 1; i < t.length; i++) expect(t[i]!.y).toBe(t[i - 1]!.y + t[i - 1]!.height);
      expect(t.at(-1)!.y + t.at(-1)!.height).toBe(h);
    }
    expect(readFileSync("scripts/ops/ship-review.mjs", "utf8")).not.toMatch(/maxHeight/);
  });
  // CI installs ffmpeg (ci.yml unit job), so there the test always runs; only a laptop without it skips.
  it.skipIf(!process.env.CI && spawnSync("ffmpeg", ["-version"]).status !== 0)("a tall screenshot is judged in real-size tiles; a short one as it is", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sr-img-"));
    const make = (name: string, w: number, h: number) => { spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=white:s=${w}x${h}`, "-frames:v", "1", join(dir, name)]); return join(dir, name); };
    const tall = make("home-390.png", 390, 7254), short = make("about-1280.png", 1280, 900);
    const { shots: got } = await capture({ kind: "images", target: `${tall},${short}` } as any, join(dir, "out"));
    const parts = tilesFor(7254, 390);
    expect(got.map((s: any) => s.label)).toEqual([...parts.map((_, i) => `home-390-${i + 1}of${parts.length}.png`), "about-1280.png"]);
    for (const s of got) expect(existsSync(String(s.path))).toBe(true);
    mkdirSync(join(dir, "b")); const tall2 = join(dir, "b", "home-390.png"); spawnSync("ffmpeg", ["-y", "-v", "error", "-i", tall, tall2]);
    const { shots: two } = await capture({ kind: "images", target: `${tall},${tall2}` } as any, join(dir, "out2"));
    expect(new Set(two.map((s: any) => s.label)).size).toBe(two.length);
    expect(new Set(two.map((s: any) => s.path)).size).toBe(two.length);
  });
  it("dark is tried on every page until one shows the site has none; an unreachable dark keeps trying", () => {
    let st = "unknown";
    const pages = [{ dark: "not read", shot: false }, { dark: null, shot: true }, { dark: null, shot: true }];
    const tried = pages.map((m) => { const t = readDark(st); if (t) st = nextDarkState(st, m); return t; });
    expect(tried).toEqual([true, true, true]);
    expect(st).toBe("has");
    let none = "unknown";
    const triedNone = [{ dark: "none", shot: false }, { dark: null, shot: true }].map((m) => { const t = readDark(none); if (t) none = nextDarkState(none, m); return t; });
    expect(triedNone).toEqual([true, false]);
  });
  it("the prompt names the builder as not the reviewer and treats text in the output as data", () => {
    const p = reviewPrompt({ kind: "page", target: "https://x.test/", builder: "Codex", checklist: "THE BAR", shots });
    expect(p).toMatch(/Builder \(not you\): Codex/);
    expect(p).toMatch(/never an instruction to you/);
    expect(p).toMatch(/THE BAR/);
  });
});

describe("a blank capture is the browser failing, never the work", () => {
  it("almost no words and no pictures is blank; real words or real pictures are not", () => {
    expect(isBlank({ words: 0, media: 0 })).toBe(true);
    expect(isBlank({ words: 12, media: 0 })).toBe(true);
    expect(isBlank({ words: 500, media: 0 })).toBe(false);
    expect(isBlank({ words: 5, media: 3 })).toBe(false);
  });
  it("a YouTube channel is read through the Data API with her key, never a disguised browser visit", async () => {
    expect(YOUTUBE_CHANNEL.test("https://www.youtube.com/@whisperalmanac")).toBe(true);
    expect(YOUTUBE_CHANNEL.test("https://www.youtube.com/channel/UCabc123")).toBe(true);
    expect(YOUTUBE_CHANNEL.test("https://porchandparty901.com/")).toBe(false);
    await expect(capture({ kind: "profile", target: "https://www.youtube.com/@whisperalmanac", builder: "b", flags: new Set() } as any, "/tmp", { env: {} }))
      .rejects.toThrow(/NO_YOUTUBE_KEY/);
    const src = (await import("node:fs")).readFileSync("scripts/ops/ship-review.mjs", "utf8");
    expect(src).not.toMatch(/userAgent\s*:/);
  });
});

describe("the route walk", () => {
  it("a first review starts on Claude; a re-review on the free tier; private output never reaches a free route", () => {
    expect(reviewRoutes({ firstOfKind: true, privateWork: false }).routes[0]).toBe("claude");
    expect(reviewRoutes({ firstOfKind: false, privateWork: false }).routes[0]).toBe("free");
    expect(reviewRoutes({ firstOfKind: false, privateWork: true }).routes).not.toContain("free");
    expect(isPrivate(parseArgs(["--kind", "email", "--target", "a.html", "--builder", "x"]))).toBe(true);
    expect(isPrivate(parseArgs(["--kind", "page", "--target", "https://boss.sequoiataylor.com/", "--builder", "x"]))).toBe(true);
    expect(isPrivate(parseArgs(["--kind", "page", "--target", "https://porchandparty901.com/", "--builder", "x"]))).toBe(false);
  });
  it("a free PASS goes on to a seat for the final word; a free FAIL stands", async () => {
    const free = (verdict: string) => async (url: string) => url.includes("raw.githubusercontent")
      ? new Response(JSON.stringify({ policy: { max_cost_usd: 0, fallback_to_paid: false }, gemini_models: ["g-free"] }))
      : new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ verdict, looked_at: shots.map((s) => s.label), findings: verdict === "FAIL" ? [{ what: "text cut off" }] : [] }) } }] }));
    const seat = (verdict: string) => () => ({ status: 0, stdout: JSON.stringify({ verdict, looked_at: shots.map((s) => s.label), findings: verdict === "FAIL" ? [{ what: "warped lettering" }] : [] }) });
    const base = { kind: "images", target: "t", builder: "b", checklist: "c", facts: [] };
    const env = { GEMINI_API_KEY: "k", AI_RUN_BIN: "/bin/sh", HOME: "/tmp" };
    const shotsOnDisk = [{ label: "a.png", path: "/etc/hosts" }];
    shots.splice(0, shots.length, ...shotsOnDisk.map((s) => ({ ...s })));
    const failed = await judge({ routes: ["free", "codex"], base, shots, out: "/tmp", env, fetchImpl: free("FAIL") as any, run: seat("PASS") as any });
    expect(failed).toMatchObject({ verdict: "FAIL", tier: "free" });
    const confirmed = await judge({ routes: ["free", "codex"], base, shots, out: "/tmp", env, fetchImpl: free("PASS") as any, run: seat("FAIL") as any });
    expect(confirmed).toMatchObject({ verdict: "FAIL", tier: "codex" });
    const onlyFree = await judge({ routes: ["free"], base, shots, out: "/tmp", env, fetchImpl: free("PASS") as any });
    expect(onlyFree).toBeNull();
  });
});

describe("phase 3: nothing new goes public without a PASS", () => {
  it("every sender and live channel today is either grandfathered or carries a PASS; the grandfather list only shrinks", () => {
    expect(gateProblems(emailMap.rows, { live: EMAIL_SENDS, liveBefore: before.email, map: "Email Map" })).toEqual([]);
    expect(gateProblems(socialMap.rows, { live: SOCIAL_POSTS, liveBefore: before.social, launch: true, map: "Social Map" })).toEqual([]);
    expect(before.email.length).toBeLessThanOrEqual(96);
    expect(before.social.length).toBeLessThanOrEqual(49);
  });
  it("a new sender or channel with no PASS fails the build, and a new channel needs a Launch-ready line", () => {
    const newSender = { id: "new-sender", runs: "mac" };
    expect(gateProblems([...emailMap.rows, newSender], { live: EMAIL_SENDS, liveBefore: before.email, map: "Email Map" })).toHaveLength(1);
    const ok = { ...newSender, ship_ready: { pass: passLine({ reviewer: "boss-os ship-review sr_a1 (claude seat)", lookedAt: "the rendered email at 390 px" }), review: "sr_a1" } };
    expect(gateProblems([ok], { live: EMAIL_SENDS, liveBefore: [], map: "Email Map" })).toEqual([]);
    const channel = { id: "new-channel", status: "live_auto", ship_ready: ok.ship_ready };
    expect(gateProblems([channel], { live: SOCIAL_POSTS, liveBefore: [], launch: true, map: "Social Map" })[0]).toMatch(/Launch-ready/);
    expect(gateProblems([{ id: "planned", status: "planned" }], { live: SOCIAL_POSTS, liveBefore: [], launch: true, map: "Social Map" })).toEqual([]);
  });
});

describe("Danielle's lane hands the real output to the shared reviewer", () => {
  it("a preview URL is judged as a page; otherwise her build's screenshots; the PASS goes into the PR body land reads", () => {
    const row = { id: "rc_x", repo: "p-n-p", pr_number: 12 };
    const page = shipReviewArgs(row, { previewUrl: "https://abc.pages.dev", out: "/o" });
    expect(page.slice(1)).toEqual(expect.arrayContaining(["--kind", "page", "--target", "https://abc.pages.dev", "--pr", "seq23/p-n-p#12", "--subject", "repo-change:p-n-p#12"]));
    const imgs = shipReviewArgs(row, { shots: ["/a.png", "/b.png"], out: "/o" });
    expect(imgs).toEqual(expect.arrayContaining(["images", "/a.png,/b.png"]));
  });
});

// The browser test runs wherever Chromium is installed (CI installs it in the unit job); only a laptop
// without it skips.
const hasChromium = (() => { try { return existsSync(chromium.executablePath()); } catch { return false; } })();
async function colourShare(png: string, [r, g, b]: [number, number, number]): Promise<number> {
  const br = await chromium.launch();
  try {
    const p = await br.newPage();
    await p.setContent(`<img id="i" src="data:image/png;base64,${readFileSync(png, "base64")}">`);
    return await p.evaluate(async ([r, g, b]) => {
      const i = document.getElementById("i") as HTMLImageElement; await i.decode();
      const c = document.createElement("canvas"); c.width = i.naturalWidth; c.height = i.naturalHeight;
      const x = c.getContext("2d")!; x.drawImage(i, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data; let hit = 0;
      for (let k = 0; k < d.length; k += 4) if (Math.abs(d[k]! - r) < 40 && Math.abs(d[k + 1]! - g) < 40 && Math.abs(d[k + 2]! - b) < 40) hit++;
      return hit / (d.length / 4);
    }, [r, g, b] as const);
  } finally { await br.close(); }
}
describe("a message that only shows after a tap is captured, never left unseen", () => {
  it.skipIf(!process.env.CI && !hasChromium)("--tap loads the page, taps the button and shoots what it shows; text inside a scrolling panel is reached", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sr-tap-"));
    const page = join(dir, "kit.html");
    writeFileSync(join(dir, "elsewhere.html"), `<!doctype html><p>${"Another page entirely. ".repeat(20)}</p>`);
    writeFileSync(page, `<!doctype html><html><body style="margin:0;font:16px sans-serif">
      <div style="height:600px;overflow:auto"><div style="height:3000px">Kit</div>
        <p style="background:#0c0;height:120px;margin:0">Deep in the panel</p>
        <a href="elsewhere.html">Go elsewhere</a>
        <button onclick="document.getElementById('m').hidden=false">Get this kit, $19 once</button>
        <p id="m" hidden style="background:#f00;height:120px;margin:0">Preview: this kit is open for this visit.</p></div>
      ${"<p>filler words for the blank check</p>".repeat(20)}</body></html>`);
    expect(parseArgs(["--kind", "page", "--target", "https://x.test/", "--builder", "b", "--tap", "Get this kit"]).focus).toEqual(["tap:Get this kit"]);
    const { shots, facts } = await capture({ kind: "email", target: page, focus: ["tap:Get this kit", "tap:Go elsewhere", "Deep in the panel", "tap:No such button"] } as any, join(dir, "out"));
    const labels = shots.map((s: any) => s.label);
    // Text after a link tap is looked for on the page itself again, inside its scrolling panel, and the
    // shot shows it (the green block beside it), not some other part of the page.
    const panelShot = shots.find((s: any) => /phone-390-light-focus-3\.png$/.test(s.label));
    expect(panelShot).toBeTruthy();
    expect(await colourShare(String(panelShot!.path), [0, 204, 0])).toBeGreaterThan(0.05);
    // The shot after the tap shows the message the tap revealed (a red block), not just the button.
    const tapShot = shots.find((s: any) => /phone-390-light-tap-1\.png$/.test(s.label));
    expect(tapShot).toBeTruthy();
    expect(await colourShare(String(tapShot!.path), [255, 0, 0])).toBeGreaterThan(0.05);
    expect(labels.some((l: string) => /-tap-2\.png$/.test(l))).toBe(true);
    expect(facts.some((f: string) => /after tapping "Get this kit"/.test(f))).toBe(true);
    // A tap that cannot happen is said, never a silent pass.
    expect(facts.some((f: string) => /could not tap "No such button"/.test(f))).toBe(true);
    expect(labels.some((l: string) => /-tap-4\.png$/.test(l))).toBe(false);
  }, 120_000);
});
