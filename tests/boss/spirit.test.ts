import { env } from "cloudflare:test";
import { describe, expect, it, beforeEach } from "vitest";
import { all, api, apiJson, insertApproval, insertTask, row } from "./helpers";
import {
  moonPhase, moonPosition, buildAlmanac, ZODIAC, NO_EPHEMERIS, AWAITING_ALMANAC, AWAITING_OWNER, CANON_WINDOW_TYPES,
} from "../../src/worker/boss/spirit/astro";

/**
 * Phase 16 — Spirit OS, astrology, contribution, ancestors.
 *
 * Acceptance is three claims: the daily and monthly views render entirely from
 * computed and seeded data with no network call; the §1.5 anti-delusion rules
 * hold; and the §5.2 reality-priority warning is visible.
 *
 * The astronomy is checked against known events rather than against itself. A
 * self-consistent wrong answer is the failure mode of computed ephemerides.
 */

const DAY = 86_400_000;

let seq = 0;
const nextName = (label: string) => `${label} ${(seq++).toString().padStart(3, "0")}`;

/** Known lunar events, from published tables, used as fixtures. */
const KNOWN_NEW_MOONS = [
  Date.parse("2024-01-11T11:57:00Z"),
  Date.parse("2024-06-06T12:38:00Z"),
  Date.parse("2025-03-29T10:58:00Z"),
];
const KNOWN_FULL_MOONS = [
  Date.parse("2024-01-25T17:54:00Z"),
  Date.parse("2024-09-18T02:34:00Z"),
  Date.parse("2025-04-13T00:22:00Z"),
];

