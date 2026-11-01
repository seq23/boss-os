/**
 * AGENTS NEVER SPEND MONEY (owner, 22 Oct 2026).
 *
 * Reads the rule where it is written (CLAUDE.md, docs/SERVICE_RULES.md) and proves the code that
 * enforces it: the executor record refuses a spend step for every seat, no seat holds `owner_spend`,
 * and the sentence is in the one block every employee run carries. A specification no code reads is
 * a wish; this is the code that reads it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NEVER_SPEND_RULE, SEAT_EXECUTORS, checkAssignment, requiredCapability, spendStepIn,
} from "../src/shared/boss/duties/executors.mjs";
import { SERVICE_PRACTICES, servicePracticesBlock } from "../src/shared/boss/service/practices.mjs";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const SPEND_STEPS = [
  "Buy the domain renewal for approvalprep.com",
  "Complete the checkout for 3 KDP proof copies",
  "Top up OpenRouter credits to $10",
  "Upgrade to the paid plan on Supabase",
  "Pay the Workers invoice",
  "Renew the domain heygetonmylevel.com",
  "Subscribe to the Ahrefs Lite plan",
  "Place the order for the tent stakes",
];
const NOT_SPEND = [
  "Fix the payment page CSS on approvalprep.com",
  "creator-studios: change the sign-up copy",
  "Research senior-living referral fees in Memphis",
  "Tell me when a domain renewal is due",
];

describe("agents never spend money — the rule is written where it is read", () => {
  it("docs/SERVICE_RULES.md holds R32 as an ALL-KINDS rule anchored on the shared practices block", () => {
    const line = read("docs/SERVICE_RULES.md").split("\n").find((l) => l.startsWith("- R32 "));
    expect(line).toBeTruthy();
    expect(line).toContain("[ALL-KINDS]");
    expect(line).toContain("src/shared/boss/service/practices.mjs#servicePracticesBlock");
    expect(line).toMatch(/never spend money/i);
  });

  it("every employee run carries the sentence (R32 in SERVICE_PRACTICES, rendered by the block)", () => {
    const r32 = SERVICE_PRACTICES.find((p) => p.rule === "R32");
    expect(r32?.line).toBe(NEVER_SPEND_RULE);
    expect(servicePracticesBlock([])).toContain(NEVER_SPEND_RULE);
    expect(NEVER_SPEND_RULE).toMatch(/up to the checkout/);
  });
});

describe("agents never spend money — the executor record enforces it", () => {
  it("reads every spend step as one, and a topic that mentions money as not one", () => {
    for (const s of SPEND_STEPS) expect(spendStepIn(s), s).not.toBeNull();
    for (const s of NOT_SPEND) expect(spendStepIn(s), s).toBeNull();
  });

  it("no seat holds owner_spend", () => {
    expect(SPEND_STEPS.length).toBeGreaterThan(0);
    for (const [seat, caps] of Object.entries(SEAT_EXECUTORS)) {
      expect(Object.keys(caps), `${seat} holds owner_spend`).not.toContain("owner_spend");
    }
  });

  it("refuses a spend step for every seat, whatever label the caller puts on it", () => {
    const seats = [...Object.keys(SEAT_EXECUTORS), "emp_knowledge", "emp_risk", "emp_relationship"];
    for (const what of SPEND_STEPS) {
      expect(requiredCapability({ what, requires: "colleague_work" })).toBe("owner_spend");
      for (const helper of seats) {
        const r = checkAssignment({ helper, what, requires: "colleague_work" });
        expect(r.ok, `${helper}: ${what}`).toBe(false);
        if (!r.ok) expect(r.why).toContain("she pays");
      }
    }
  });

  it("still hands Danielle her repo change and Camille her research page", () => {
    expect(checkAssignment({ helper: "emp_repo", what: "creator-studios: change the sign-up copy", requires: "repo_change" }).ok).toBe(true);
    expect(checkAssignment({ helper: "emp_research", what: "Research senior-living referral fees", requires: "research_page" }).ok).toBe(true);
    expect(checkAssignment({ helper: "emp_knowledge", what: "Research senior-living referral fees", requires: "research_page" }).ok).toBe(false);
  });
});
