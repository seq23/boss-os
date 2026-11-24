/**
 * THE DIGEST MUST SEE AHREFS' PER-ISSUE ALERTS (24 Nov 2026). The mail digest asked for emails with
 * "subject containing Site Audit". Ahrefs now sends one alert per issue from sa@ahrefs.com, subject
 * "(Project) Issue: N URLs", with no "Site Audit" in it, so the 21 Nov pass wrote
 * "NO AHREFS SITE AUDIT MAIL THIS WEEK" while 33 alerts sat in the mailbox. This reads the exact
 * prompt the digest model is handed and fails if it filters on the subject again, stops searching
 * the sender in all mail, or lets "nothing" come back without the searches and their counts.
 */
import { it, expect } from "vitest";
import { readFileSync } from "node:fs";

const script = readFileSync("scripts/ops/ahrefs-audit-fix.sh", "utf8");
const line = script.split("\n").find((l) => l.includes('--role "$DIGEST_ROLE" --out "$AHREFS_DIGEST"')) ?? "";
const prompt = line.slice(line.indexOf('-- "') + 4);

it("the digest step exists and hands the model a prompt", () => {
  expect(prompt.length).toBeGreaterThan(100);
});

it("searches the Ahrefs sender across all mail, not a subject filter", () => {
  expect(prompt).toContain("from:sa@ahrefs.com");
  expect(prompt).toContain("in:anywhere");
  expect(prompt).not.toMatch(/subject containing/i);
});

it("names the per-issue alert shape so the model counts it", () => {
  expect(prompt).toMatch(/one alert email per issue/);
  expect(prompt).toContain("(Spry) 3XX redirect: 2 URLs");
});

it("a 'nothing' answer must carry every search and its count", () => {
  expect(prompt).toMatch(/NO AHREFS SITE AUDIT MAIL THIS WEEK followed by every search you ran and how many emails each returned/);
});

it("the digest always opens with its SEARCHED record and the worker is told to carry it", () => {
  expect(prompt).toMatch(/first line is always, even in a week with no mail, SEARCHED: mailbox=/);
  expect(prompt).toMatch(/If there were none, keep the SEARCHED line first/);
  expect(script).toContain("copy it into your report's");
});
