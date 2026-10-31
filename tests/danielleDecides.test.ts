import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error — plain .mjs with no types; the functions under test are the ones the runner calls.
import { OWNER_ACTOR, runVerdict } from "../scripts/ops/site-audit-lib.mjs";

/**
 * NOTHING WAITS ON THE OWNER (31 Oct 2026): sixteen Search Readiness rows were parked "for a person to
 * decide". A row whose next action is the owner's turns the pass RED (OWNER_ASKED), so it comes back
 * to Danielle; the scoped pass records a protected brief as off_limits, never surfaced.
 */
const crawl = { pages_crawled: 3 };
const row = (suggested_action: string, disposition = "surfaced") => ({
  project: "checklist:dentistryguides.com", repo: "local-guides-generator", headline: "c1", because: "x", crawl, disposition, suggested_action,
});

describe("Danielle decides; she never parks a finding for the owner", () => {
  it.each([
    "Owner creates one real profile for The Dentistry Guides and adds its URL",
    "Ask her which project owns the site",
    "She publishes the existing main through Lovable",
    "Left for a person to decide.",
  ])("RED OWNER_ASKED: %s", (a) => {
    const v = runVerdict({ findings: [row(a, "none")] });
    expect(v.red).toBe(true);
    expect(v.reasons.join("\n")).toMatch(/OWNER_ASKED/);
  });

  it.each([
    "Dispatched entity_backlink_watch.yml now; confirm the run is green on the next audit.",
    "Nothing needs changing: the host answers 302 for www and no repository change can move it.",
    "Danielle publishes main through the Lovable release path on her next pass.",
  ])("NEGATIVE: an action that is hers is not flagged: %s", (a) => {
    expect(OWNER_ACTOR.test(a)).toBe(false);
    expect(runVerdict({ findings: [row(a, "none")] }).reasons.join("\n")).not.toMatch(/OWNER_ASKED/);
  });

  it("the scoped pass records a protected brief as off_limits, and the prompt carries the decision ladder", () => {
    const sh = readFileSync("scripts/ops/ahrefs-audit-fix.sh", "utf8");
    expect(sh).toMatch(/protected\\` set; record it as off_limits/);
    expect(sh).not.toMatch(/protected\\` set; record it as surfaced/);
    expect(readFileSync("scripts/ops/ahrefs-audit-fix-prompt.md", "utf8")).toMatch(/You decide; nothing is left for a person[\s\S]*OWNER_ASKED/);
  });
});