describe("Phase 16 — the sky is computed, not fetched", () => {
  it("puts the new moon where the almanacs put it", () => {
    for (const ts of KNOWN_NEW_MOONS) {
      const phase = moonPhase(ts);
      expect(phase.phase).toBe("New Moon");
      // Illumination at a new moon is essentially nothing.
      expect(phase.illumination).toBeLessThan(0.02);
    }
  });

  it("puts the full moon where the almanacs put it", () => {
    for (const ts of KNOWN_FULL_MOONS) {
      const phase = moonPhase(ts);
      expect(phase.phase).toBe("Full Moon");
      expect(phase.illumination).toBeGreaterThan(0.98);
    }
  });

  it("computes the phase times to within a few minutes of the published ones", () => {
    const events = buildAlmanac(Date.parse("2024-01-01T00:00:00Z"), 12);
    for (const known of KNOWN_NEW_MOONS.slice(0, 2)) {
      const nearest = events
        .filter((e) => e.kind === "new_moon")
        .map((e) => Math.abs(e.starts_at - known))
        .sort((a, b) => a - b)[0];
      // An empty almanac would make the comparison below vacuously pass, so the presence of a
      // computed event is asserted rather than assumed.
      expect(nearest).toBeDefined();
      expect(nearest! / 60_000).toBeLessThan(10);
    }
    for (const known of KNOWN_FULL_MOONS.slice(0, 1)) {
      const nearest = events
        .filter((e) => e.kind === "full_moon")
        .map((e) => Math.abs(e.starts_at - known))
        .sort((a, b) => a - b)[0];
      // An empty almanac would make the comparison below vacuously pass, so the presence of a
      // computed event is asserted rather than assumed.
      expect(nearest).toBeDefined();
      expect(nearest! / 60_000).toBeLessThan(10);
    }
  });

  it("moves the moon through every sign in a month, and names the cusp instead of guessing", () => {
    const start = Date.parse("2025-01-01T00:00:00Z");
    const seen = new Set<string>();
    let cusps = 0;
    for (let i = 0; i < 30 * 24; i++) {
      const position = moonPosition(start + i * 3_600_000);
      expect(ZODIAC).toContain(position.sign);
      expect(position.degrees_in_sign).toBeGreaterThanOrEqual(0);
      expect(position.degrees_in_sign).toBeLessThan(30);
      seen.add(position.sign);
      if (position.cusp) {
        cusps++;
        expect(position.next_sign).toBeTruthy();
        expect(position.next_sign).not.toBe(position.sign);
      }
    }
    // The Moon covers the whole zodiac in a sidereal month.
    expect(seen.size).toBe(12);
    expect(cusps).toBeGreaterThan(0);
  });

  it("builds twenty-four months of almanac without a network call", async () => {
    const { status, body } = await apiJson("/api/spirit/astro/almanac");
    expect(status).toBe(200);
    expect(body.data.events.length).toBeGreaterThan(80);

    const kinds = new Set(body.data.events.map((e: any) => e.kind));
    expect(kinds).toContain("new_moon");
    expect(kinds).toContain("full_moon");
    expect(kinds).toContain("window");
    for (const event of body.data.events) {
      expect(event.source).toBe("computed");
      expect(event.method).toMatch(/No network call/);
    }

    // Rebuilding is idempotent: the same arithmetic, the same rows.
    const before = (await all(`SELECT id FROM astro_calendar`)).length;
    await api("/api/spirit/astro/almanac/rebuild", { method: "POST", body: {} });
    expect((await all(`SELECT id FROM astro_calendar`)).length).toBe(before);
  });

  it("carries canon §42.2's five window types across every lunation", async () => {
    const { body } = await apiJson("/api/spirit/astro/almanac");
    const windows = body.data.events.filter((e: any) => e.kind === "window");
    const types = new Set(windows.map((w: any) => w.detail?.window_type));

    for (const window of CANON_WINDOW_TYPES) expect(types).toContain(window.key);

    // The name is canon's; the boundary is this build's, and the row says so
    // rather than letting a derived edge pass as authority.
    const canonWindows = windows.filter((w: any) => types.has(w.detail?.window_type) && w.detail?.canon === "§42.2");
    expect(canonWindows.length).toBeGreaterThan(24 * 5 * 0.8);
    for (const w of canonWindows) {
      expect(w.detail.derived_from).toBe("computed lunation");
      expect(w.detail.note).toMatch(/derived in this build/);
      expect(w.ends_at).toBeGreaterThan(w.starts_at);
    }

    // Five windows partition one lunation: they tile it, and they do not overlap.
    const first = canonWindows
      .filter((w: any) => w.detail.lunation === canonWindows[0].detail.lunation)
      .sort((a: any, b: any) => a.starts_at - b.starts_at);
    expect(first.length).toBe(5);
    for (let i = 1; i < first.length; i++) expect(first[i].starts_at).toBe(first[i - 1].ends_at);
  });

  it("NOTHING IS DEFERRED FOR WANT OF AN EPHEMERIS — the natal layer waits on the owner", async () => {
    // The almanac has to exist before it can be checked for planetary rows.
    await api("/api/spirit/astro/almanac");
    const { body } = await apiJson("/api/spirit/astro/natal");
    expect(body.data.available).toBe(false);

    /*
     * THE REGRESSION THIS PINS. Three items used to say "DEFERRED — NO EPHEMERIS SOURCE" and two of
     * them were wrong about themselves: ingresses, retrogrades and shadow windows are all the same
     * arithmetic as the lunar series beside them, and none needed a source. "No ephemeris" reads as
     * something nobody can fix, so it was never going to be questioned.
     */
    expect(body.data.deferred).toEqual([]);
    expect(body.data.status).toBe(AWAITING_OWNER);

    // What remains is a question, and it names exactly what it needs.
    const inputs = body.data.owner_inputs.map((i: any) => i.key);
    expect(inputs).toEqual(["natal_chart", "natal_transits"]);
    for (const item of body.data.owner_inputs) {
      expect(item.needs).toBeTruthy();
      expect(item.why).toBeTruthy();
    }
    expect(body.data.what_would_change_it.toLowerCase()).toContain("time");

    // And the planetary rows are real, computed, and not fabricated to fill the gap.
    const rows = await all<{ source: string }>(
      `SELECT source FROM astro_calendar WHERE kind IN ('retrograde','shadow','ingress')`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.source === "computed")).toBe(true);
  });

  it("says an unentered horizon is unentered rather than reporting it covered", async () => {
    const { body } = await apiJson("/api/spirit/astro/almanac/coverage");
    expect(body.data.horizon_months).toBe(24);
    expect(body.data.complete).toBe(false);
    expect(body.data.note).toMatch(/not fully covered/);
    for (const kind of body.data.manual) {
      expect(kind.rows).toBe(0);
      expect(kind.covers_horizon).toBe(false);
      expect(kind.months_covered).toBe(0);
      expect(kind.status).toBe(AWAITING_ALMANAC);
      expect(kind.how).toMatch(/import/);
    }
  });
});

