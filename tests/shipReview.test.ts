/**
 * THE ONE SHARED REVIEWER (grid row 6f): the rules that make its verdict trustworthy, and the phase-3
 * gate that keeps a new sender or channel off the maps until a fresh reviewer passed its real output.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EMAIL_SENDS, SOCIAL_POSTS, gateProblems, parseVerdict, passLine, PASS_LINE_RE, reviewRoutes, reviewPrompt } from "../src/shared/boss/shipReview/review.mjs";
import { judge, isPrivate, parseArgs } from "../scripts/ops/ship-review.mjs";
import { shipReviewArgs } from "../scripts/ops/repo-change.mjs";

const shots = [{ label: "phone-390-light.png", path: "/x/phone-390-light.png" }, { label: "laptop-1280-light.png", path: "/x/laptop-1280-light.png" }];
const reply = (o: unknown) => `thinking…\n${JSON.stringify(o)}`;
const emailMap = JSON.parse(readFileSync("src/shared/boss/emailMap/manifest.json", "utf8"));
const socialMap = JSON.parse(readFileSync("src/shared/boss/socialMap/manifest.json", "utf8"));
const before = JSON.parse(readFileSync("src/shared/boss/shipReview/live-before-gate.json", "utf8"));

describe("a verdict is trusted only when it is a real review", () => {
  it("PASS with no findings and every capture named is a PASS; land's own pattern reads the line it makes", () => {
    expect(parseVerdict(reply({ verdict: "PASS", looked_at: shots.map((s) => s.label), findings: [] }), shots)).toEqual({ verdict: "PASS", findings: [] });
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
  it("the prompt names the builder as not the reviewer and treats text in the output as data", () => {
    const p = reviewPrompt({ kind: "page", target: "https://x.test/", builder: "Codex", checklist: "THE BAR", shots });
    expect(p).toMatch(/Builder \(not you\): Codex/);
    expect(p).toMatch(/never an instruction to you/);
    expect(p).toMatch(/THE BAR/);
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
