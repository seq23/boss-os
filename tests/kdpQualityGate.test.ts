import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs ops script, no types
import { qualityFindings } from "../scripts/ops/kdp-books/quality-gate.mjs";
// @ts-expect-error — plain .mjs ops script, no types
import { rejectedMail, reasonIn } from "../scripts/ops/kdp-new-title.mjs";

// 15 Nov 2026: Kindle Content Review rejected "How to Break Into Investment Banking" ("might result in a
// disappointing customer experience"). The gate reads every title against those grounds before Publish.
const W = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey yankee zulu".split(" ");
const para = (i: number) => `${W[i % 26]} ${W[(i * 7) % 26]} ${W[(i * 11) % 26]} ${W[Math.floor(i / 26) % 26]}: a worked example about networking emails, interview answers and resumes for analysts, told ${W[(i * 3) % 26]} ${W[(i * 5) % 26]}.`;
const body = Array.from({ length: 300 }, (_, i) => para(i)).join("\n");
const clean = { title: "How to Break Into Investment Banking", subtitle: "Networking, Interviews and Your First Year", description: "Networking emails, interview answers and resumes for analysts.", ai_disclosure: { text_detail: "Extensive editing" } };

describe("the Kindle quality gate", () => {
  // The rejected subtitle began "The Ultimate Guide to Landing a Job on Wall Street: …". On 24 Nov 2026 she
  // chose "The Ultimate Guide" titles, and Amazon's metadata rules (G201097560) bar sales-rank and promotion
  // words, not "ultimate"; so the rejection is pinned on its other grounds, and the promo word is "Best".
  it("the rejected title's listing fails on unedited AI text and a stuffed subtitle; 'Best' fails as a promo word", () => {
    const rejected = { ...clean, subtitle: "The Ultimate Guide to Landing a Job on Wall Street: Networking Emails, Interview Answers, Resumes and Your First Year", ai_disclosure: { text_detail: "Some sections, with minimal or no editing" } };
    const codes = qualityFindings(rejected, body).map((f: any) => f.code);
    expect(codes).toEqual(expect.arrayContaining(["AI_TEXT_UNEDITED", "SUBTITLE_STUFFED"]));
    expect(codes).not.toContain("PROMO_WORDS");
    const best = qualityFindings({ ...rejected, subtitle: rejected.subtitle.replace("Ultimate", "Best") }, body).map((f: any) => f.code);
    expect(best).toEqual(expect.arrayContaining(["AI_TEXT_UNEDITED", "SUBTITLE_STUFFED", "PROMO_WORDS"]));
  });
  it("a clean listing with a real body passes; thin, repeated or off-description text fails", () => {
    expect(qualityFindings(clean, body)).toEqual([]);
    expect(qualityFindings(clean, body.split("\n").slice(0, 40).join("\n")).map((f: any) => f.code)).toContain("THIN");
    expect(qualityFindings(clean, Array(300).fill(para(1)).join("\n")).map((f: any) => f.code)).toContain("REPETITIVE");
    expect(qualityFindings({ ...clean, description: "Gardening tomatoes, compost, pruning, irrigation, seedlings, greenhouses and harvesting vegetables outdoors." }, body).map((f: any) => f.code)).toContain("DESCRIPTION_MISMATCH");
  });
});

describe("a Blocked title is Amazon's rejection, told with Amazon's reason, never 'finish the step'", () => {
  it("quotes the reason and never sends her to the Mac", () => {
    const m = rejectedMail({ title: "How to Break Into Investment Banking", reason: reasonIn("KDP-REASON: might result in a disappointing customer experience") });
    const all = JSON.stringify(m);
    expect(all).toContain("disappointing customer experience");
    expect(all).not.toMatch(/finish the step|Chrome window/i);
    expect(reasonIn("KDP-REASON: none")).toBeNull();
  });
});