describe("Phase 16 — the hand-entered half of the almanac", () => {
  const RETROGRADE_START = Date.parse("2027-02-09T00:00:00Z");
  const RETROGRADE_END = Date.parse("2027-03-03T00:00:00Z");

  const paste = (overrides: Record<string, unknown> = {}) => ({
    source_name: "Public almanac, 2027 edition",
    events: [
      {
        kind: "retrograde",
        label: "Mercury retrograde in Pisces",
        starts_at: RETROGRADE_START,
        ends_at: RETROGRADE_END,
      },
      {
        kind: "shadow",
        label: "Pre-shadow, Mercury retrograde in Pisces",
        starts_at: RETROGRADE_START - 20 * DAY,
        ends_at: RETROGRADE_START,
        retrograde_label: "Mercury retrograde in Pisces",
        phase: "pre",
      },
    ],
    ...overrides,
  });

  it("takes a pasted calendar, records where it came from, and shows it in the month", async () => {
    const { status, body } = await apiJson("/api/spirit/astro/almanac/import", { method: "POST", body: paste() });
    expect(status).toBe(200);
    expect(body.data.imported).toBe(2);
    expect(body.data.replaced).toBe(0);

    const stored = await all(`SELECT * FROM astro_calendar WHERE kind IN ('retrograde','shadow') AND source = 'imported' ORDER BY starts_at`);
    expect(stored.length).toBe(2);
    for (const r of stored as any[]) {
      // An entered row is never confusable with a computed one.
      expect(r.source).toBe("imported");
      expect(r.method).toMatch(/Public almanac, 2027 edition/);
      expect(JSON.parse(r.detail).entered_from).toBe("Public almanac, 2027 edition");
    }

    const { body: month } = await apiJson("/api/spirit/month?month=2027-02");
    const labels = month.data.almanac.map((e: any) => e.label);
    expect(labels).toContain("Mercury retrograde in Pisces");
    expect(month.data.almanac.some((e: any) => e.source === "imported")).toBe(true);

    // Coverage counts BOTH sources now and keeps them apart. What this test is about is the one
    // row a person typed, which must stay separately countable from the computed ones beside it.
    const retrogrades = month.data.coverage.manual.find((m: any) => m.key === "retrogrades");
    expect(retrogrades.imported_rows).toBe(1);
    expect(retrogrades.computed_rows).toBeGreaterThan(0);
    expect(retrogrades.status).toContain("1 entered by hand");
  });

  it("refreshes the same way it was entered, without leaving the old copy behind", async () => {
    await api("/api/spirit/astro/almanac"); // the computed half, so the refresh has something to spare
    await api("/api/spirit/astro/almanac/import", { method: "POST", body: paste() });

    const corrected = paste({
      source_name: "Public almanac, 2027 edition (corrected)",
      events: [
        {
          kind: "retrograde",
          label: "Mercury retrograde in Pisces — corrected",
          starts_at: RETROGRADE_START,
          ends_at: RETROGRADE_END + DAY,
        },
      ],
      replace: true,
    });
    const { body } = await apiJson("/api/spirit/astro/almanac/import", { method: "POST", body: corrected });
    expect(body.data.replaced).toBeGreaterThan(0);

    const rows = (await all(`SELECT * FROM astro_calendar WHERE kind = 'retrograde' AND source = 'imported'`)) as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].label).toBe("Mercury retrograde in Pisces — corrected");
    expect(rows[0].ends_at).toBe(RETROGRADE_END + DAY);

    // A refresh takes only what it was scoped to. The computed lunar rows stay.
    const computed = await all(`SELECT id FROM astro_calendar WHERE source = 'computed'`);
    expect(computed.length).toBeGreaterThan(80);
  });

  it("re-entering the same paste stores it once", async () => {
    await api("/api/spirit/astro/almanac/import", { method: "POST", body: paste() });
    await api("/api/spirit/astro/almanac/import", { method: "POST", body: paste() });
    expect((await all(`SELECT id FROM astro_calendar WHERE kind IN ('retrograde','shadow')`)).length).toBe(2);
  });

  it("refuses the mistakes a person actually makes while copying a calendar", async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["no source", paste({ source_name: "" })],
      ["nothing pasted", paste({ events: [] })],
      ["a kind that is computed here", paste({ events: [{ kind: "full_moon", label: "x", starts_at: 1, ends_at: 2 }] })],
      ["a period that ends before it starts", paste({ events: [{ kind: "retrograde", label: "x", starts_at: RETROGRADE_END, ends_at: RETROGRADE_START }] })],
      ["a mistyped year", paste({ events: [{ kind: "retrograde", label: "x", starts_at: RETROGRADE_START, ends_at: RETROGRADE_START + 400 * DAY }] })],
      ["an unnamed period", paste({ events: [{ kind: "retrograde", label: "  ", starts_at: RETROGRADE_START, ends_at: RETROGRADE_END }] })],
      ["a shadow with no retrograde", paste({ events: [{ kind: "shadow", label: "x", starts_at: RETROGRADE_START, ends_at: RETROGRADE_END, phase: "pre" }] })],
      ["a shadow on neither side", paste({ events: [{ kind: "shadow", label: "x", starts_at: RETROGRADE_START, ends_at: RETROGRADE_END, retrograde_label: "y", phase: "during" }] })],
      ["the same row twice", paste({ events: [
        { kind: "retrograde", label: "x", starts_at: RETROGRADE_START, ends_at: RETROGRADE_END },
        { kind: "retrograde", label: "y", starts_at: RETROGRADE_START, ends_at: RETROGRADE_END },
      ] })],
    ];

    for (const [what, body] of cases) {
      const res = await apiJson("/api/spirit/astro/almanac/import", { method: "POST", body });
      expect(res.status, what).toBe(400);
      expect(res.body.error, what).toBeTruthy();
    }

    // Nothing from a refused paste reached the table.
    expect(await all(`SELECT id FROM astro_calendar WHERE kind IN ('retrograde','shadow')`)).toEqual([]);
  });

  it("reports the horizon covered once the horizon is actually entered", async () => {
    const now = Date.now();
    const events = [];
    // A retrograde roughly every four months, out past the twenty-four-month line.
    for (let i = 1; i <= 8; i++) {
      const start = now + i * 92 * DAY;
      events.push({
        kind: "retrograde",
        label: `Mercury retrograde ${i}`,
        starts_at: start,
        ends_at: start + 21 * DAY,
      });
      events.push({
        kind: "shadow",
        label: `Pre-shadow ${i}`,
        starts_at: start - 18 * DAY,
        ends_at: start,
        retrograde_label: `Mercury retrograde ${i}`,
        phase: "pre",
      });
    }
    await api("/api/spirit/astro/almanac/import", { method: "POST", body: { source_name: "Public almanac", events } });

    const { body } = await apiJson("/api/spirit/astro/almanac/coverage");
    expect(body.data.complete).toBe(true);
    expect(body.data.note).toMatch(/cover the horizon/);
    for (const kind of body.data.manual) {
      expect(kind.covers_horizon).toBe(true);
      expect(kind.months_covered).toBeGreaterThanOrEqual(24);
      expect(kind.entered_from[0]).toMatch(/Public almanac/);
    }
  });
});

