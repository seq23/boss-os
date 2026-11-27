/**
 * NOELLE, the shared rules (rebuilt 24 Nov 2026, brief noelle-builds). The plan gate is gone: she is
 * full Claude Code with a persona. What stays shared: the roster, cadence and read grid, the season,
 * her daily slot, did-not-run and escalation lines, the Notices line, the call hours (H3c), the name
 * salutation route (H3a) and the posting jobs' ledger rows (H5). Each test fails when its rule goes.
 */
import { describe, expect, it } from "vitest";
import { parseRoster, growthSection } from "../src/shared/boss/growth/roster.mjs";
import { replaceSection, skeleton } from "../src/shared/boss/brains/brain.mjs";
import {
  season, slotFor, didNotRunLine, escalations, readGrid, cadenceOf, noticeLine, callWindow, callAckLine, CALL_OPEN, CALL_CLOSE,
} from "../src/shared/boss/growth/noelle.mjs";
import { routeToSeat, seatBySalutation } from "../src/shared/boss/intake/mail.mjs";
import { cleanActed, ledgerRowsFrom, postsWithoutRows } from "../src/shared/boss/growth/ledger.mjs";

const SPRY = `### Peace Be Still
- key: peace-be-still
- buyer: Black Christian families
- offer: the app, $4.99 a month
- money number: paying subscribers
- channels: threads [text-post] · instagram [carousel] · search-pages [question-page]
- languages: en
- limits: R-END-03
- paused: no

### KeepMyProof
- key: keepmyproof
- buyer: people keeping proof
- offer: the app, $2.99 a month
- money number: paying subscribers
- channels: blogger [guide-syndication] · search-pages [question-page]
- languages: en, es
- limits: R-PRV-01
- paused: no
`;
const PNP = `### Porch & Party
- key: porch-and-party
- buyer: Memphis families
- offer: porch decor installs from $350
- money number: bookings
- channels: instagram [reel, photo-set] · tiktok [reel] · facebook-page [photo-set] · google-business-profile (by hand)
- languages: en
- limits: R-END-03
- paused: no
`;
const FRIENDS = `### Hicks
- key: hicks
- channels: search-pages [question-page]
- buyer: <!-- confidential -->Owner Zebulon Quarterfield<!-- /confidential -->
`;
const brainOf = (s: string) => replaceSection(skeleton("Test"), "Growth", s);
const roster = [
  ...parseRoster(growthSection("spry", brainOf(SPRY))!, "spry"),
  ...parseRoster(growthSection("porch-and-party", brainOf(PNP))!, "porch-and-party"),
  ...parseRoster(growthSection("friends", brainOf(FRIENDS))!, "friends"),
];

describe("kept: roster, cadence, read grid, season", () => {
  it("a friends entry is a search-only client site, a selling business is full whatever its brain line says, and a private span never reaches the roster", () => {
    expect(roster.find((e) => e.key === "hicks")!.tier).toBe("search");
    expect(roster.filter((e) => e.key !== "hicks").every((e) => e.tier === "full")).toBe(true);
    const ig = parseRoster("### Industry Guides\n- key: industry-guides\n- tier: search-watch\n- channels: search-pages [guide]\n", "spry")[0]!;
    expect(ig.tier).toBe("full");
    expect(ig.problems).toContain('Industry Guides: "tier" is not a roster field (one of key, buyer, offer, money number, channels, languages, voice, design skill, limits, season, linked to-dos, paused)');
    expect(parseRoster("### Horse\n- key: horse\n- channels: search-pages [guide]\n", "spry")[0]!.tier).toBe("search");
    expect(JSON.stringify(roster)).not.toMatch(/Zebulon|Quarterfield/);
  });
  it("cadence classes; a measure with no reading is 'not read', never 0; client sites are not in the grid", () => {
    expect(cadenceOf({ channel: "threads" })).toBe("queue");
    expect(cadenceOf({ channel: "search-pages" })).toBe("weekly");
    expect(cadenceOf({ channel: "instagram", note: "by hand" })).toBe("by-hand");
    expect(cadenceOf({ channel: "carrier-pigeon" })).toBe("none");
    const g = readGrid(roster, [{ business: "keepmyproof", channel: "blogger", language: "en", value: 3 }]);
    expect(g.find((c: any) => c.business === "keepmyproof" && c.channel === "blogger" && c.language === "en")).toMatchObject({ value: 3, read: "read" });
    expect(g.find((c: any) => c.business === "keepmyproof" && c.channel === "blogger" && c.language === "es")).toMatchObject({ value: null, read: "not read" });
    expect(g.some((c: any) => c.business === "hicks")).toBe(false);
  });
  it("the season turns on 15 Dec and 1 Mar", () => {
    expect(season("2026-12-14")).toBe("christmas");
    expect(season("2026-12-15")).toBe("winter");
    expect(season("2027-03-01")).toBe("spring");
  });
});

