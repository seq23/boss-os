import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { api, apiJson, row, all, uid } from "./helpers";
import { PROJECTS, activeProjects, firstMoneyProject } from "../../src/worker/boss/today/projects";
import { proposedPriorities, wealthContract, executionContract } from "../../src/worker/boss/today/pillars";

/**
 * THE AGENDA THAT WAS NEVER AN AGENDA.
 *
 * §26 wants a Daily Anchor, four Pillar Contracts and a Run of Show. Body was real; Spirit, Wealth
 * and Execution returned `{ available: false }` every single morning. Each reason was honest, and
 * all three had one cause: the gate collected nothing to build them from, because the OS knew her
 * pillars and her laws and did not know her WORK. `wealth_tracks` 0 rows, `deals` 0, `relationships`
 * 0, `open_loops` 0.
 *
 * The owner's sentence for the whole point: "take away the cognitive load of figuring out what i
 * should do each day." A gate with three blank priority fields was the load, not the relief.
 */

const DAY = "2026-09-07";

async function clean() {
  await env.DB.prepare(`DELETE FROM sourcing_candidates`).run();
  await env.DB.prepare(`DELETE FROM relationships`).run();
  await env.DB.prepare(`DELETE FROM people`).run();
  await env.DB.prepare(`DELETE FROM open_loops`).run();
  await env.DB.prepare(`DELETE FROM days WHERE id = ?`).bind(DAY).run();
}

describe("the project list is a decision, not a collection", () => {
  it("keeps exactly one active project per revenue lane", () => {
    /*
     * §5.2: "Only explicitly named projects are active in execution." The count IS the feature —
     * four revenue lines against two weekend days means each is worked about twice a month, and the
     * answer to that is not more parallelism, it is that parked is a real state.
     */
    const active = activeProjects();
    const lanes = active.map((p) => p.lane);
    expect(new Set(lanes).size).toBe(lanes.length);
    expect(active.length).toBeLessThanOrEqual(3);
  });

  it("gives the brokerage right of first refusal on the first money move", () => {
    // §5.3, quoted rather than weighed each morning.
    expect(firstMoneyProject().key).toBe("brokerage");
    expect(firstMoneyProject({ brokerageBlocked: true }).key).toBe("west_peek_raise");
  });

  it("never gives a parked or maintained line a next action", () => {
    // A parked line with a next action is not parked. This is the whole mechanism by which holding
    // six lines costs nothing.
    for (const p of PROJECTS) {
      if (p.status !== "active") expect(p.next_action, `${p.key} is ${p.status} and has a next action`).toBeNull();
      else expect(p.next_action, `${p.key} is active with nothing to do`).toBeTruthy();
    }
  });

  it("carries no company or counterparty name anywhere", () => {
    /*
     * Her standing rule: "i wont put client names or company names in the OS." The properties listed
     * are her own public sites; the two lanes that touch counterparties carry none at all.
     */
    const text = JSON.stringify(PROJECTS);
    for (const lane of ["brokerage", "west_peek"]) {
      const p = PROJECTS.find((x) => x.lane === lane)!;
      expect(p.properties, `${lane} must not enumerate properties`).toBeUndefined();
    }
    expect(text).not.toMatch(/\bclient\b.*repo/i);
  });

  it("treats the backlink network as infrastructure rather than a line", () => {
    // A cost centre competing with revenue lines for slots is how it wins one.
    const infra = PROJECTS.find((p) => p.key === "authority_network")!;
    expect(infra.status).not.toBe("active");
    expect(infra.next_action).toBeNull();
  });
});