describe("Phase 16 — the daily and monthly views", () => {
  it("renders the day from computed sky and real records", async () => {
    const { status, body } = await apiJson("/api/spirit/day?date=2026-03-14");
    expect(status).toBe(200);
    expect(body.data.advisory).toBe(true);
    expect(body.data.note).toMatch(/never a cause/);
    expect(body.data.astro.day).toBe("2026-03-14");
    expect(body.data.astro.method).toMatch(/No network call/);
    expect(ZODIAC).toContain(body.data.astro.moon_sign);

    // Materialised, so a past day stays inspectable rather than being re-derived.
    const stored = await row(`SELECT * FROM astro_days WHERE id = ?`, "2026-03-14");
    expect(stored!.phase).toBe(body.data.astro.phase);
    expect(stored!.illumination_bps).toBe(body.data.astro.illumination_bps);
  });

  it("renders the month from the same computed data", async () => {
    const { body } = await apiJson("/api/spirit/month?month=2026-04");
    expect(body.data.month).toBe("2026-04");
    expect(body.data.almanac.length).toBeGreaterThanOrEqual(2);
    expect(body.data.almanac.every((e: any) => e.source === "computed")).toBe(true);
    expect(body.data.contribution.minimum).toBe(1);
    expect(body.data.contribution.ideal).toBe(4);
    // Was `deferred.length > 0`. Nothing is deferred any more, and the month says what it holds.
    expect(body.data.deferred).toEqual([]);
    expect(body.data.almanac.some((e: any) => ["retrograde", "shadow", "ingress"].includes(e.kind))).toBe(true);
  });

  it("refuses a day that is not a day", async () => {
    expect((await apiJson("/api/spirit/day?date=not-a-day")).status).toBe(400);
    expect((await apiJson("/api/spirit/month?month=2026")).status).toBe(400);
  });
});

