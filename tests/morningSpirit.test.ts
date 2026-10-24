/**
 * SPIRIT IN THE MORNING EMAIL (owner-approved sample, 24 Oct 2026) and FAILED TASKS TOLD AS DONE.
 * Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import { buildDay, spiritSection, failedTaskLines } from "../scripts/ops/your-day.mjs";

const NOW = Date.parse("2026-10-24T12:15:00Z");
const DAY = {
  note: "Advisory only. The sky is context, never a cause and never a permission. Nothing here blocks an action, schedules work, or explains an outcome.",
  map: { current: { label: "Oct 19–25", band: "peak_green", signal: "🟢🟢", note: "Peak money week—finalize major opportunities" } },
  major_event: { kind: "full_moon", label: "Full Moon in Taurus", at: Date.parse("2026-10-26T02:00:00Z"), hours_away: 37 },
  sky: { available: true, active: [
    { body_name: "Venus", aspect: "square", natal_point_name: "Mercury", meaning: "Money meets how you think. Friction; it wants a decision. Lasts a day or two." },
    { body_name: "Mercury", aspect: "trine", natal_point_name: "Jupiter", meaning: "An easy growth window. Lasts a day or two." },
  ] },
  practice: { gratitude: { sentence: "Grateful for the people behind me who never needed to be asked." }, manifestation: { steps: [
    { minutes: 2, what: "Slow breathing." }, { minutes: 5, what: "Visualize the finished thing." }, { minutes: 2, what: "Name today's one action." },
  ] } },
  ancestors: { minutes: 0, target_minutes: 60 }, contribution: { count: 0, minimum: 1 }, manifestations: { open: 0 },
};
const WEEK = { practice: { technique: "If-then plans", how_to_try_it: "Pick one friction point and write the rule.", source_name: "A study (2006)", source_url: "https://doi.example/x" }, body: { suggestion: "Drink water first.", why: "It helps." } };

describe("the Spirit section, as she approved it", () => {
  it("above the fold: the week, the moon, the sky in one line, the practice in one line, gratitude, the month", () => {
    const s = spiritSection(DAY, WEEK, NOW)!;
    const top = s.items.map((i: any) => i.runs.map((r: any) => r.text).join(""));
    expect(top).toEqual([
      "🟢🟢 Peak money week (Oct 19–25). Finalize major opportunities.",
      "🌕 Full Moon in Taurus Sunday night, about 37 hours away.",
      "⚡ Today: the sky says make the decision rather than wait. There's also an easy opening for growth, so use it.",
      "This morning · 9 min: Breathe 2 → visualize 5 → name today's one action 2.",
      "“Grateful for the people behind me who never needed to be asked.”",
      "This month · 7 days left: 🕯 Ancestors hour: 0 of 60 min · 🤝 Contribution: 0 of 1.",
    ]);
    expect(s.link).toEqual({ label: "Open Spirit →", url: "https://boss.sequoiataylor.com/?tab=spirit" });
    expect(s.full.summary).toBe("Show more ▾");
    expect(s.full.blocks.map((b: any) => b.heading)).toEqual(["Today's sky in full", "Body", "This week's practice: If-then plans", "Manifestations", ""]);
  });
  it("sits after Monique found and before the briefing, folds the rest, and keeps the advisory note", () => {
    const e = buildDay({ diary: [], tasks: [], approvals: [], repoChanges: [], briefing: null, feed: { items: [] }, morning: {}, spirit: DAY, practiceWeek: WEEK }, NOW);
    const t = e.text.replace(/⁣/g, "");
    expect(t.indexOf("✨ Spirit")).toBeGreaterThan(-1);
    expect(t.indexOf("✨ Spirit")).toBeLessThan(t.indexOf("This morning's briefing"));
    expect(t).toContain("- Venus square your Mercury: Money meets how you think.");
    expect(t).toContain("never a cause and never a permission");
    expect(e.html).toMatch(/<summary[^>]*>Show more ▾<\/summary>/);
    expect(e.problems).toEqual([]);
  });
});

describe("a failed task is the team's to fix, told as done", () => {
  it("says what happened, what we did and the status, only for failures since yesterday", () => {
    const lines = failedTaskLines([
      { id: "tsk_1", status: "failed", title: "Weekly report", employee_name: "Camille", error: "stdout was not JSON\nmore", finished_at: NOW - 3_600_000 },
      { id: "tsk_2", status: "failed", title: "Old one", finished_at: NOW - 5 * 86_400_000 },
      { id: "tsk_3", status: "done", title: "Fine", finished_at: NOW },
    ], NOW);
    expect(lines).toEqual([{ id: "tsk_1", text: 'What happened: Camille\'s "Weekly report" stopped (stdout was not JSON). What we did: Danielle has a job to find the cause and fix it at source. Status: being fixed; nothing needed from you.' }]);
  });
});