describe("the wealth contract — the most load-bearing line on the screen", () => {
  beforeEach(clean);

  it("puts the analyst's work at the top of the day, ahead of everything else", async () => {
    /*
     * HER DIRECTION, AND IT REVERSES WHAT THIS CONTRACT USED TO HAND HER: "you are my analyst and u
     * need to help me find business", "what flows down to my agenda should be to review the work an
     * analyst has done for me", and "calls are a no."
     *
     * Every earlier version made the first money move HER research. The sourcing sweep runs at 06:45
     * and leaves candidates on the desk, so the move is a DECISION on work already done — the one
     * part that cannot be delegated, and the cheapest thing she does all day.
     *
     * REVIEW OUTRANKS AN OVERDUE TOUCH. An unreviewed pile is what a sourcing agent becomes when
     * nobody looks at it, and a stale pile is worse than none: it teaches her the output does not
     * matter.
     */
    const personId = uid("per");
    await env.DB.prepare(`INSERT INTO people (id, lane, full_name, privacy_class, created_at, updated_at) VALUES (?,?,?,?,?,?)`)
      .bind(personId, "ops", "OVERDUE_NAME", "restricted", Date.now(), Date.now()).run();
    await env.DB.prepare(
      `INSERT INTO relationships (id, person_id, lane, kind, relationship_health, next_touch_due_at, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?, 'active', ?, ?)`,
    ).bind(uid("rel"), personId, "ops", "professional", 90, Date.now() - 86_400_000, Date.now(), Date.now()).run();

    await env.DB.prepare(
      `INSERT INTO sourcing_candidates (id, name, kind, ticket_floor_usd, thesis, source_url, source_name, origin, status, created_at, updated_at)
       VALUES (?,?, 'buyer', ?, ?, ?, ?, 'public_research', 'new', ?, ?)`,
    ).bind(uid("src"), "Example Secondaries Partners", 25_000_000, "Direct secondaries in late-stage software.",
           "https://example.com/x", "Strategy page", Date.now(), Date.now()).run();

    const c = await wealthContract(env as any, 1);
    expect(c.action).toMatch(/^Review 1 candidate/);
    expect(c.action).not.toMatch(/OVERDUE_NAME/);
    expect(c.detail!.join(" ")).toContain("Example Secondaries Partners");
    // The size she actually cares about is on the line, not buried.
    expect(c.detail!.join(" ")).toContain("$25M+");
  });

  it("never asks her to make a call", async () => {
    /*
     * "calls are a no." A contract that says "call SANDPIPER" is one she will not do, and an agenda
     * she does not do is worse than none — it trains her to skip the screen.
     */
    await env.DB.prepare(
      `INSERT INTO sourcing_candidates (id, name, kind, source_url, origin, status, created_at, updated_at)
       VALUES (?,?, 'buyer', ?, 'public_research', 'new', ?, ?)`,
    ).bind(uid("src"), "Anything Capital", "https://example.com/y", Date.now(), Date.now()).run();
    const c = await wealthContract(env as any, 1);
    expect(`${c.action} ${c.why}`).not.toMatch(/call/i);
  });

  it("falls back to the overdue touch once the pile is reviewed", async () => {
    const personId = uid("per");
    await env.DB.prepare(`INSERT INTO people (id, lane, full_name, privacy_class, created_at, updated_at) VALUES (?,?,?,?,?,?)`)
      .bind(personId, "ops", "SANDPIPER", "restricted", Date.now(), Date.now()).run();
    await env.DB.prepare(
      `INSERT INTO relationships (id, person_id, lane, kind, relationship_health, next_touch_due_at, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?, 'active', ?, ?)`,
    ).bind(uid("rel"), personId, "ops", "professional", 90, Date.now() - 86_400_000, Date.now(), Date.now()).run();
    // Reviewed, so it no longer competes for the top of the day.
    await env.DB.prepare(
      `INSERT INTO sourcing_candidates (id, name, kind, source_url, origin, status, created_at, updated_at)
       VALUES (?,?, 'buyer', ?, 'public_research', 'reviewed', ?, ?)`,
    ).bind(uid("src"), "Already Seen", "https://example.com/z", Date.now(), Date.now()).run();

    const c = await wealthContract(env as any, 1);
    expect(c.action).toContain("SANDPIPER");
  });

  it("bootstraps itself when there are no names, instead of going blank", async () => {
    /*
     * An empty list is a DIFFERENT first money move, not the absence of one — and a completable one.
     * Leaving the most important line blank on the one morning it could most cheaply be fixed is
     * the failure this replaces.
     */
    const c = await wealthContract(env as any, 1);
    expect(c.available).toBe(true);
    expect(c.action).toMatch(/five people/i);
    // A degraded contract names its own gap rather than looking complete.
    expect(c.gap).toContain("relationships is empty");
  });

  it("names the actual person once the list exists, with how long it has been", async () => {
    const personId = uid("per");
    const relId = uid("rel");
    const ninetyDays = Date.now() - 90 * 86_400_000;
    await env.DB.prepare(`INSERT INTO people (id, lane, full_name, privacy_class, created_at, updated_at) VALUES (?,?,?,?,?,?)`)
      .bind(personId, "ops", "SANDPIPER", "restricted", Date.now(), Date.now()).run();
    await env.DB.prepare(
      `INSERT INTO relationships (id, person_id, lane, kind, strategic_importance, relationship_health, cadence_days, last_contact_at, next_touch_due_at, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?, 'active', ?, ?)`,
    ).bind(relId, personId, "ops", "professional", 90, 80, 30, ninetyDays, Date.now() - 1000, Date.now(), Date.now()).run();

    const c = await wealthContract(env as any, 1);
    expect(c.action).toContain("SANDPIPER");
    expect(c.detail!.join(" ")).toMatch(/90 days since last contact/);
    expect(c.gap).toBeUndefined();
  });

  it("reads the name from `people`, which is the join a wrong column would have hidden", async () => {
    /*
     * THE BUG THIS PINS. An earlier draft selected `r.code_name` — a column `relationships` does not
     * have — inside a `.catch(() => [])`. The error became an empty list, so the bootstrap message
     * would have shown every morning for ever, including long after she filled the list in, and
     * nothing would ever have said why. The catch is gone; this proves the join works.
     */
    const personId = uid("per");
    await env.DB.prepare(`INSERT INTO people (id, lane, full_name, privacy_class, created_at, updated_at) VALUES (?,?,?,?,?,?)`)
      .bind(personId, "ops", "HERON", "restricted", Date.now(), Date.now()).run();
    await env.DB.prepare(
      `INSERT INTO relationships (id, person_id, lane, kind, relationship_health, next_touch_due_at, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?, 'active', ?, ?)`,
    ).bind(uid("rel"), personId, "ops", "professional", 70, Date.now() - 1, Date.now(), Date.now()).run();

    const c = await wealthContract(env as any, 1);
    expect(c.action).toContain("HERON");
  });

  it("says nobody is overdue rather than calling a good day a gap", async () => {
    const personId = uid("per");
    await env.DB.prepare(`INSERT INTO people (id, lane, full_name, privacy_class, created_at, updated_at) VALUES (?,?,?,?,?,?)`)
      .bind(personId, "ops", "KESTREL", "restricted", Date.now(), Date.now()).run();
    await env.DB.prepare(
      `INSERT INTO relationships (id, person_id, lane, kind, next_touch_due_at, status, created_at, updated_at)
       VALUES (?,?,?,?,?, 'active', ?, ?)`,
    ).bind(uid("rel"), personId, "ops", "professional", Date.now() + 10 * 86_400_000, Date.now(), Date.now()).run();

    const c = await wealthContract(env as any, 1);
    expect(c.available).toBe(true);
    expect(c.gap).toBeUndefined();
    expect(c.action).toMatch(/get ahead/i);
  });
});

