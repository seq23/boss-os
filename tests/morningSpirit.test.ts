/**
 * SPIRIT IN THE MORNING EMAIL (owner-approved sample, 24 Oct 2026) and FAILED TASKS TOLD AS DONE.
 * Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import { buildDay, spiritSection, failedTaskLines, ancestralLine } from "../scripts/ops/your-day.mjs";
import { ancestralHourState } from "../src/worker/boss/spirit/ancestralHour";

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
      // Trimmed (owner, 25 Oct 2026): the week's practice as ONE short line, no source.
      "This week's practice: Pick one friction point and write the rule.",
    ]);
    expect(s.link).toEqual({ label: "See the full sky, body and practice in Boss OS →", url: "https://boss.sequoiataylor.com/?tab=spirit" });
    expect(s.full).toBeUndefined();
  });
  it("an if-then practice reads as the plan itself, in one sentence", () => {
    const s = spiritSection(DAY, { practice: { technique: "Implementation Intentions (if-then planning)", how_to_try_it: "Pick one existing habit loop. Write it as a concrete if-then: 'If I finish my morning coffee, then I do 5 minutes of breathwork.' The specificity matters.", source_name: "A study" } }, NOW)!;
    expect(s.items.at(-1).runs[0].text).toBe("This week's practice: Implementation Intentions: If I finish my morning coffee, then I do 5 minutes of breathwork.");
  });
  it("sits after Monique found and before the briefing; the sky in full, Body, Manifestations and the advisory are one link away", () => {
    const e = buildDay({ diary: [], tasks: [], approvals: [], repoChanges: [], briefing: null, feed: { items: [] }, morning: {}, spirit: DAY, practiceWeek: WEEK }, NOW);
    const t = e.text.replace(/⁣/g, "");
    expect(t.indexOf("✨ Spirit")).toBeGreaterThan(-1);
    expect(t.indexOf("✨ Spirit")).toBeLessThan(t.indexOf("This morning's briefing"));
    for (const gone of ["Today's sky in full", "Venus square your Mercury", "Body", "Drink water first", "Manifestations", "never a cause and never a permission", "Source:", "doi.example", "Show more ▾"]) {
      expect(t, gone).not.toContain(gone);
      expect(e.html, gone).not.toContain(gone);
    }
    expect(t).toContain("See the full sky, body and practice in Boss OS →: https://boss.sequoiataylor.com/?tab=spirit");
    expect(e.problems).toEqual([]);
  });
});

describe("the ancestral hour above the fold (owner, 31 Oct 2026)", () => {
  it("in the window and not done: one line right after the greeting, the same countdown as Today", () => {
    expect(ancestralLine({ ancestral_hour: ancestralHourState("2026-10-31", 0) })).toBe(
      "🕯 Ancestral hour: today is the last day. When it's finished, tap Done on Today or in the reminder email.",
    );
    const e = buildDay({ diary: [], tasks: [], approvals: [], repoChanges: [], briefing: null, feed: { items: [] }, morning: {}, spirit: { ...DAY, ancestral_hour: ancestralHourState("2026-10-28", 0) }, practiceWeek: WEEK }, NOW);
    const t = e.text.replace(/\u2063/g, "");
    const line = "🕯 Ancestral hour: 3 days left this month.";
    expect(t.indexOf(line)).toBeGreaterThan(-1);
    expect(t.indexOf(line)).toBeLessThan(t.indexOf("✨ Spirit"));
    expect(t.split("\n").slice(0, 2).join(" ")).toContain(line);
    expect(e.html).toContain("Ancestral hour: 3 days left this month");
    expect(e.problems).toEqual([]);
    // The month line counts with the same rule.
    expect(t).toContain("This month · 3 days left: 🕯 Ancestors hour: 0 of 60 min");
  });
  it("done, or outside the window: no line", () => {
    expect(ancestralLine({ ancestral_hour: ancestralHourState("2026-10-31", 60) })).toBeNull();
    expect(ancestralLine({ ancestral_hour: ancestralHourState("2026-10-20", 0) })).toBeNull();
    expect(ancestralLine(null)).toBeNull();
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
