import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { apiJson, uid } from "./helpers";
import { monthKey, monthRange } from "../../src/worker/boss/today/returns";

/**
 * THE RETURN-ON-EFFORT LEDGER.
 *
 * The assertions that matter are not about arithmetic. They are about the three ways this feature
 * could quietly lie to her:
 *
 *   · showing an unmeasured line as a zero, which reads as "this line is dead",
 *   · letting a proxy stand in silently for the outcome a line actually exists for,
 *   · presenting the lines in an order that amounts to advice she did not ask for.
 */

async function clear() {
  await env.DB.prepare(`DELETE FROM line_returns`).run();
  await env.DB.prepare(`DELETE FROM sourcing_candidates`).run();
  await env.DB.prepare(`DELETE FROM deals`).run();
}

const MONTH = "2026-04";

describe("return-on-effort ledger", () => {
  beforeEach(clear);

  it("puts a month boundary in her timezone, not UTC", () => {
    const { from, to } = monthRange(MONTH);
    // 1 April 2026 00:00 CDT is 05:00 UTC. A naive UTC boundary would be five hours early and would
    // move every late-evening act on the 31st into the following month.
    expect(new Date(from).toISOString()).toBe("2026-04-01T05:00:00.000Z");
    expect(monthKey(from)).toBe("2026-04");
    expect(monthKey(to - 1)).toBe("2026-04");
    expect(monthKey(to)).toBe("2026-05");
  });

  it("reports a ratio rather than a total, and rounds to per-mille so a real rate is not lost", async () => {
    // Her actual number: 542 LP emails produced 4 replies. As a whole percentage that is "0%".
    const posted = await apiJson("/api/wealth/returns", {
      method: "POST",
      body: {
        measurements: [{
          line: "west_peek_raise", period: MONTH, source: "lp_tracker",
          effort_label: "LP emails sent", effort_count: 542,
          outcome_label: "replies", outcome_count: 4,
        }],
      },
    });
    expect(posted.status).toBe(200);

    const { body } = await apiJson(`/api/wealth/returns?period=${MONTH}`);
    const raise = body.data.lines.find((l: any) => l.line === "west_peek_raise");
    const pair = raise.pairs.find((p: any) => p.source === "lp_tracker");
    expect(pair.effort_count).toBe(542);
    expect(pair.outcome_count).toBe(4);
    expect(pair.per_mille).toBe(7);
    expect(raise.measured).toBe(true);
  });

  /*
   * THE CENTRAL ASSERTION. Zero and unmeasured must never render the same, because the correct
   * response to them is opposite: stop working the first, instrument the second.
   */
  it("keeps a measured zero and an unmeasured blank distinguishable", async () => {
    await env.DB
      .prepare(
        `INSERT INTO sourcing_candidates (id, name, kind, thesis, read_at, origin, status, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .bind(uid("src"), "A buyer", "buyer", "why", Date.now(), "public_research", "new", monthRange(MONTH).from + 1000, monthRange(MONTH).from + 1000)
      .run();

    const { body } = await apiJson(`/api/wealth/returns?period=${MONTH}`);
    const brokerage = body.data.lines.find((l: any) => l.line === "brokerage");
    const worked = brokerage.pairs.find((p: any) => p.outcome_label === "moved to contacted or promoted");

    // Measured, and the answer is none. Not null.
    expect(worked.effort_count).toBe(1);
    expect(worked.outcome_count).toBe(0);
    expect(worked.per_mille).toBe(0);

    // The spry lines are the grid now: `youtube` and `saas` were two of the five vague entries
    // projects.ts carried before it, and the grid she actually gave names neither.
    const youtube = body.data.lines.find((l: any) => l.line === "virtual_agency");
    const blank = youtube.pairs[0];
    expect(blank.outcome_count).toBeNull();
    expect(blank.per_mille).toBeNull();
    expect(youtube.measured).toBe(false);
  });

  it("refuses an unmeasured contribution that does not say why it is unmeasured", async () => {
    const res = await apiJson("/api/wealth/returns", {
      method: "POST",
      body: {
        measurements: [{
          line: "hpc", period: MONTH, source: "search_console",
          effort_label: "impressions", effort_count: 100,
          outcome_label: "partnerships", outcome_count: null,
        }],
      },
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain("unmeasured");
  });

  /*
   * The proxy trap. Search Console clicks are a real number for the ads line and are not what the
   * line is for; if contributing them made the blind spot disappear, the screen would look
   * finished while the revenue question stayed unasked.
   */
  it("keeps the blind spot visible on a line that has just been given numbers", async () => {
    await apiJson("/api/wealth/returns", {
      method: "POST",
      body: {
        measurements: [{
          line: "citation_velocity", period: MONTH, source: "search_console",
          effort_label: "impressions earned", effort_count: 7642,
          outcome_label: "clicks", outcome_count: 24, window_days: 28,
        }],
      },
    });
    const { body } = await apiJson(`/api/wealth/returns?period=${MONTH}`);
    const ads = body.data.lines.find((l: any) => l.line === "citation_velocity");
    expect(ads.measured).toBe(true);
    const blind = ads.pairs.filter((p: any) => p.kind === "blind_spot");
    expect(blind.length).toBe(1);
    expect(blind[0].outcome_count).toBeNull();
    expect(blind[0].unmeasured_why).toContain("nothing here sees the invoice");
  });

  it("returns the lines in her own order and never sorted by return", async () => {
    await apiJson("/api/wealth/returns", {
      method: "POST",
      body: {
        measurements: [{
          line: "authority_network", period: MONTH, source: "manual",
          effort_label: "asks sent", effort_count: 2, outcome_label: "links", outcome_count: 2,
        }],
      },
    });
    const { body } = await apiJson(`/api/wealth/returns?period=${MONTH}`);
    expect(body.data.lines.map((l: any) => l.line)).toEqual([
      "brokerage", "west_peek_raise",
      // The grid, in its own order — `src/shared/boss/grid.mjs`.
      "guides_generator", "citation_velocity", "horse_legal", "hicks_consulting",
      "virtual_agency", "hpc", "approvalprep", "wedding",
      // Added 13 Sep 2026 when she confirmed all three were hers. This list is pinned ON PURPOSE:
      // it fails whenever the grid gains or loses a line, so a property can never appear in — or
      // vanish from — her returns ledger without someone saying so here.
      "youtube", "saas_apps",
      "authority_network",
    ]);
    expect(body.data.ordering_note).toContain("Nothing here ranks them");
  });

  it("refuses an income line that projects.ts does not declare", async () => {
    const res = await apiJson("/api/wealth/returns", {
      method: "POST",
      body: {
        measurements: [{
          line: "crypto_moonshot", period: MONTH, source: "manual",
          effort_label: "hours", effort_count: 40, outcome_label: "dollars", outcome_count: 0,
        }],
      },
    });
    expect(res.status).toBe(400);
  });

  it("upserts rather than appends, so running the job twice does not double the month", async () => {
    const one = {
      measurements: [{
        line: "west_peek_raise", period: MONTH, source: "lp_tracker",
        effort_label: "LP emails sent", effort_count: 100, outcome_label: "replies", outcome_count: 1,
      }],
    };
    await apiJson("/api/wealth/returns", { method: "POST", body: one });
    await apiJson("/api/wealth/returns", { method: "POST", body: one });
    const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM line_returns WHERE period = ?`).bind(MONTH).first<{ n: number }>();
    expect(row!.n).toBe(1);
  });

  it("keeps the lifetime pair out of the month, because adding them double-counts every send", async () => {
    await apiJson("/api/wealth/returns", {
      method: "POST",
      body: {
        measurements: [
          { line: "west_peek_raise", period: "all", source: "lp_tracker", effort_label: "LP emails sent, all time", effort_count: 542, outcome_label: "replies", outcome_count: 4 },
          { line: "west_peek_raise", period: MONTH, source: "lp_tracker", effort_label: "LP emails sent", effort_count: 60, outcome_label: "replies", outcome_count: 0 },
        ],
      },
    });
    const { body } = await apiJson(`/api/wealth/returns?period=${MONTH}`);
    const raise = body.data.lines.find((l: any) => l.line === "west_peek_raise");
    expect(raise.pairs.filter((p: any) => p.source === "lp_tracker").map((p: any) => p.effort_count)).toEqual([60]);
    expect(body.data.lifetime.map((r: any) => r.effort_count)).toEqual([542]);
  });
});