describe("the execution contract closes before it starts", () => {
  beforeEach(clean);

  it("surfaces the oldest open loop, by the column this table actually has", async () => {
    /*
     * THE SECOND HIDDEN-COLUMN BUG. An earlier draft ordered by `opened_at`, which does not exist,
     * behind a `.catch(() => null)` — so a month-old rotting loop would have reported "nothing is
     * owed". `open_loops` uses `created_at`.
     */
    await env.DB.prepare(`INSERT INTO days (id, date_ts, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING`)
      .bind(DAY, Date.parse(`${DAY}T00:00:00Z`), Date.now()).run();
    const old = Date.now() - 12 * 86_400_000;
    await env.DB.prepare(
      `INSERT INTO open_loops (id, day_id, kind, title, priority, status, created_at, updated_at) VALUES (?,?,?,?,?, 'open', ?, ?)`,
    ).bind(uid("loop"), DAY, "other", "Ship the partnership deck", 3, old, old).run();

    const c = await executionContract(env as any, 1);
    expect(c.action).toContain("Ship the partnership deck");
    expect(c.why).toContain("12 days old");
  });

  it("lets priority break the tie so an old trivial loop cannot outrank an urgent one", async () => {
    await env.DB.prepare(`INSERT INTO days (id, date_ts, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING`)
      .bind(DAY, Date.parse(`${DAY}T00:00:00Z`), Date.now()).run();
    await env.DB.prepare(`INSERT INTO open_loops (id, day_id, kind, title, priority, status, created_at, updated_at) VALUES (?,?,?,?,?, 'open', ?, ?)`)
      .bind(uid("loop"), DAY, "other", "Trivial and ancient", 3, Date.now() - 40 * 86_400_000, Date.now()).run();
    await env.DB.prepare(`INSERT INTO open_loops (id, day_id, kind, title, priority, status, created_at, updated_at) VALUES (?,?,?,?,?, 'open', ?, ?)`)
      .bind(uid("loop"), DAY, "other", "Urgent and new", 1, Date.now() - 1 * 86_400_000, Date.now()).run();

    const c = await executionContract(env as any, 1);
    expect(c.action).toContain("Urgent and new");
  });

  it("keeps West Peek's LP list off every day that is not Wednesday", async () => {
    /*
     * THE OWNER CAUGHT THIS ON THE FIRST LIVE RUN: "the LP list is for west peek only not this."
     *
     * The contract used to fall through to "the active project in its lane", which on any day with
     * no open loops reached the raise and put the LP list on a Monday. It is her own rule — §5.4
     * names Wednesday as the West Peek cadence — and a generic fallthrough that grabs the nearest
     * active project quietly promotes one lane's work into every lane's empty slot.
     */
    const monday = await executionContract(env as any, 1);
    expect(monday.action).not.toMatch(/LP list/i);
    expect(monday.action).toMatch(/Nothing is owed/);

    const wednesday = await executionContract(env as any, 3);
    expect(wednesday.action).toMatch(/LP list/i);
  });

  it("does not pad the priority list with West Peek to reach three", async () => {
    // A short list is a real answer. Padding teaches her the third line never means anything.
    const wealth = { available: true, action: "Touch SANDPIPER.", why: "x" };
    const execution = { available: true, action: "Nothing is owed. Take the empty slot or bank it.", why: "y" };
    const monday = proposedPriorities(1, wealth, execution);
    expect(monday.some((p) => /LP list/i.test(p.text))).toBe(false);

    const wednesday = proposedPriorities(3, wealth, execution);
    expect(wednesday.some((p) => /LP list/i.test(p.text))).toBe(true);
  });

  it("makes Wednesday the West Peek meeting, with a consequence rather than a fact", async () => {
    const c = await executionContract(env as any, 3);
    expect(c.action).toMatch(/LP list|raise/i);
    expect(c.why).toContain("§5.4");
  });
});

