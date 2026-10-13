import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FUND_SIDE_CHASSIS_SENDERS } from "../scripts/ops/fund-side-chassis.mjs";
import { BUSINESSES } from "../src/worker/boss/outreach/catalog";

/**
 * docs/OUTBOUND_EMAIL_MAP.md is read by code, so it is a rule and not a wish (owner, 12 Oct 2026:
 * "Boss should hold the artifact that explains the cadence and types of emails and schedule").
 *
 * 1. Every inventory row whose Code cell starts with `boss-os` cites files that exist here.
 * 2. Every stable Id appears in the document exactly once.
 * 3. Every tracked file in this repo that calls an email transport is cited by some boss-os row,
 *    so a new sender that is not on the map fails here, by name.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAP_PATH = "docs/OUTBOUND_EMAIL_MAP.md";
const MAP = readFileSync(path.join(ROOT, MAP_PATH), "utf8");

interface Row {
  id: string;
  code: string;
}

/** The inventory table: the one whose header row starts `| Id |`. */
export function inventoryRows(doc: string): Row[] {
  const lines = doc.split("\n");
  const start = lines.findIndex((l) => /^\|\s*Id\s*\|/.test(l));
  if (start === -1) return [];
  const header = cells(lines[start] ?? "");
  const codeAt = header.indexOf("Code");
  const rows: Row[] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    const c = cells(line);
    rows.push({ id: (c[0] ?? "").replace(/`/g, "").trim(), code: c[codeAt] ?? "" });
  }
  return rows;
}

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((s) => s.trim());
}

/**
 * Turn a Code cell such as `boss-os src/worker/boss/outreach/engine.ts, gmail.ts` or
 * `boss-os scripts/ops/task-notices.mjs + notify.mjs` into repo paths. A bare name sits in the
 * directory of the path before it, or at the repo root; flags (`--send`) and `~` paths (outside
 * the repo) are not file citations.
 */
export function citedPaths(code: string, exists: (p: string) => boolean): { found: string[]; missing: string[] } {
  const found: string[] = [];
  const missing: string[] = [];
  let dir = "";
  for (const piece of code.replace(/^boss-os\s+/, "").split(/[,+;]/)) {
    const token = piece.trim().split(/\s+/)[0] ?? "";
    if (!token || token.startsWith("-") || token.startsWith("~") || !/\.[a-z]+$/i.test(token)) continue;
    const candidates = token.includes("/") ? [token] : [path.posix.join(dir, token), token];
    const hit = candidates.find(exists);
    if (hit) found.push(hit);
    else missing.push(candidates[0] ?? token);
    if (token.includes("/")) dir = path.posix.dirname(token);
  }
  return { found, missing };
}

/** What counts as calling an email transport: the Resend endpoint, Gmail's send, the Workers
 *  send_email binding, or the Mac lanes' shared Resend helper. */
const TRANSPORT = [
  /api\.resend\.com\/emails/,
  /["'`/]messages\/send["'`]/,
  /\benv\.EMAIL\.send\(/,
  /\bemployeeMail\(/,
];

/** Fixtures and docs name the endpoints without sending anything. */
function isScanned(file: string): boolean {
  if (!/\.(ts|tsx|mjs|js|cjs|sh|py)$/.test(file)) return false;
  return !/^(tests|e2e|scripts\/validate|docs)\//.test(file) && !/\.test\.[a-z]+$/.test(file);
}

export function uncitedSenders(files: Array<{ file: string; source: string }>, cited: Set<string>): string[] {
  return files
    .filter(({ file, source }) => isScanned(file) && TRANSPORT.some((re) => re.test(source)))
    .map(({ file }) => file)
    .filter((file) => !cited.has(file));
}

/**
 * CHASSIS COPIES WHOSE FUNCTION IS THE FUND'S (owner, 12 Oct 2026: Boss OS and the fund are two
 * businesses and never cross). These files were copied in with the chassis and still send, but what
 * they send is the fund's (capital matches, buyer hunts, people, LP digests), so their rows live on
 * the fund's own map, never on this one. ONE closed list: a file here must still exist and still
 * send, or the exemption is stale and fails by name.
 */
// The list lives in scripts/ops/fund-side-chassis.mjs so the From guard reads the same one.

const exists = (p: string) => existsSync(path.join(ROOT, p));
const bossRows = inventoryRows(MAP).filter((r) => /^boss-os\b/.test(r.code));

describe("docs/OUTBOUND_EMAIL_MAP.md is read by code", () => {
  it("has boss-os rows (hard fail on zero)", () => {
    expect(bossRows.length, "no boss-os rows parsed from the map: the table or its Code column moved").toBeGreaterThan(0);
  });

  it("every boss-os row cites files that exist in this repo", () => {
    const bad: string[] = [];
    for (const row of bossRows) {
      const { found, missing } = citedPaths(row.code, exists);
      if (found.length === 0) bad.push(`${row.id}: cites no file that exists (${row.code})`);
      for (const m of missing) bad.push(`${row.id}: ${m} does not exist`);
    }
    expect(bad).toEqual([]);
  });

  it("every stable Id appears in the document exactly once", () => {
    const rows = inventoryRows(MAP);
    expect(rows.length).toBeGreaterThan(0);
    const bad = rows
      .map((r) => ({ id: r.id, n: MAP.split(`\`${r.id}\``).length - 1 }))
      .filter((r) => !r.id || r.n !== 1)
      .map((r) => `${r.id || "(empty id)"} appears ${r.n} times`);
    expect(bad).toEqual([]);
  });

  it("every file here that calls an email transport is cited by a boss-os row", () => {
    const cited = new Set([...bossRows.flatMap((r) => citedPaths(r.code, exists).found), ...FUND_SIDE_CHASSIS_SENDERS]);
    const files = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter((f) => f && isScanned(f) && existsSync(path.join(ROOT, f)))
      .map((file) => ({ file, source: readFileSync(path.join(ROOT, file), "utf8") }));
    const senders = files.filter(({ source }) => TRANSPORT.some((re) => re.test(source)));
    expect(senders.length, "the transport scan found no senders at all: the patterns went stale").toBeGreaterThan(0);
    const uncited = uncitedSenders(files, cited);
    expect(
      uncited,
      `These files send email but are not on the map. Add each to ${MAP_PATH} (and its page) in the same PR:\n  ${uncited.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every fund-side chassis exemption still exists and still sends (no stale exemption)", () => {
    const stale = FUND_SIDE_CHASSIS_SENDERS.filter(
      (f) => !exists(f) || !TRANSPORT.some((re) => re.test(readFileSync(path.join(ROOT, f), "utf8"))),
    );
    expect(stale, `Remove these from FUND_SIDE_CHASSIS_SENDERS: they no longer exist or no longer send:\n  ${stale.join("\n  ")}`).toEqual([]);
  });

  it("the scan catches a new sender and the parser reads bare names against the previous path", () => {
    const cited = new Set(["scripts/ops/notify.mjs"]);
    const out = uncitedSenders(
      [
        { file: "scripts/ops/new-lane.mjs", source: 'await fetch("https://api.resend.com/emails", {})' },
        { file: "scripts/ops/notify.mjs", source: 'await fetch("https://api.resend.com/emails", {})' },
        { file: "tests/x.test.ts", source: 'fetch("https://api.resend.com/emails")' },
      ],
      cited,
    );
    expect(out).toEqual(["scripts/ops/new-lane.mjs"]);
    const real = (p: string) => ["scripts/ops/task-notices.mjs", "scripts/ops/notify.mjs", "wrangler.toml"].includes(p);
    expect(citedPaths("boss-os scripts/ops/task-notices.mjs + notify.mjs", real)).toEqual({
      found: ["scripts/ops/task-notices.mjs", "scripts/ops/notify.mjs"],
      missing: [],
    });
    expect(citedPaths("boss-os scripts/ops/task-notices.mjs --nudge --send, wrangler.toml env.production, ~/x.sh", real).found).toEqual([
      "scripts/ops/task-notices.mjs",
      "wrangler.toml",
    ]);
  });
});

describe("the map and the side-business review are linked where people look", () => {
  const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
  const ops = readFileSync(path.join(ROOT, "docs/boss/OPERATIONS.md"), "utf8");
  it.each([
    ["README.md", readme, "docs/"],
    ["docs/boss/OPERATIONS.md", ops, "../"],
  ])("%s links both docs and states the same-PR rule", (_name, text, prefix) => {
    expect(text).toContain(`(${prefix}OUTBOUND_EMAIL_MAP.md)`);
    expect(text).toContain(`(${prefix}SIDE_BUSINESS_REVIEW.md)`);
    expect(text).toMatch(/Email the businesses send/);
    expect(text).toMatch(/same PR/);
  });
  it("each copy starts with its source page and the repo-copy line", () => {
    for (const [file, url] of <Array<[string, string]>>[
      [MAP_PATH, "https://claude.ai/artifact/8wsHZmD7QJEuNnZEPideCr"],
      ["docs/SIDE_BUSINESS_REVIEW.md", "https://claude.ai/artifact/2XkmYNmppidkqr4SU8xwiv"],
    ]) {
      const text = readFileSync(path.join(ROOT, file), "utf8");
      expect(text.split("\n")[0]).toBe(`Source: ${url}`);
      expect(text).toContain("Repo copy; the page is the living version; refreshed when it changes.");
    }
  });
});

/**
 * EVERY PATH HAS AN OWNER (owner, 12 Oct 2026: Team → Duties is the single operations view). The
 * owner of each map row lives in ONE file beside the map, and the page is compiled from the map and
 * that file, so a path with no owner fails here, by name, before it can reach the screen.
 */
describe("every path on the map has an owner, and Team → Duties is built from the map", () => {
  const OWNERS_PATH = "docs/outbound_email_owners.json";
  const ownersFile = JSON.parse(readFileSync(path.join(ROOT, OWNERS_PATH), "utf8")) as {
    outside: string[];
    owners: Record<string, { seat?: string; why?: string }>;
  };
  const castNames = (
    JSON.parse(readFileSync(path.join(ROOT, "src/client/public/employees-boss/CASTING.json"), "utf8")).cast as Array<{ name: string }>
  ).map((c) => c.name);
  const ids = inventoryRows(MAP).map((r) => r.id);

  it("reads rows and seats (hard fail on zero)", () => {
    expect(ids.length, "no rows parsed from the map").toBeGreaterThan(0);
    expect(castNames.length, "no seats parsed from CASTING.json").toBeGreaterThan(0);
  });

  it("every map row has an owner entry with a seat and a reason", () => {
    const missing = ids.filter((id) => !ownersFile.owners[id]?.seat?.trim() || !ownersFile.owners[id]?.why?.trim());
    expect(
      missing,
      `These paths on ${MAP_PATH} have no owner. Add each to ${OWNERS_PATH} with the seat that owns it and why, in the same PR:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every owner entry names a row still on the map", () => {
    const stale = Object.keys(ownersFile.owners).filter((id) => !ids.includes(id));
    expect(stale, `${OWNERS_PATH} names paths the map no longer has; remove them:\n  ${stale.join("\n  ")}`).toEqual([]);
  });

  it("every owner is a seat on the roster or a named outside owner", () => {
    const allowed = new Set([...castNames, ...ownersFile.outside]);
    const bad = Object.entries(ownersFile.owners)
      .filter(([, o]) => !allowed.has(o.seat ?? ""))
      .map(([id, o]) => `${id}: "${o.seat}" is not a seat in CASTING.json or listed in "outside"`);
    expect(bad).toEqual([]);
  });

  it("the page imports the map and the owners file themselves, never a copy", () => {
    const src = readFileSync(path.join(ROOT, "src/client/boss/operationsSource.ts"), "utf8");
    expect(src).toContain('from "../../../docs/OUTBOUND_EMAIL_MAP.md?raw"');
    expect(src).toContain('from "../../../docs/outbound_email_owners.json"');
  });
});

/**
 * BOSS OS AND THE FUND NEVER CROSS (owner, 12 Oct 2026). #77 and #78 put the fund's sending paths
 * and a fund seat onto this map and onto Team -> Duties, in a public repo. This fails, by Id and by
 * the term found, on any map row, any owner entry, or the map document itself naming the fund's
 * repos, its senders, its people or its investors. Their rows belong on the fund's own map.
 */
export const FUND_TERMS: Array<[string, RegExp]> = [
  ["a west-peek-* repo", /\bwest-?peek-[a-z]/i],
  ["a westpeek domain", /@?\bwestpeek\.[a-z]+/i],
  ["a joinwestpeek.com sender", /joinwestpeek\.com/i],
  ["West Peek", /west\s*peek/i],
  ["Porter", /\bporter\b/i],
  ["Scooter", /\bscooter\b/i],
  ["LP", /\bLPs?\b/],
  ["investor", /\binvestors?\b/i],
];

export function fundCrossings(entries: Array<[string, string]>): string[] {
  const hits: string[] = [];
  for (const [where, text] of entries) {
    for (const [name, re] of FUND_TERMS) if (re.test(text)) hits.push(`${where}: names ${name}`);
  }
  return hits;
}

describe("Boss OS and the fund never cross on the map", () => {
  const ownersRaw = JSON.parse(readFileSync(path.join(ROOT, "docs/outbound_email_owners.json"), "utf8")) as {
    outside: string[];
    owners: Record<string, { seat?: string; why?: string }>;
  };
  const rowLines = MAP.split("\n").filter((l) => /^\|\s*`[^`]+`\s*\|/.test(l));

  it("reads rows and owners (hard fail on zero)", () => {
    expect(rowLines.length).toBeGreaterThan(0);
    expect(Object.keys(ownersRaw.owners).length).toBeGreaterThan(0);
  });

  it("no map row, no owner entry, no outside seat and no line of the map names the fund", () => {
    const entries: Array<[string, string]> = [
      ...rowLines.map((l): [string, string] => [`map row ${(l.match(/`([^`]+)`/) ?? [])[1]}`, l]),
      ...Object.entries(ownersRaw.owners).map(([id, o]): [string, string] => [`owner ${id}`, `${id} ${o.seat ?? ""} ${o.why ?? ""}`]),
      ...ownersRaw.outside.map((s): [string, string] => [`outside seat "${s}"`, s]),
      ...MAP.split("\n").map((l, i): [string, string] => [`${MAP_PATH}:${i + 1}`, l]),
    ];
    const hits = fundCrossings(entries);
    expect(hits, `The fund's paths and seats never go on the Boss OS map; move them to the fund's own map:\n  ${hits.join("\n  ")}`).toEqual([]);
  });

  it("the guard catches each term (it is not watching an empty room)", () => {
    const probes = [
      "| `x` | West Peek | e | os@westpeek.ventures | t |",
      "| `x` | b | e | hello@joinwestpeek.com | t |",
      "| `x` | b | e | f | t | west-peek-os src/a.ts |",
      "Porter (West Peek OS)",
      "replies to Scooter",
      "LPs who replied",
      "an investor update",
    ];
    for (const p of probes) expect(fundCrossings([["probe", p]]), p).not.toEqual([]);
    expect(fundCrossings([["clean", "| `monique-outreach` | The Industry Guides | Reporter of help | hello@uscisexam.com |"]])).toEqual([]);
  });
});

/**
 * EVERY OUTREACH SENDER IS ON THE MAP (13 Oct 2026, Memphis Senior Care Homes). A business added to
 * the outreach catalog sends from a new address; the map must name that address in a boss-os row's
 * From cell, and the vertical's own site emails each have their row and owner, so a new vertical
 * cannot start sending unseen.
 */
describe("every outreach sender and every Memphis Senior Care Homes path is on the map", () => {
  const header = cells(MAP.split("\n").find((l) => /^\|\s*Id\s*\|/.test(l)) ?? "");
  const fromAt = header.indexOf("From");
  const statusAt = header.indexOf("Status");
  const lines = MAP.split("\n").filter((l) => /^\|\s*`[^`]+`\s*\|/.test(l));
  const byId = new Map(lines.map((l) => [(l.match(/`([^`]+)`/) ?? [])[1] ?? "", cells(l)]));
  const owners = JSON.parse(readFileSync(path.join(ROOT, "docs/outbound_email_owners.json"), "utf8")).owners as Record<string, { seat?: string }>;

  it("reads the From column and the catalog (hard fail on zero)", () => {
    expect(fromAt).toBeGreaterThan(0);
    expect(BUSINESSES.length).toBeGreaterThan(0);
  });

  it("every catalog sender appears in the From cell of a boss-os row", () => {
    const froms = lines.filter((l) => /^boss-os\b/.test(cells(l)[header.indexOf("Code")] ?? "")).map((l) => cells(l)[fromAt] ?? "");
    const missing = BUSINESSES.map((b) => b.sender).filter((sender) => !froms.some((f) => f.split(/[\s,<>]+/).includes(sender)));
    expect(missing, `Outreach senders with no row on ${MAP_PATH}:\n  ${missing.join("\n  ")}`).toEqual([]);
  });

  it("Memphis Senior Care Homes has its outreach row and its five site-email rows, each owned, unread ones SUSPECTED", () => {
    const outreach = byId.get("memphis-senior-outreach");
    expect(outreach, "memphis-senior-outreach row").toBeTruthy();
    expect(outreach![fromAt]).toBe("hello@memphisseniorcarehomes.com");
    expect(outreach![statusAt]).toBe("CONFIRMED");
    const site = ["senior-lead-notification", "senior-facility-teaser", "senior-facility-release", "senior-pass-notice", "senior-family-followups"];
    for (const id of [...site, "memphis-senior-outreach"]) {
      expect(byId.has(id), `${id} is not on the map`).toBe(true);
      expect(owners[id]?.seat, `${id} has no owner`).toBeTruthy();
    }
    for (const id of site) {
      const row = byId.get(id)!;
      expect(row[fromAt], id).toBe("The Industry Guides <hello@theindustryguides.com>");
      expect(row.join(" "), id).toContain("local-guides-generator-senior-living");
      expect(row.join(" "), id).toContain("RESEND_API_KEY");
      // Nobody read these functions on main, so the row may not claim CONFIRMED.
      expect(row[statusAt], id).toBe("SUSPECTED");
    }
  });
});