describe("kept: slot, did-not-run, escalation, notice", () => {
  it("the slot varies 10:00-21:59, never on the hour; Thursday's is the weekly one after 14:00", () => {
    const slots = ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28"].map(slotFor);
    for (const s of slots) { expect(s.hour).toBeGreaterThanOrEqual(10); expect(s.hour).toBeLessThanOrEqual(21); expect(s.minute).not.toBe(0); }
    expect(slots[3]).toMatchObject({ kind: "weekly" });
    expect(slots[3].hour).toBeGreaterThanOrEqual(14);
    expect(new Set(slots.map((s) => `${s.hour}:${s.minute}`)).size).toBeGreaterThan(3);
  });
  it("no run row by 22:00 is 'Noelle did not run'; a recorded run is nothing", () => {
    expect(didNotRunLine([], "2026-11-23")).toMatch(/Noelle did not run on 2026-11-23/);
    expect(didNotRunLine([{ day: "2026-11-23" }], "2026-11-23")).toBeNull();
  });
  it("the same stop three days running is ONE line; two days or a gap is none", () => {
    const r = (day: string, stops: string[]) => ({ day, stops });
    expect(escalations([r("2026-11-21", ["SOURCE_STALE"]), r("2026-11-22", ["SOURCE_STALE"]), r("2026-11-23", ["SOURCE_STALE", "X"])])).toHaveLength(1);
    expect(escalations([r("2026-11-21", ["A"]), r("2026-11-22", ["SOURCE_STALE"]), r("2026-11-23", ["SOURCE_STALE"])])).toHaveLength(0);
    expect(escalations([r("2026-11-19", ["SOURCE_STALE"]), r("2026-11-22", ["SOURCE_STALE"]), r("2026-11-23", ["SOURCE_STALE"])])).toHaveLength(0);
  });
  it("one Notices line per publish, in her words", () => {
    expect(noticeLine({ label: "Porch & Party", what: "December reel", where: "Instagram", link: "https://x" })).toBe("Noelle published: Porch & Party December reel Instagram https://x");
  });
});

describe("H3c: answered within 30 minutes 10:00-23:00 Central, otherwise 'on it at 10:00'", () => {
  it("the boundaries: 07:00 and 09:59 closed (the Mac day holds her tick), 10:00 open, 22:59 open, 23:00 closed", () => {
    expect([CALL_OPEN, CALL_CLOSE]).toEqual(["10:00", "23:00"]);
    expect(callWindow("06:59")).toBe(false);
    expect(callWindow("07:00")).toBe(false);
    expect(callWindow("09:59")).toBe(false);
    expect(callWindow("10:00")).toBe(true);
    expect(callWindow("22:59")).toBe(true);
    expect(callWindow("23:00")).toBe(false);
    expect(callWindow("00:00")).toBe(false);
  });
  it("the ack line says which, and never promises 30 minutes at night", () => {
    expect(callAckLine("10:00")).toMatch(/within 30 minutes/);
    expect(callAckLine("22:59")).toMatch(/within 30 minutes/);
    expect(callAckLine("23:00")).toMatch(/on it at 10:00 Central/);
    expect(callAckLine("07:30")).toMatch(/on it at 10:00 Central/);
    expect(callAckLine("09:59")).not.toMatch(/30 minutes/);
    expect(callAckLine("06:59")).not.toMatch(/30 minutes/);
  });
});