describe("the gate proposes the day and she overrides it", () => {
  beforeEach(clean);

  it("accepts an empty body and returns all four pillars", async () => {
    /*
     * THE WHOLE CHANGE, IN ONE ASSERTION. This endpoint used to reject a gate with no body, because
     * the body WAS the agenda — three blank fields at 6am. Now sending nothing is the normal case.
     */
    const { status, body } = await apiJson("/api/today/gates/morning", { method: "POST", body: {} });
    expect(status).toBe(201);

    const agenda = JSON.parse(body.data.day.morning_agenda);
    for (const pillar of ["body", "spirit", "wealth", "execution"]) {
      expect(agenda.pillars[pillar], `${pillar} missing`).toBeTruthy();
      expect(agenda.pillars[pillar].available === undefined || agenda.pillars[pillar].available === true,
        `${pillar} came back unavailable`).toBe(true);
    }
    expect(agenda.overridden).toBe(false);
    expect(agenda.proposed.length).toBeGreaterThan(0);
  });

  it("derives the anchor from the first money move rather than asking twice", async () => {
    // Asking for a commitment AND computing a first money move is two answers to one question,
    // which is how a screen starts disagreeing with itself.
    const { body } = await apiJson("/api/today/gates/morning", { method: "POST", body: {} });
    const agenda = JSON.parse(body.data.day.morning_agenda);
    const contract = JSON.parse(body.data.day.morning_contract);
    expect(contract.commitment).toBe(agenda.pillars.wealth.action);
    expect(contract.anchor_source).toContain("derived");
  });

  it("never lists the same priority twice", async () => {
    /*
     * CAUGHT ON THE FIRST REAL RUN AGAINST HER LIVE DAY. With no open loops the Execution contract
     * correctly falls through to the active project in its lane — the raise — and the West Peek line
     * was then appended beneath it. The screen showed "Work today's LP list" twice and looked like a
     * full day. §17 caps the list at three because CHOOSING three is the work; padding it with a
     * repeat is the same failure as exceeding the cap, better dressed.
     */
    const { body } = await apiJson("/api/today/gates/morning", { method: "POST", body: {} });
    const agenda = JSON.parse(body.data.day.morning_agenda);
    const texts = agenda.proposed.map((p: any) => p.text);
    expect(new Set(texts).size, `duplicate priority: ${JSON.stringify(texts)}`).toBe(texts.length);
  });

  it("lets her override, and records that she did", async () => {
    const { body } = await apiJson("/api/today/gates/morning", {
      method: "POST",
      body: { priorities: ["Deal call at 10", "Fix the LP sheet"], commitment: "Close the stalled one" },
    });
    const contract = JSON.parse(body.data.day.morning_contract);
    expect(contract.priorities).toEqual(["Deal call at 10", "Fix the LP sheet"]);
    expect(contract.commitment).toBe("Close the stalled one");
    expect(contract.priorities_source).toBe("owner override");
    expect(contract.anchor_source).toBe("owner");
  });
});