describe("LP × buyer cross-matches", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM counterparty_crossmatches`).run();
  });

  const row = (over: Record<string, unknown> = {}) => ({
    candidate_id: "src_1", candidate_name: "StepStone Group (VC Secondaries Fund VI)",
    lp_firm: "StepStone", matched_core: "stepstone", confidence: "confirmed",
    method: "core_exact_subset", lp_list: "suppressed", lp_contacts: 1,
    why: "On your LP do-not-contact list, and on the buyer list.",
    ...over,
  });

  it("returns confirmed and near in separate arrays so they cannot be skimmed as one list", async () => {
    await apiJson("/api/wealth/crossmatches", {
      method: "POST",
      body: { matches: [row(), row({ candidate_id: "src_2", lp_firm: "Stepstone Capital", confidence: "near", method: "core_exact" })] },
    });
    const { body } = await apiJson("/api/wealth/crossmatches");
    expect(body.data.confirmed.length).toBe(1);
    expect(body.data.near.length).toBe(1);
    expect(body.data.confirmed[0].lp_firm).toBe("StepStone");
  });

  /*
   * The privacy guard. The relationship sync carries the same one and it caught a real leak on its
   * first run, so this is a demonstrated failure mode rather than a hypothetical one.
   */
  it("refuses the whole batch when an email address appears in a firm field", async () => {
    const res = await apiJson("/api/wealth/crossmatches", {
      method: "POST",
      body: { matches: [row(), row({ candidate_id: "src_3", lp_firm: "griff.norville@hamiltonlane.com" })] },
    });
    expect(res.status).toBe(409);
    const after = await env.DB.prepare(`SELECT COUNT(*) AS n FROM counterparty_crossmatches`).first<{ n: number }>();
    // The good row in the same batch is not kept: a partial write here would leave her with a list
    // she believes is complete.
    expect(after!.n).toBe(0);
  });

  it("refuses a third confidence tier", async () => {
    const res = await apiJson("/api/wealth/crossmatches", {
      method: "POST", body: { matches: [row({ confidence: "probably" })] },
    });
    expect(res.status).toBe(400);
  });

  it("records which LP list the firm is on, because suppressed as an LP is not suppressed as a buyer", async () => {
    await apiJson("/api/wealth/crossmatches", { method: "POST", body: { matches: [row()] } });
    const { body } = await apiJson("/api/wealth/crossmatches");
    expect(body.data.confirmed[0].lp_list).toBe("suppressed");
  });

  it("takes her verdict and refuses a status nothing defines", async () => {
    await apiJson("/api/wealth/crossmatches", { method: "POST", body: { matches: [row()] } });
    const { body } = await apiJson("/api/wealth/crossmatches");
    const id = body.data.confirmed[0].id;

    const bad = await apiJson(`/api/wealth/crossmatches/${id}/status`, { method: "POST", body: { status: "maybe" } });
    expect(bad.status).toBe(400);

    const good = await apiJson(`/api/wealth/crossmatches/${id}/status`, { method: "POST", body: { status: "acted" } });
    expect(good.status).toBe(200);
    const after = await apiJson("/api/wealth/crossmatches");
    expect(after.body.data.confirmed[0].status).toBe("acted");
  });
});
