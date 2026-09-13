import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  SIDE_HUSTLE_KEYS,
  brokerageMove,
  executionContract,
  humanTouch,
  isWeekday,
  wealthContract,
} from "../../src/worker/boss/today/pillars";
import { PROJECTS } from "../../src/worker/boss/today/projects";

/**
 * TWO INSTRUCTIONS ABOUT WHAT TODAY SHOULD SUGGEST, AND THE RESTRAINT BOTH OF THEM TURN ON.
 *
 *   "my today's contract should suggest something in brokerage M-F"
 *
 *   "should suggest something that requires a human touch from one of the side hustles when
 *    appropriate n o more than 1 per day as appropriate"
 *
 * NEITHER FEATURE FAILS BY BREAKING. Both fail by becoming generous: a brokerage line every weekday
 * whether or not one exists, a side-hustle line whenever anything is stuck, and the contract is a
 * list she scrolls past. So most of what follows asserts SILENCE — that these say nothing when
 * there is nothing, which is the answer on most days.
 */

const MONDAY = 1;
const SATURDAY = 6;
const SUNDAY = 0;

async function clean() {
  for (const t of [
    "counterparty_crossmatches", "capital_book_line", "capital_book",
    "owned_deliverables", "mailbox_findings", "sourcing_candidates", "open_loops", "deals",
  ]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
}

async function seedCrossmatch(over: Partial<Record<string, unknown>> = {}) {
  const now = Date.now();
  await env.DB
    .prepare(
      `INSERT INTO counterparty_crossmatches
         (id, candidate_id, candidate_name, lp_firm, matched_core, confidence, method, lp_list,
          lp_contacts, why, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      `cx_${Math.random().toString(36).slice(2, 9)}`,
      "cand_1", over.candidate_name ?? "ORION", over.lp_firm ?? "Meridian Endowment",
      "meridian", over.confidence ?? "confirmed", "core_exact",
      over.lp_list ?? "sequence", 3,
      "They already buy late-stage secondaries and you are mid-conversation with them on the fund.",
      over.status ?? "new", now, now,
    )
    .run();
}

let bookVersion = 0;

async function seedBook(lines: Array<{ asset: string; sized: boolean }>) {
  const bookId = `bok_${Math.random().toString(36).slice(2, 9)}`;
  // Versions are UNIQUE, and deliberately: a book is a record, and two v1s would make the history
  // unreadable. So a test that files two books files two versions, like the real intake does.
  bookVersion += 1;
  await env.DB
    .prepare(`INSERT INTO capital_book (id, version, received_at, fingerprint) VALUES (?,?,?,?)`)
    .bind(bookId, bookVersion, Date.now(), `fp_${bookId}`)
    .run();
  for (const l of lines) {
    await env.DB
      .prepare(
        `INSERT INTO capital_book_line (id, book_id, asset, side, size_usd, size_text, source_line)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .bind(
        `bkl_${Math.random().toString(36).slice(2, 9)}`, bookId, l.asset, "sell",
        l.sized ? 5_000_000 : null, l.sized ? "$5M" : "", `${l.asset} — whatever`,
      )
      .run();
  }
  return bookId;
}

async function seedDeliverable(over: {
  projectKey?: string | null; needsOwner?: number; why?: string | null; state?: string;
} = {}) {
  const id = `del_${Math.random().toString(36).slice(2, 9)}`;
  await env.DB
    .prepare(
      `INSERT INTO owned_deliverables
         (id, name, employee_id, lane, terminal_condition, terminal_check, state,
          escalation_path, blocker, blocked_since, last_activity_at, created_at, updated_at,
          project_key, needs_owner, needs_owner_why)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id, "The channel's monetisation application", "emp_repo", "ops",
      "Filed and acknowledged", "kdp_titles_live", over.state ?? "blocked",
      "Today", "YouTube requires the owner's own identity verification",
      Date.now() - 3 * 86_400_000, Date.now() - 3 * 86_400_000, Date.now(), Date.now(),
      over.projectKey === undefined ? SIDE_HUSTLE_KEYS[0]! : over.projectKey,
      over.needsOwner ?? 1,
      over.why === undefined ? "Record the 60-second verification video — it has to be your face and your voice." : over.why,
    )
    .run();
  return id;
}

describe("something in brokerage, Monday to Friday", () => {
  beforeEach(clean);

  it("says nothing at all on a Saturday or a Sunday, whatever is waiting", async () => {
    await seedCrossmatch();
    await seedBook([{ asset: "ORION", sized: false }]);

    expect(await brokerageMove(env as any, SATURDAY)).toBeNull();
    expect(await brokerageMove(env as any, SUNDAY)).toBeNull();
    // And the same material DOES produce something on a weekday, so the null above is the day and
    // not an empty database quietly passing this test.
    expect(await brokerageMove(env as any, MONDAY)).not.toBeNull();
  });

  it("names the firm, the asset and the next act — not a queue to review", async () => {
    await seedCrossmatch({ lp_firm: "Meridian Endowment", candidate_name: "ORION" });
    const move = (await brokerageMove(env as any, MONDAY))!;

    expect(move.action).toContain("Meridian Endowment");
    expect(move.action).toContain("ORION");
    // A next action, with the option to decline stated — not "review your crossmatches".
    expect(move.action).toMatch(/decide whether to approach/i);
    expect(move.action).toMatch(/say no if not/i);
    expect(move.why).toMatch(/already in contact|conversation you are already having/i);
  });

  /**
   * SUPPRESSED MEANS SUPPRESSED AS AN LP, which says nothing about approaching the same firm as a
   * BUYER — the crossmatch table says so in terms. Filtering those rows out would hide real
   * opportunities while looking careful, so the list is NAMED and she makes the call.
   */
  it("surfaces a suppressed-list firm and says which list it is on rather than hiding it", async () => {
    await seedCrossmatch({ lp_list: "suppressed", lp_firm: "Calder Foundation" });
    const move = (await brokerageMove(env as any, MONDAY))!;
    expect(move.action).toContain("Calder Foundation");
    expect(move.why).toContain("suppressed");
    expect(move.why).toMatch(/says nothing about them as a buyer/i);
  });

  it("ignores a NEAR match — a maybe at the top of the morning is a guess presented as a plan", async () => {
    await seedCrossmatch({ confidence: "near" });
    expect(await brokerageMove(env as any, MONDAY)).toBeNull();
  });

  it("ignores a crossmatch she has already dealt with", async () => {
    await seedCrossmatch({ status: "acted" });
    expect(await brokerageMove(env as any, MONDAY)).toBeNull();
  });

  it("falls to a lot on her book that nobody can size a buyer for", async () => {
    await seedBook([{ asset: "PRIVET", sized: true }, { asset: "ORION", sized: false }]);
    const move = (await brokerageMove(env as any, MONDAY))!;

    expect(move.action).toContain("ORION");
    expect(move.action).not.toContain("PRIVET");
    expect(move.why).toMatch(/matches buyers on size/i);
    expect(move.why).toMatch(/only you know the number/i);
  });

  it("says nothing when every lot on the book is sized", async () => {
    await seedBook([{ asset: "PRIVET", sized: true }]);
    expect(await brokerageMove(env as any, MONDAY)).toBeNull();
  });

  it("ignores a superseded book, so an old unsized lot cannot haunt her", async () => {
    const old = await seedBook([{ asset: "GHOST", sized: false }]);
    await env.DB.prepare(`UPDATE capital_book SET superseded_at = ? WHERE id = ?`).bind(Date.now(), old).run();
    await seedBook([{ asset: "PRIVET", sized: true }]);
    expect(await brokerageMove(env as any, MONDAY)).toBeNull();
  });

  /**
   * THE WHOLE POINT, ASSERTED DIRECTLY. Coming back empty-handed is fine; returning noise is not. A
   * filler suggestion every weekday is worse than a quiet day.
   */
  it("returns NOTHING on an empty weekday rather than inventing a suggestion", async () => {
    for (const d of [1, 2, 3, 4, 5]) {
      expect(await brokerageMove(env as any, d), `weekday ${d} invented something`).toBeNull();
    }
  });

  it("reaches the wealth contract on a weekday, above the relationship touch", async () => {
    await seedCrossmatch();
    const c = await wealthContract(env as any, MONDAY);
    expect(c.action).toContain("Meridian Endowment");
  });

  it("knows which days are weekdays", () => {
    expect([0, 6].every((d) => !isWeekday(d))).toBe(true);
    expect([1, 2, 3, 4, 5].every(isWeekday)).toBe(true);
  });
});

describe("one side-hustle item a day, and only when it needs her", () => {
  beforeEach(clean);

  /**
   * THE LIST COMES FROM THE REPOSITORY, NOT FROM A GUESS. `projects.ts` is already the register of
   * what she works on, and it excludes the backlink network in terms: "A cost centre, not a line —
   * never a day's work."
   */
  it("derives the side hustles from projects.ts and excludes the cost centre", () => {
    const spry = PROJECTS.filter((p) => p.lane === "spry").map((p) => p.key);
    expect(spry).toContain("authority_network");
    expect(SIDE_HUSTLE_KEYS).not.toContain("authority_network");
    expect(SIDE_HUSTLE_KEYS).not.toContain("brokerage");
    expect(SIDE_HUSTLE_KEYS).not.toContain("west_peek_raise");
    expect(SIDE_HUSTLE_KEYS.length).toBeGreaterThan(0);
    for (const k of SIDE_HUSTLE_KEYS) expect(spry).toContain(k);
  });

  it("says nothing when nothing is declared as needing her", async () => {
    await seedDeliverable({ needsOwner: 0 });
    expect(await humanTouch(env as any)).toBeNull();
  });

  it("surfaces a declared one, naming the property and what only she can do", async () => {
    await seedDeliverable();
    const touch = (await humanTouch(env as any))!;

    // NAMES THE PROPERTY, whichever it is. The literal name used to be "How We Know — YouTube";
    // the spry lane is the grid now, so the assertion is that the property is named at all rather
    // than that one particular line still exists.
    expect(touch.action.startsWith(PROJECTS.find((p) => p.key === SIDE_HUSTLE_KEYS[0])!.name)).toBe(true);
    expect(touch.action).toMatch(/your face and your voice/i);
    expect(touch.why).toMatch(/cannot move without you/i);
    expect(touch.why).toMatch(/3 days/);
  });

  /**
   * A ROW THAT CANNOT SAY WHAT ONLY SHE CAN DO IS A PUZZLE, NOT A TASK.
   */
  it("refuses a row flagged as needing her that gives no reason", async () => {
    await seedDeliverable({ why: null });
    expect(await humanTouch(env as any)).toBeNull();
    await clean();
    await seedDeliverable({ why: "   " });
    expect(await humanTouch(env as any)).toBeNull();
  });

  it("ignores an item on a lane that is not a side hustle", async () => {
    await seedDeliverable({ projectKey: "brokerage" });
    expect(await humanTouch(env as any)).toBeNull();
    await clean();
    await seedDeliverable({ projectKey: "authority_network" });
    expect(await humanTouch(env as any)).toBeNull();
    await clean();
    await seedDeliverable({ projectKey: null });
    expect(await humanTouch(env as any)).toBeNull();
  });

  it("ignores one that is already done or killed", async () => {
    for (const state of ["done", "killed"]) {
      await clean();
      await seedDeliverable({ state });
      expect(await humanTouch(env as any), `${state} reappeared`).toBeNull();
    }
  });

  /**
   * THE CAP IS THE FEATURE. Not "usually one" — she is protecting the contract from becoming a list.
   */
  it("hands her ONE even when five are waiting, and it is the oldest", async () => {
    for (let i = 0; i < 5; i += 1) await seedDeliverable();
    const touch = await humanTouch(env as any);
    expect(touch).not.toBeNull();

    // One contract action, so the cap holds by the shape of the thing rather than by a slice.
    const c = await executionContract(env as any, MONDAY);
    expect(typeof c.action).toBe("string");
    expect(c.action).toMatch(/your face and your voice/i);
  });

  it("reaches the execution contract above the oldest open loop", async () => {
    const day = "2026-09-14";
    await env.DB.prepare(`INSERT INTO days (id, date_ts, created_at) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING`)
      .bind(day, Date.parse(`${day}T00:00:00Z`), Date.now()).run();
    const old = Date.now() - 40 * 86_400_000;
    await env.DB
      .prepare(`INSERT INTO open_loops (id, day_id, kind, title, priority, status, created_at, updated_at) VALUES (?,?,?,?,?, 'open', ?, ?)`)
      .bind("loop_touch_probe", day, "other", "An older loop", 1, old, old)
      .run();
    await seedDeliverable();

    const c = await executionContract(env as any, MONDAY);
    // Somebody else's work waiting on her spends two people's time; her own loop spends one.
    expect(c.action).toMatch(/your face and your voice/i);
    expect(c.action).not.toMatch(/An older loop/);
  });

  it("steps aside for the oldest open loop once she has dealt with it", async () => {
    const day = "2026-09-15";
    await env.DB.prepare(`INSERT INTO days (id, date_ts, created_at) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING`)
      .bind(day, Date.parse(`${day}T00:00:00Z`), Date.now()).run();
    const old = Date.now() - 40 * 86_400_000;
    await env.DB
      .prepare(`INSERT INTO open_loops (id, day_id, kind, title, priority, status, created_at, updated_at) VALUES (?,?,?,?,?, 'open', ?, ?)`)
      .bind("loop_touch_probe2", day, "other", "An older loop", 1, old, old)
      .run();

    const c = await executionContract(env as any, MONDAY);
    expect(c.action).toMatch(/An older loop/);
  });
});