describe("H3a: her name in the subject or opening the first line routes to Noelle", () => {
  const seats = [
    { id: "emp_chief", name: "Simone", role: "Chief of Staff", lane: "ops" },
    { id: "emp_growth", name: "Noelle", role: "Director of Growth", lane: "ops" },
    { id: "emp_briefing", name: "Camille", role: "Research", lane: "ops" },
  ];
  it("subject or salutation → Noelle; a mention mid-sentence, or another seat's name, → the default seat", () => {
    expect(routeToSeat("Noelle: carousels this week\nplease", seats)!.seat.id).toBe("emp_growth");
    expect(routeToSeat("this week\nHi Noelle, can you post the carousels?", seats)!.seat.id).toBe("emp_growth");
    expect(routeToSeat("this week\nnoelle, can you", seats)!.seat.id).toBe("emp_growth");
    expect(routeToSeat("this week\nI told Noelle about it yesterday.", seats)!.seat.id).toBe("emp_chief");
    expect(routeToSeat("Camille: the briefing\nx", seats)!.seat.id).toBe("emp_chief");
    expect(routeToSeat("Noelles and more\nx", seats)!.seat.id).toBe("emp_chief");
  });
  it("a typed tag still wins over her name", () => {
    expect(routeToSeat("Noelle: x\n#simone take this", seats)!.seat.id).toBe("emp_chief");
  });
  it("only the salutation seats; no seat named twice", () => {
    expect(seatBySalutation("Camille\nx", seats)).toBeNull();
    expect(seatBySalutation("x\nNoelle, hi", seats)!.id).toBe("emp_growth");
  });
});

describe("H5: a post reaches the ledger only on the platform's confirmation", () => {
  const keys = new Set(["peace-be-still"]);
  it("a post without a receipt, or whose item does not end in it, is refused", () => {
    expect(cleanActed({ kind: "post", business: "peace-be-still", channel: "instagram", item: "p1" }, keys)).toBeNull();
    expect(cleanActed({ kind: "post", business: "peace-be-still", channel: "instagram", item: "p1:abc", receipt: { id: "xyz" } }, keys)).toBeNull();
    expect(cleanActed({ kind: "post", business: "peace-be-still", channel: "instagram", item: "p1:abc", receipt: { id: "abc" } }, keys)).toMatchObject({ item: "p1:abc" });
    expect(cleanActed({ kind: "post", business: "not-hers", channel: "instagram", item: "p1:abc", receipt: { id: "abc" } }, keys)).toBeNull();
  });
  const now = Date.parse("2026-11-24T18:00:00Z");
  const doc = {
    posts: {
      "pbs-ruth-1": { runs: [{ channel: "instagram", buffer_id: "b1", queued_at: "2026-11-23T15:00:00Z" }, { channel: "facebook", buffer_id: "b2", queued_at: "2026-11-23T15:00:01Z" }] },
      "pbs-old": { runs: [{ channel: "instagram", buffer_id: "b0", queued_at: "2026-11-01T15:00:00Z" }] },
      "pbs-unsent": { runs: [{ channel: "instagram", queued_at: "2026-11-23T15:00:00Z" }] },
    },
  };
  it("posted.json → one row per accepted run, in the window, facebook as facebook-page", () => {
    const rows = ledgerRowsFrom(doc, { business: "peace-be-still", now });
    expect(rows.map((r) => `${r.channel} ${r.item}`)).toEqual(["instagram pbs-ruth-1:b1", "facebook-page pbs-ruth-1:b2"]);
    expect(rows.every((r) => cleanActed(r, keys))).toBe(true);
    expect(ledgerRowsFrom({}, { business: "peace-be-still", now })).toEqual([]);
  });
  it("Monday: a post with no row is missing; every row present is none missing", () => {
    expect(postsWithoutRows(doc, [], { channel: "instagram", now })).toEqual({ posted: 1, missing: ["pbs-ruth-1:b1"] });
    expect(postsWithoutRows(doc, ["pbs-ruth-1:b1"], { channel: "instagram", now })).toEqual({ posted: 1, missing: [] });
    expect(postsWithoutRows(doc, [], { channel: "instagram", now, since: "2026-11-24" })).toEqual({ posted: 0, missing: [] });
  });
});