describe("when something comes up", () => {
  beforeEach(clean);

  it("appends the interruption and leaves the morning contract standing", async () => {
    /*
     * The contract is what the Night Gate scores against. A day that rewrites its own contract at
     * 3pm always meets it, and the verdict stops meaning anything.
     */
    const gate = await apiJson("/api/today/gates/morning", { method: "POST", body: {} });
    const before = JSON.parse(gate.body.data.day.morning_contract);

    const { status, body } = await apiJson("/api/today/adjust", {
      method: "POST",
      body: { kind: "emergency", what: "Counterparty called, deal is falling apart" },
    });
    expect(status).toBe(201);
    expect(body.data.priorities[0]).toContain("falling apart");

    const after = JSON.parse(body.data.day.morning_contract);
    expect(after.priorities).toEqual(before.priorities);
  });

  it("says out loud when the interruption displaced the first money move", async () => {
    const gate = await apiJson("/api/today/gates/morning", { method: "POST", body: {} });
    const anchor = JSON.parse(gate.body.data.day.morning_contract).commitment;

    const { body } = await apiJson("/api/today/adjust", {
      method: "POST",
      body: { kind: "reprioritise", what: "All day on the fire", instead_of: anchor },
    });
    expect(body.data.anchor_displaced).toBe(true);
    expect(body.data.note).toContain("§5.3");
  });

  it("keeps every adjustment, so a hijacked week is visible as a pattern", async () => {
    await apiJson("/api/today/gates/morning", { method: "POST", body: {} });
    await apiJson("/api/today/adjust", { method: "POST", body: { kind: "added", what: "One" } });
    const { body } = await apiJson("/api/today/adjust", { method: "POST", body: { kind: "added", what: "Two" } });
    expect(body.data.adjustments).toHaveLength(2);
    expect(body.data.priorities.slice(-2)).toEqual(["One", "Two"]);
  });

  it("refuses an adjustment that does not say what changed", async () => {
    const { status } = await apiJson("/api/today/adjust", { method: "POST", body: { kind: "emergency" } });
    expect(status).toBe(400);
  });

  it("refuses an unknown kind rather than filing it as something else", async () => {
    const { status } = await apiJson("/api/today/adjust", { method: "POST", body: { kind: "whatever", what: "x" } });
    expect(status).toBe(400);
  });
});
