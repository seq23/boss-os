/**
 * BRAINS — the shared definition, the morning email's two pieces, and the local copy. Pinned against
 * the "Brains" section of CLAUDE.md, which this file reads. Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as B from "../src/shared/boss/brains/brain.mjs";
import { brainsSectionFor, scoreboardSectionFor, buildDay } from "../scripts/ops/your-day.mjs";
import { pull, header } from "../scripts/brains/pull.mjs";

const claude = readFileSync(join(__dirname, "..", "CLAUDE.md"), "utf8");
const section = claude.slice(claude.indexOf("## Brains: one document per business, read first")).replace(/\s+/g, " ");

describe("the rules in CLAUDE.md are the rules in code", () => {
  it("names every brain slug and every section, in order", () => {
    expect(section.length).toBeGreaterThan(200);
    for (const slug of B.BRAIN_SLUGS) expect(section).toContain(`\`${slug}\``);
    expect(section).toContain(B.SECTIONS.join(", "));
    expect(section).toContain(B.NUMBERS_HEADER);
    expect(section).toContain("<!-- confidential -->…<!-- /confidential -->");
    expect(B.CONFIDENTIAL_OPEN).toBe("<!-- confidential -->");
    expect(B.CONFIDENTIAL_CLOSE).toBe("<!-- /confidential -->");
    expect(B.BRAINS).toHaveLength(10);
  });
});

describe("the skeleton and its gaps", () => {
  it("has the eight sections in order, each a gap", () => {
    const md = B.skeleton("Spry");
    expect(B.parseSections(md).sections.map((s) => s.name)).toEqual([...B.SECTIONS]);
    expect(B.missingCount(md)).toBe(8);
    expect(B.numbersRows(md)).toEqual([]);
  });
  it("the team doc is one plain document with no gaps", () => {
    const md = B.seedFor("team", "Who's who — your AI teams");
    expect(B.parseSections(md).sections).toEqual([]);
    expect(B.missingCount(md)).toBe(0);
  });
  it("replacing one section keeps the others and their order", () => {
    const md = B.replaceSection(B.skeleton("X"), "priorities", "1. a\n2. b");
    expect(B.sectionBody(md, "Priorities")).toBe("1. a\n2. b");
    expect(B.parseSections(md).sections.map((s) => s.name)).toEqual([...B.SECTIONS]);
    expect(B.missingCount(md)).toBe(7);
  });
  it("stale means untouched for more than 90 days", () => {
    const now = Date.parse("2026-11-02T12:00:00Z");
    expect(B.isStale(now - 91 * 86_400_000, now)).toBe(true);
    expect(B.isStale(now - 89 * 86_400_000, now)).toBe(false);
  });
});

describe("private spans", () => {
  it("cuts closed, repeated, mixed-case and unclosed spans; a stray close mark goes too", () => {
    expect(B.stripConfidential("a <!-- confidential -->LP<!-- /confidential --> b")).toBe("a (private part removed) b");
    expect(B.stripConfidential("x <!--CONFIDENTIAL-->terms and everything after")).toBe("x (private part removed)");
    const two = B.stripConfidential("<!-- confidential -->one<!-- /confidential --> and <!-- confidential -->two<!-- /confidential --> end");
    expect(two).not.toMatch(/one|two/);
    expect(B.stripConfidential("left <!-- /confidential --> right")).toBe("left  right");
    expect(B.hasConfidential(two)).toBe(false);
  });
  it("the brain block keeps them only when asked to (the Claude seat)", () => {
    const brain = { slug: "spry", title: "Spry", body_md: B.replaceSection(B.skeleton("Spry"), "People", "Buyer: <!-- confidential -->Synthetic Fund Q<!-- /confidential -->") };
    expect(B.brainBlock([brain])).not.toContain("Synthetic Fund Q");
    expect(B.brainBlock([brain], { keepConfidential: true })).toContain("Synthetic Fund Q");
    expect(B.brainBlock([brain], { summarised: true })).toContain("### Spry");
  });
});

describe("who reads which brain", () => {
  it("maps the roster: Camille P&P, Monique the fund, Simone everything plus personal, Toni nothing", () => {
    expect(B.brainsFor("emp_research").slugs).toEqual(["porch-and-party"]);
    expect(B.brainsFor("emp_relationship").slugs).toContain("west-peek-ventures");
    const simone = B.brainsFor("emp_chief");
    expect(simone.summarised).toBe(true);
    expect(simone.slugs).toEqual([...B.BUSINESS_SLUGS, "personal"]);
    expect(B.brainsFor("emp_repo").slugs).not.toContain("personal");
    expect(B.brainsFor("emp_risk").slugs).toEqual([]);
    expect(B.brainsFor(null).slugs).toEqual([]);
  });
  it("the who's who is empty while the team doc is still its placeholder", () => {
    expect(B.whosWhoBlock({ body_md: B.seedFor("team", "Who's who") })).toBe("");
    expect(B.whosWhoBlock({ body_md: "# Who's who\n\nCamille: P&P." })).toContain("Camille: P&P.");
  });
});

describe("edits in her words", () => {
  const today = "2026-10-31";
  it("reads the brain names she uses", () => {
    expect(B.brainSlugFor("P&P")).toBe("porch-and-party");
    expect(B.brainSlugFor("pnp")).toBe("porch-and-party");
    expect(B.brainSlugFor("time-2-read")).toBe("time-2-read");
    expect(B.brainSlugFor("TLC")).toBe("west-peek-events");
    expect(B.brainSlugFor("westpeek.live")).toBe("westpeek-live");
    expect(B.brainSlugFor("lunch")).toBeNull();
  });
  it("a settled decision becomes a dated line with its why", () => {
    const [e] = B.parseBrainEdits("P&P brain: add settled decision No rentals in December — the crew is off", today);
    expect(e).toMatchObject({ slug: "porch-and-party", section: "Settled decisions", op: "add" });
    expect(e!.lines).toEqual(["- 2026-10-31 — No rentals in December — the crew is off"]);
    expect(B.decisionLine("Keep prices", today)).toBe("- 2026-10-31 — Keep prices — [MISSING]");
  });
  it("numbered priorities, on one line or several", () => {
    expect(B.parseBrainEdits("time-2-read priorities: 1 grow 2 hire", today)[0]!.lines).toEqual(["1. grow", "2. hire"]);
    const multi = B.parseBrainEdits("spry brain: priorities:\n1. ship\n2. sell\nThanks", today)[0]!;
    expect(multi).toMatchObject({ slug: "spry", section: "Priorities", op: "replace", lines: ["1. ship", "2. sell"] });
  });
  it("sets a number and never touches the others", () => {
    const [e] = B.parseBrainEdits("spry brain: set Sales to 3", today);
    expect(e).toMatchObject({ op: "set_number", metric: "Sales", value: "3" });
    const md = B.applyEdit(B.skeleton("Spry"), e!, today);
    expect(B.numbersRows(md)).toEqual([{ metric: "Sales", definition: "[MISSING]", source: "[MISSING]", value: "3", last_updated: today }]);
  });
  it("an ordinary sentence is not an edit", () => {
    expect(B.parseBrainEdits("Can you move lunch to Friday?\nThe team decisions: later\nWho's who decisions: none", today)).toEqual([]);
  });
});

describe("the scoreboard never invents", () => {
  it("'not tracked yet' for a missing value or an empty table; personal and team are not on it", () => {
    const md = B.setNumber(B.skeleton("X"), "Leads", "[MISSING]", "2026-10-31");
    expect(B.scoreboardRows({ slug: "spry", title: "Spry", body_md: md })[0]).toMatchObject({ metric: "Leads", value: null, words: "not tracked yet" });
    expect(B.scoreboardRows({ slug: "spry", title: "Spry", body_md: B.skeleton("Spry") })).toEqual([expect.objectContaining({ metric: null, words: "not tracked yet" })]);
    expect(B.scoreboardRows({ slug: "personal", title: "Personal", body_md: md })).toEqual([]);
    expect(B.scoreboardRows({ slug: "team", title: "Team", body_md: md })).toEqual([]);
  });
});

describe("Simone's morning email", () => {
  const MONDAY = Date.parse("2026-11-02T13:00:00Z");
  const FIRST = Date.parse("2026-12-01T13:00:00Z"); // a Tuesday
  const TUESDAY = Date.parse("2026-11-03T13:00:00Z");

  it("Mondays carry one plain Brains line; other days none", () => {
    const s = brainsSectionFor({ brainsCheck: { line: "Brains: all fresh" } }, MONDAY);
    expect(s!.items[0].text).toBe("Brains: all fresh");
    expect(s!.tone).not.toBe("alarm");
    expect(brainsSectionFor({ brainsCheck: { line: "x" } }, TUESDAY)).toBeNull();
    expect(brainsSectionFor({}, MONDAY)!.items[0].text).toMatch(/did not load/);
  });

  it("the 1st carries one grid, business × key numbers, with a link; never a made-up number", () => {
    const rows = [
      { slug: "spry", business: "Spry", metric: "Sales", value: "3", words: "3", last_updated: "2026-11-20" },
      { slug: "spry", business: "Spry", metric: "Visitors", value: null, words: "not tracked yet", last_updated: null },
      { slug: "friends", business: "Friends' businesses", metric: null, value: null, words: "not tracked yet", last_updated: null },
    ];
    const s = scoreboardSectionFor({ scoreboard: rows }, FIRST)!;
    expect(s.rows.data).toEqual([
      { business: "Spry", numbers: "Sales: 3 · Visitors: not tracked yet", updated: "November 20" },
      { business: "Friends' businesses", numbers: "not tracked yet", updated: "not yet" },
    ]);
    expect(s.link.url).toMatch(/\?tab=brains&view=scoreboard$/);
    expect(scoreboardSectionFor({ scoreboard: rows }, MONDAY)).toBeNull();
  });

  it("both reach the built email and it passes the plain-email gate", () => {
    const base = { tasks: [], approvals: [], repoChanges: [], morning: {}, waiting: [], carried: [], settings: [] };
    const mon = buildDay({ ...base, brainsCheck: { line: "Brains: P&P brain not updated in 94 days · 6 gaps across 3 brains" } }, MONDAY);
    expect(JSON.stringify(mon)).toContain("P&P brain not updated in 94 days");
    const first = buildDay({ ...base, scoreboard: [{ slug: "spry", business: "Spry", metric: "Sales", value: "3", words: "3", last_updated: "2026-11-20" }] }, FIRST);
    expect(JSON.stringify(first)).toContain("Scoreboard: this month");
  });
});

describe("the local copy", () => {
  function fakeBossOS(brains: { slug: string; title: string; body_md: string }[]) {
    const calls: string[] = [];
    const impl = async (url: string, init?: any) => {
      calls.push(url);
      if (url.endsWith("/auth/unlock")) {
        expect(JSON.parse(init.body).passcode).toBe("test-passcode");
        return new Response("{}", { status: 200, headers: { "set-cookie": "boss_session=abc; Path=/" } });
      }
      if (url.endsWith("/api/boss/brains")) return Response.json({ ok: true, data: { brains: brains.map(({ slug, title }) => ({ slug, title })) } });
      const slug = decodeURIComponent(url.split("/").pop()!);
      return Response.json({ ok: true, data: brains.find((b) => b.slug === slug) });
    };
    return { impl, calls };
  }

  it("writes every brain with its header, private spans kept", async () => {
    const out = mkdtempSync(join(tmpdir(), "brains-"));
    const body = B.replaceSection(B.skeleton("Spry"), "People", "<!-- confidential -->Synthetic Fund Q<!-- /confidential -->");
    const { impl } = fakeBossOS([{ slug: "spry", title: "Spry", body_md: body }, { slug: "team", title: "Team", body_md: "# Team\n" }]);
    const at = new Date("2026-10-31T12:00:00Z");
    const written = await pull({ out, passcode: "test-passcode", fetchImpl: impl as any, origin: "https://boss.test", now: at });
    expect(written).toHaveLength(2);
    expect(readdirSync(out).sort()).toEqual(["spry.md", "team.md"]);
    const file = readFileSync(join(out, "spry.md"), "utf8");
    expect(file.split("\n")[0]).toBe("Source: Boss OS · pulled 2026-10-31T12:00:00.000Z · edit in Boss OS, not here");
    expect(header(at)).toBe(file.split("\n")[0]);
    expect(file).toContain("Synthetic Fund Q");
  });

  it("Rule 0: no passcode or no brains is a named stop, never a quiet success", async () => {
    await expect(pull({ out: mkdtempSync(join(tmpdir(), "brains-")), passcode: "" })).rejects.toThrow(/NO_PASSCODE/);
    const { impl } = fakeBossOS([]);
    await expect(pull({ out: mkdtempSync(join(tmpdir(), "brains-")), passcode: "test-passcode", fetchImpl: impl as any, origin: "https://boss.test" })).rejects.toThrow(/NO_BRAINS/);
  });
});
