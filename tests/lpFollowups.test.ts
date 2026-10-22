/**
 * THE POSITIVE REPLIES SHE HAS NOT ANSWERED (owner, 22 Oct 2026).
 *
 * Pins the pure halves of lp-followups.mjs and the two hard rules: it never sends, and no model sees
 * an LP name (the draft is a fixed template, and neither file can reach a model host or a CLI).
 * Fixtures use invented names at example.com — no real LP data in a public repo.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chicagoInstant, daysWaiting, draftBody, firstName, pickSlots, unansweredOrder } from "../scripts/ops/lp-followups.mjs";
import { unansweredSection } from "../scripts/ops/lp-positive.mjs";

const NOW = Date.parse("2026-10-27T13:15:00Z"); // Tuesday 08:15 Chicago
const src = (f: string) => readFileSync(join(__dirname, "..", "scripts", "ops", f), "utf8");

describe("follow-ups: who is waiting, oldest first", () => {
  it("counts days waiting and orders oldest first", () => {
    expect(daysWaiting("2026-10-08", NOW)).toBe(19);
    const rows = unansweredOrder([
      { name: "Avery Example", address: "a@example.com", bucket: "warm", first_seen: "2026-10-20", draft: "new" },
      { name: "Blake Example", address: "b@example.com", bucket: "call", first_seen: "2026-10-01", draft: "waiting" },
    ], NOW);
    expect(rows.map((r) => r.address)).toEqual(["b@example.com", "a@example.com"]);
    expect(rows[0]?.days).toBe(26);
  });

  it("the reminder leads with the count and says nothing is sent", () => {
    const text = unansweredSection({ unanswered: unansweredOrder([{ name: "Blake Example", address: "b@example.com", bucket: "call", first_seen: "2026-10-01", draft: "waiting" }], NOW), stops: [] }).join("\n");
    expect(text).toMatch(/^1 POSITIVE REPLY YOU HAVEN'T ANSWERED — oldest first/);
    expect(text).toContain("26 days waiting");
    expect(text).toContain("draft waiting in your Gmail Drafts");
    expect(text).toMatch(/Nothing is sent/);
    expect(text).toMatch(/label "pass"/);
  });
});

describe("follow-ups: the draft is a fixed template", () => {
  it("offers three open times on different weekdays, skipping busy time and weekends", () => {
    const busy: [number, number][] = [[chicagoInstant("2026-10-29", 10, 0), chicagoInstant("2026-10-29", 12, 0)]];
    const slots = pickSlots(busy, NOW);
    expect(slots).toHaveLength(3);
    const days = slots.map((t) => new Date(t).toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "short" }));
    expect(new Set(days).size).toBe(3);
    expect(days).not.toContain("Sat");
    expect(days).not.toContain("Sun");
    for (const t of slots) for (const [s, e] of busy) expect(t + 30 * 60_000 <= s || t >= e).toBe(true);
    // Two working days out: Tuesday's run never offers Wednesday.
    expect(days[0]).not.toBe("Wed");
  });

  it("uses only the first name and the times, and asks for times when the calendar is unreadable", () => {
    const body = draftBody({ name: "Blake Q. Example", bucket: "call", slots: [chicagoInstant("2026-10-29", 14, 0)] });
    expect(body.startsWith("Hi Blake,")).toBe(true);
    expect(body).not.toContain("Example");
    expect(body).toMatch(/Thursday, October 29.*2:00 PM Central/);
    expect(body.endsWith("Sequoia")).toBe(true);
    expect(draftBody({ name: "", bucket: "warm", slots: [] })).toMatch(/^Hi there,[\s\S]*Send me a couple of times/);
    expect(firstName("<script>")).toBe("there");
  });
});

describe("follow-ups: never sends, and no model sees a name (fail closed)", () => {
  for (const f of ["lp-followups.mjs", "lp-positive.mjs"]) {
    it(`${f} reaches no model host and spawns no CLI`, () => {
      const s = src(f);
      expect(s).not.toMatch(/api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com|openrouter\.ai/i);
      expect(s).not.toMatch(/spawn(Sync)?\(|child_process|routeCompletion|\/router\//);
    });
  }
  it("lp-followups.mjs writes drafts and calls no send endpoint", () => {
    const s = src("lp-followups.mjs");
    expect(s).toContain("/drafts`");
    expect(s).not.toMatch(/drafts\/send|messages\/send|gmail\.send/);
  });
  it("the Tuesday job runs the follow-ups", () => {
    expect(src("install-agent-launchd.sh")).toContain("duty-run.sh lp-positive.mjs -- npm run --silent lp:positive -- --email --followups");
  });
});
