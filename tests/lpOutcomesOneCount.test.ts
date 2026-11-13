/**
 * LP OUTCOMES: ONE COUNT, THREE LINES (13 Nov 2026). The subject used to count the lists while the
 * body counted the cells changed in that run, so one email said two different sets of numbers.
 * Every number now comes from `outcomeCounts`, and a day with nothing new sends nothing.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain ESM with no declaration file
import { outcomeCounts, outcomesMail, worthEmailing } from "../scripts/ops/lp-outcomes.mjs";
import { sendersFor, employeeMail } from "../scripts/ops/notify.mjs";

process.env.BOSS_OS_MAIL_KEY = "test-key-not-real";
const lists = { optedOut: ["a@example.com", "b@example.com"], replied: Array.from({ length: 7 }, (_, i) => `r${i}@example.com`), bounced: Array.from({ length: 11 }, (_, i) => `x${i}@example.com`) };

describe("the LP outcomes email", () => {
  const counts = outcomeCounts(lists);
  const mail = outcomesMail(counts);
  const laid = employeeMail(sendersFor("Monique")[0]!, { to: "o@example.com", subject: mail.subject, layout: mail.layout, owner: mail.owner });
  const numbersIn = (t: string) => (t.match(/\b\d+\b/g) ?? []).map(Number);

  it("says the same three numbers in the subject, line 1 and the body", () => {
    expect(counts).toEqual({ optedOut: 2, replied: 7, bounced: 11 });
    expect(numbersIn(laid.subject)).toEqual([2, 7, 11]);
    const body = laid.text.split("\n").filter((l: string) => /\d/.test(l) && /bounced/.test(l));
    expect(body.length).toBeGreaterThan(0);
    for (const l of body) expect(numbersIn(l)).toEqual([2, 7, 11]);
  });

  it("is three lines and carries no address to copy anywhere", () => {
    expect([mail.owner.why, mail.layout.happened, ...mail.layout.details]).toHaveLength(3);
    expect(laid.text).not.toMatch(/@example\.com/);
    expect(laid.html).not.toMatch(/@example\.com/);
  });

  it("is sent only when a number moved, and never when all three are zero", () => {
    expect(worthEmailing(counts, null)).toBe(true);
    expect(worthEmailing(counts, { ...counts })).toBe(false);
    expect(worthEmailing({ ...counts, replied: 8 }, { ...counts })).toBe(true);
    expect(worthEmailing({ optedOut: 0, replied: 0, bounced: 0 }, null)).toBe(false);
  });
});