describe("Phase 16 — canon §1.5, the anti-delusion rules", () => {
  async function newManifestation(over: Record<string, unknown> = {}) {
    const { status, body } = await apiJson("/api/spirit/manifestations", {
      method: "POST",
      body: {
        title: nextName("Manifestation"),
        statement: "The fund closes at its target.",
        first_action: "Send the deck to the three LPs who asked.",
        ...over,
      },
    });
    expect(status).toBe(201);
    return body.data as any;
  }

  it("will not hold a wish: the first concrete action is required", async () => {
    const { status, body } = await apiJson("/api/spirit/manifestations", {
      method: "POST",
      body: { title: "It works out", statement: "Everything works out" },
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/first concrete action/i);
  });

  it("records signs and never counts them", async () => {
    const manifestation = await newManifestation();
    for (const description of ["Saw the number three times", "Dreamt of the building", "Song on the radio"]) {
      const { status, body } = await apiJson(`/api/spirit/manifestations/${manifestation.id}/evidence`, {
        method: "POST", body: { kind: "sign", description },
      });
      expect(status).toBe(201);
      expect(body.data.counts_toward_completion).toBe(false);
      expect(body.data.note).toMatch(/never count|does not count/i);
    }

    const detail = await apiJson(`/api/spirit/manifestations/${manifestation.id}`);
    expect(detail.body.data.progress.signs).toBe(3);
    expect(detail.body.data.progress.signs_counted).toBe(0);
    expect(detail.body.data.progress.can_close).toBe(false);

    const refused = await apiJson(`/api/spirit/manifestations/${manifestation.id}/manifested`, { method: "POST", body: {} });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/not manifested yet/);
    expect(refused.body.hint).toMatch(/none of them count/);
  });

  it("closes only on what was done and what happened", async () => {
    const manifestation = await newManifestation();
    for (const description of ["Sent the deck", "Ran the meeting", "Answered the diligence list"]) {
      await api(`/api/spirit/manifestations/${manifestation.id}/evidence`, {
        method: "POST", body: { kind: "action", description },
      });
    }

    const stillShort = await apiJson(`/api/spirit/manifestations/${manifestation.id}/manifested`, { method: "POST", body: {} });
    expect(stillShort.status).toBe(409);
    expect(stillShort.body.error).toMatch(/verifiable result/);

    // A result nobody can check is refused as a result.
    const unverifiable = await apiJson(`/api/spirit/manifestations/${manifestation.id}/evidence`, {
      method: "POST", body: { kind: "result", description: "It feels like it landed" },
    });
    expect(unverifiable.status).toBe(400);
    expect(unverifiable.body.hint).toMatch(/Where can it be checked/);

    const verified = await apiJson(`/api/spirit/manifestations/${manifestation.id}/evidence`, {
      method: "POST",
      body: { kind: "result", description: "Signed subscription document", reference: "Docs folder, 2026-05-02" },
    });
    expect(verified.status).toBe(201);
    expect(verified.body.data.counts_toward_completion).toBe(true);

    const closed = await apiJson(`/api/spirit/manifestations/${manifestation.id}/manifested`, { method: "POST", body: {} });
    expect(closed.status).toBe(200);
    expect(closed.body.data.manifestation.status).toBe("manifested");
    expect(closed.body.data.closed_on).toMatchObject({ actions: 3, verifiable_results: 1, signs_counted: 0 });

    const again = await apiJson(`/api/spirit/manifestations/${manifestation.id}/manifested`, { method: "POST", body: {} });
    expect(again.status).toBe(409);
  });

  it("releases without pretending, and wants a reason", async () => {
    const manifestation = await newManifestation();
    const noReason = await apiJson(`/api/spirit/manifestations/${manifestation.id}/release`, { method: "POST", body: {} });
    expect(noReason.status).toBe(400);

    const { body } = await apiJson(`/api/spirit/manifestations/${manifestation.id}/release`, {
      method: "POST", body: { reason: "I stopped wanting it, which is information." },
    });
    expect(body.data.status).toBe("released");
    expect(body.data.closed_reason).toMatch(/stopped wanting/);
  });

  it("states the rule wherever manifestations are listed", async () => {
    const { body } = await apiJson("/api/spirit/manifestations");
    expect(body.data.rule.signs_count_toward_completion).toBe(false);
    expect(body.data.rule.actions_required).toBe(3);
    expect(body.data.rule.note).toMatch(/§1\.5/);
  });
});

