import { describe, expect, it } from "vitest";
import { oneLine, seatForAsk, splitAsks, triage, triageLines } from "../../src/shared/boss/intake/triage.mjs";

/**
 * SIMONE'S TRIAGE (owner, 22 Oct 2026): "i should not have to put an employee name, my main
 * assistant should find out who does it for me." Untagged mail is split into its asks, each ask
 * goes to the seat that can execute it, and nothing ever bounces back to her.
 */
const ROSTER: Array<{ id: string; name: string; role: string; lane: string }> = ([
  ["emp_chief", "Simone", "Chief of Staff", "ops"],
  ["emp_relationship", "Monique", "Director of Relationships", "ops"],
  ["emp_knowledge", "Zora", "Archivist", "ops"],
  ["emp_repo", "Danielle", "Technical Program Manager", "ops"],
  ["emp_continuity", "Kendra", "Systems Manager", "ops"],
  ["emp_risk", "Toni", "Chief Risk Officer", "trading"],
  ["emp_research", "Camille", "Director of Research", "ops"],
  ["emp_practice", "Imani", "Director of Practice", "ops"],
] as Array<[string, string, string, string]>).map(([id, name, role, lane]) => ({ id, name, role, lane }));

const who = (subject: string, text: string) => triage({ subject, text, roster: ROSTER }).map((j) => j.seat.name);

describe("each ask goes to the seat that can execute it", () => {
  it.each([
    ["Build a one-page studio-style landing for a sample studio in seq23/creator-studios.", "Danielle"],
    ["What are the three cheapest ways to host a static site, and what does each cost a month?", "Camille"],
    ["Reach out to the five sponsors on the list and pitch the October event.", "Monique"],
    ["Schedule a call with the designer next Tuesday afternoon.", "Simone"],
    ["Archive the receipts from this trip and keep a copy of the invoices.", "Zora"],
    ["Is there any legal risk in the contract they sent?", "Toni"],
    ["Add a ten-minute meditation to my morning practice.", "Imani"],
    ["Set up an automation that backs up the Mac vault every night.", "Kendra"],
  ])("%s → %s", (text, seat) => {
    expect(who("", text)).toEqual([seat]);
  });
});

describe("a multi-part email splits where the work changes hands", () => {
  it("a numbered list of three different jobs is three jobs, one line each", () => {
    const jobs = triage({
      subject: "a few things",
      text: "Hi, a few things:\n1. Build a landing page for the new studio in seq23/creator-studios\n2. Research the best free email newsletter tools\n3. Schedule a call with the designer next Tuesday",
      roster: ROSTER,
    });
    expect(jobs.map((j) => j.seat.name)).toEqual(["Danielle", "Camille", "Simone"]);
    expect(triageLines(jobs)).toEqual([
      "Danielle has: Build a landing page for the new studio in seq23/creator-studios",
      "Camille has: Research the best free email newsletter tools",
      "Simone has: Schedule a call with the designer next Tuesday",
    ]);
    // The shared context rides along with every job.
    for (const j of jobs) expect(j.text).toContain("a few things");
  });

  it("a list of build steps for one site stays ONE job for Danielle", () => {
    const jobs = triage({ subject: "", text: "fix the footer on the site\n- make the header blue\n- add a contact form", roster: ROSTER });
    expect(jobs.map((j) => j.seat.name)).toEqual(["Danielle"]);
    expect(triageLines(jobs)).toEqual(["Danielle has: fix the footer on the site - make the header blue - add a contact form"]);
  });

  it("an 'also' paragraph is its own ask", () => {
    expect(splitAsks("Build the landing page in seq23/creator-studios.\n\nAlso, research what a studio launch usually costs.").parts).toHaveLength(2);
  });
});

describe("never bounced to her", () => {
  it("an ask no seat fits goes to the closest desk and the line says so", () => {
    const jobs = triage({ subject: "", text: "can you take care of the thing we talked about", roster: ROSTER });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.seat.name).toBe("Simone");
    expect(jobs[0]!.closest).toBe(true);
    expect(triageLines(jobs)[0]).toMatch(/closest fit/);
  });

  it("a seat missing from the live roster is never picked", () => {
    const pick = seatForAsk("Research the cheapest hosting", ROSTER.filter((s) => s.id !== "emp_research"));
    expect(pick?.seat.id).not.toBe("emp_research");
  });

  it("a tag inside the text is not a keyword", () => {
    expect(who("", "#zora")).toEqual(["Simone"]);
  });

  it("returns nothing only when the roster is empty", () => {
    expect(triage({ subject: "x", text: "build a site", roster: [] })).toEqual([]);
  });
});

describe("the acknowledgement quotes her request whole (22 Oct 2026 live defect)", () => {
  it("a hard-wrapped body is joined, never cut at the client's wrap", () => {
    const body = "What are the three cheapest ways to host a static website with a custom\r\ndomain, and what does each cost per month?";
    const jobs = triage({ subject: "cheap static hosting", text: body, roster: ROSTER });
    expect(triageLines(jobs)).toEqual([
      "Camille has: What are the three cheapest ways to host a static website with a custom domain, and what does each cost per month?",
    ]);
  });
  it("only the first paragraph, and no ellipsis anywhere", () => {
    expect(oneLine("Build the page\nin the studio repo.\n\nThanks!")).toBe("Build the page in the studio repo.");
    expect(oneLine("x".repeat(400))).toHaveLength(400);
  });
});