describe("Phase 16 — canon §5.2, reality has priority", () => {
  it("shows the warning when something operational is actually wrong", async () => {
    const clean = await apiJson("/api/spirit/day");
    expect(clean.body.data.reality_priority.warning).toBe(false);
    expect(clean.body.data.reality_priority.rule).toMatch(/reality has priority/i);

    await insertTask({ status: "failed" });
    await insertApproval({ expires_at: Date.now() + 3_600_000 });

    const { body } = await apiJson("/api/spirit/day");
    expect(body.data.reality_priority.warning).toBe(true);
    expect(body.data.reality_priority.text).toMatch(/Reality first/);
    expect(body.data.reality_priority.counts.failed_tasks).toBeGreaterThanOrEqual(1);
    expect(body.data.reality_priority.counts.approvals_expiring).toBeGreaterThanOrEqual(1);
  });

  it("carries the same warning onto Today's Spirit Signal", async () => {
    await insertTask({ status: "failed" });

    const { body } = await apiJson("/api/today");
    const block = body.data.blocks.find((b: any) => b.key === "spirit_signal");
    expect(block.content.advisory).toBe(true);
    expect(block.content.reality_priority.warning).toBe(true);
    expect(block.content.moon.phase).toBeTruthy();
    expect(block.content.note).toMatch(/never a cause/);
    expect(block.is_empty).toBe(false);
  });
});

describe("Phase 16 — contribution and ancestors, in canon's tone", () => {
  it("asks for one a month, calls four a good month, and never nags", async () => {
    const empty = await apiJson("/api/spirit/day");
    expect(empty.body.data.contribution.count).toBe(0);
    expect(empty.body.data.contribution.met).toBe(false);
    expect(empty.body.data.contribution.tone).toMatch(/Nothing is owed/);
    expect(empty.body.data.contribution.tone).not.toMatch(/should|must|behind|failed|streak/i);

    const { status, body } = await apiJson("/api/spirit/contributions", {
      method: "POST",
      body: { kind: "money", recipient: "The food bank", amount_micros: 250_000_000, note: "Monthly" },
    });
    expect(status).toBe(201);
    expect(body.data.month_count).toBe(1);
    expect(body.data.tone).toMatch(/requirement met/);

    const after = await apiJson("/api/spirit/day");
    expect(after.body.data.contribution.met).toBe(true);
    expect(after.body.data.contribution.minimum).toBe(1);
    expect(after.body.data.contribution.ideal).toBe(4);

    for (let i = 0; i < 3; i++) {
      await api("/api/spirit/contributions", { method: "POST", body: { kind: "help", recipient: `Someone ${i}` } });
    }
    const good = await apiJson("/api/spirit/day");
    expect(good.body.data.contribution.count).toBe(4);
    expect(good.body.data.contribution.tone).toMatch(/good month/);

    const summary = await apiJson("/api/spirit/contributions");
    expect(summary.body.data.note).toMatch(/no daily practice, no streak/);
    expect(summary.body.data.by_month[0].n).toBe(4);
  });

  it("keeps the ancestor hour gentle and unscored", async () => {
    const before = await apiJson("/api/spirit/day");
    expect(before.body.data.ancestors.minutes).toBe(0);
    expect(before.body.data.ancestors.target_minutes).toBe(60);
    expect(before.body.data.ancestors.tone).toMatch(/nothing is late/i);

    await api("/api/spirit/ancestors", {
      method: "POST",
      body: { who: "Grandmother Ruth", relation: "maternal grandmother", kind: "story", minutes: 45, note: "Wrote down the crossing." },
    });
    const after = await apiJson("/api/spirit/day");
    expect(after.body.data.ancestors.minutes).toBe(45);
    expect(after.body.data.ancestors.met).toBe(false);
    expect(after.body.data.ancestors.tone).toMatch(/whenever it happens/);

    const listing = await apiJson("/api/spirit/ancestors");
    expect(listing.body.data.note).toMatch(/not an obligation/);
    expect(listing.body.data.entries[0].who).toBe("Grandmother Ruth");
  });
});

describe("Phase 16 — rituals and dreams", () => {
  it("tracks a practice and what is due today", async () => {
    const { status, body } = await apiJson("/api/spirit/rituals", {
      method: "POST",
      body: { name: nextName("Morning sit"), cadence: "daily", steps: ["Sit", "Breathe", "Write one line"], minutes: 15 },
    });
    expect(status).toBe(201);

    const due = await apiJson("/api/spirit/day");
    expect(due.body.data.rituals_due.some((r: any) => r.id === body.data.id)).toBe(true);
    expect(due.body.data.rituals_due[0].why).toMatch(/Never run/);

    await api(`/api/spirit/rituals/${body.data.id}/done`, { method: "POST", body: { minutes: 12, note: "Short one." } });
    const after = await apiJson("/api/spirit/day");
    expect(after.body.data.rituals_due.some((r: any) => r.id === body.data.id)).toBe(false);
    expect(await all(`SELECT * FROM ritual_runs WHERE ritual_id = ?`, body.data.id)).toHaveLength(1);
  });

  it("insists a lunar ritual has a moon to be anchored to", async () => {
    const { status, body } = await apiJson("/api/spirit/rituals", {
      method: "POST", body: { name: "Unanchored", cadence: "lunar", steps: ["Something"] },
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/anchored to the new or full moon/);
  });

  it("refuses a ritual with no steps", async () => {
    const { status, body } = await apiJson("/api/spirit/rituals", {
      method: "POST", body: { name: "Vague intention", cadence: "weekly", steps: [] },
    });
    expect(status).toBe(400);
    expect(body.hint).toMatch(/is an intention/);
  });

  it("keeps dreams as dreams", async () => {
    const { status, body } = await apiJson("/api/spirit/dreams", {
      method: "POST",
      body: { title: "The stairwell", body: "Climbing without arriving.", symbols: ["stairs", "height"], mood: "unsettled" },
    });
    expect(status).toBe(201);
    expect(body.data.title).toBe("The stairwell");

    const listing = await apiJson("/api/spirit/dreams");
    expect(listing.body.data[0].symbols).toEqual(["stairs", "height"]);
  });
});

/**
 * The acceptance sentence, walked end to end.
 */
describe("Phase 16 — acceptance", () => {
  it("day and month render from computed data, delusion is refused, and reality comes first", async () => {
    // No network, no ephemeris file: everything below is arithmetic and rows.
    const day = await apiJson("/api/spirit/day?date=2026-06-15");
    expect(day.status).toBe(200);
    expect(day.body.data.astro.phase).toBeTruthy();
    expect(day.body.data.astro.method).toMatch(/No network call/);

    const month = await apiJson("/api/spirit/month?month=2026-06");
    expect(month.body.data.almanac.length).toBeGreaterThanOrEqual(2);
    expect(month.body.data.almanac.every((e: any) => e.source === "computed")).toBe(true);

    // A manifestation carried by signs alone does not close.
    const { body: manifestation } = await apiJson("/api/spirit/manifestations", {
      method: "POST",
      body: { title: "The book gets written", statement: "The manuscript is finished.", first_action: "Write 500 words today." },
    });
    await api(`/api/spirit/manifestations/${manifestation.data.id}/evidence`, {
      method: "POST", body: { kind: "sign", description: "Kept seeing the title everywhere" },
    });
    const refused = await apiJson(`/api/spirit/manifestations/${manifestation.data.id}/manifested`, { method: "POST", body: {} });
    expect(refused.status).toBe(409);

    // Three things done and one checkable thing that happened do close it.
    for (const description of ["Wrote 500 words", "Wrote 2000 more", "Sent it to the editor"]) {
      await api(`/api/spirit/manifestations/${manifestation.data.id}/evidence`, {
        method: "POST", body: { kind: "action", description },
      });
    }
    await api(`/api/spirit/manifestations/${manifestation.data.id}/evidence`, {
      method: "POST",
      body: { kind: "result", description: "Editor's acceptance email", reference: "Inbox, 2026-06-14" },
    });
    const closed = await apiJson(`/api/spirit/manifestations/${manifestation.data.id}/manifested`, { method: "POST", body: {} });
    expect(closed.status).toBe(200);
    expect(closed.body.data.closed_on.signs_counted).toBe(0);

    // And with something operationally wrong, reality is stated first.
    await insertTask({ status: "failed" });
    const withProblems = await apiJson("/api/spirit/day");
    expect(withProblems.body.data.reality_priority.warning).toBe(true);
    expect(withProblems.body.data.reality_priority.text).toMatch(/^Reality first/);

    const today = await apiJson("/api/today");
    const block = today.body.data.blocks.find((b: any) => b.key === "spirit_signal");
    expect(block.content.reality_priority.warning).toBe(true);
    expect(JSON.stringify(block)).not.toMatch(/TODO|FIXME|placeholder/i);
  });
});

describe("the ancestor hour is a reminder that only completion clears", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM ancestor_entries`).run();
  });

  it("stands until the hour is recorded, and says how it clears", async () => {
    const { body } = await apiJson("/api/spirit/day");
    const a = body.data.ancestors;
    expect(a.standing).toBe(true);
    expect(a.remaining_minutes).toBe(60);
    expect(a.dismissal).toContain("day and time");
  });

  it("HAS NO DISMISS ENDPOINT — the only way out is doing it", async () => {
    /*
     * The owner asked for a reminder she can only clear by saying she completed it and when. A
     * dismiss route would be the easiest thing to add and would defeat the whole request, so this
     * asserts its absence rather than trusting nobody adds one later.
     */
    for (const path of ["/api/spirit/ancestors/dismiss", "/api/spirit/ancestors/skip"]) {
      const { status } = await apiJson(path, { method: "POST", body: {} });
      expect(status).toBe(404);
    }
  });

  it("clears only when the recorded minutes reach the hour", async () => {
    const at = Date.now();
    await apiJson("/api/spirit/ancestors", { method: "POST", body: { who: "Grandmother", minutes: 25, ts: at } });

    const partial = await apiJson("/api/spirit/day");
    // Part of an hour is not the hour. It still stands, and it says how much is left.
    expect(partial.body.data.ancestors.standing).toBe(true);
    expect(partial.body.data.ancestors.remaining_minutes).toBe(35);

    await apiJson("/api/spirit/ancestors", { method: "POST", body: { who: "Grandmother", minutes: 35, ts: at } });
    const done = await apiJson("/api/spirit/day");
    expect(done.body.data.ancestors.standing).toBe(false);
    expect(done.body.data.ancestors.dismissal).toBeNull();
  });

  it("keeps the day and time SHE names, not the moment she typed it", async () => {
    // An hour sat with on Sunday and recorded on Tuesday is a Sunday. Filing it under the moment of
    // recording would make the record wrong in the one field the owner asked to be asked for.
    const sunday = Date.parse("2026-09-06T19:30:00-05:00");
    const { body } = await apiJson("/api/spirit/ancestors", {
      method: "POST", body: { who: "The line", minutes: 60, ts: sunday },
    });
    expect(body.data.ts).toBe(sunday);
    expect(body.data.month).toBe("2026-09");
  });

  it("files a late-evening hour in the month she was living in", async () => {
    // 8pm Central on 30 September is 1 October in UTC. Before the zone fix this landed in October.
    const lateSeptember = Date.parse("2026-10-01T01:00:00Z");
    const { body } = await apiJson("/api/spirit/ancestors", {
      method: "POST", body: { who: "The line", minutes: 60, ts: lateSeptember },
    });
    expect(body.data.month).toBe("2026-09");
  });
});
