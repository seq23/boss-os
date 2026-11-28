/**
 * NOELLE'S SITE LISTS AGREE EVERYWHERE (review of #581, F4, 27 Nov 2026: "Same value everywhere: the full list, the
 * Hicks and Horse approval rules match persona, broker, permissions and docs"). Her rulings of 23 and 25 Nov 2026:
 * Industry Guides and WPP-llm are full like the six; Hicks and Horse are client sites grown through search only.
 * The one remit file is scripts/ops/noelle/sites.md. Each place that repeats part of it is read here and compared:
 * the reads map (noelle-reads REPOS), the broker's repo limit (HER_REPOS) and client footers (CLIENT_FOOTERS), the
 * roster's tiers, the permissions file that keeps Sequoia's yes out of Noelle's reach, the persona and the docs.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error plain .mjs script, no types
import { CLIENT_FOOTERS, HER_REPOS } from "../scripts/ops/noelle-guard.mjs";
// @ts-expect-error plain .mjs script, no types
import { REPOS } from "../scripts/ops/lib/noelle-reads.mjs";
import { CLIENT_KEYS, parseRoster } from "../src/shared/boss/growth/roster.mjs";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const sites = read("scripts/ops/noelle/sites.md");
const [fullPart = "", clientPart = ""] = sites.split("## Client sites");
const persona = read("scripts/ops/noelle/persona.md");
const ops = read("docs/boss/OPERATIONS.md");
const opsNoelle = ops.slice(ops.indexOf("## Noelle, the Growth Director"), ops.indexOf("\n## ", ops.indexOf("## Noelle, the Growth Director") + 5));
const perms = JSON.parse(read("scripts/ops/noelle-permissions.json"));

/** How sites.md names each business in REPOS. */
const LABEL: Record<string, string> = {
  "porch-and-party": "Porch & Party", approvalprep: "ApprovalPrep", "dream-wedding": "Dream Wedding", "a-player-mode": "A Player Mode",
  keepmyproof: "KeepMyProof", "peace-be-still": "Peace Be Still", "industry-guides": "Industry Guides", "wpp-llm": "WPP-llm",
  hicks: "Hicks", horse: "Horse",
};

/** The growth brain each business's roster entry lives in (WPP-llm in west-peek, the client sites in friends). */
const BRAIN: Record<string, string> = {
  "porch-and-party": "porch-and-party", approvalprep: "spry", "dream-wedding": "spry", "a-player-mode": "spry", keepmyproof: "spry",
  "peace-be-still": "spry", "industry-guides": "spry", "wpp-llm": "west-peek", hicks: "friends", horse: "friends",
};

describe("Noelle's site lists agree across sites.md, reads, broker, roster, permissions, persona and docs", () => {
  it("every business she reads is named in sites.md, full or client, and every repo she reads is one the broker allows", () => {
    expect(Object.keys(REPOS).sort()).toEqual(Object.keys(LABEL).sort());
    for (const repo of Object.values(REPOS).flat() as string[]) expect(HER_REPOS).toContain(repo);
    expect(HER_REPOS).toContain("search-loop");
    expect(fullPart).toMatch(/Search Loop engine directly/);
    for (const key of Object.keys(REPOS)) {
      const client = CLIENT_KEYS.includes(key);
      expect(client ? clientPart : fullPart, key).toContain(LABEL[key]);
      expect(client ? fullPart : clientPart, key).not.toContain(`**${LABEL[key]}`);
    }
  });

  it("the client sites are the same two everywhere: roster, reads, broker footers and sites.md", () => {
    expect([...CLIENT_KEYS].sort()).toEqual(["hicks", "horse"]);
    const clientRepos = CLIENT_KEYS.flatMap((k: string) => REPOS[k]).sort();
    expect(Object.keys(CLIENT_FOOTERS).sort()).toEqual(clientRepos);
    for (const repo of clientRepos) expect(clientPart).toContain(`\`${repo}\``);
    for (const key of Object.keys(REPOS)) {
      const [entry] = parseRoster(`### ${LABEL[key]}\n- key: ${key}\n- channels: search-pages [guide]\n`, BRAIN[key]!);
      expect(entry!.tier, key).toBe(CLIENT_KEYS.includes(key) ? "search" : "full");
    }
  });

  it("Sequoia's yes for Hicks lives where Noelle cannot write, and sites.md, the footer and the docs name the same place", () => {
    const notes = "~/Work/noelle/owner-notes.md";
    expect(perms.permissions.deny).toEqual(expect.arrayContaining([`Edit(${notes})`, `Write(${notes})`]));
    expect(perms.sandbox.filesystem.denyWrite).toContain(notes);
    const hicks = clientPart.slice(clientPart.indexOf("**Hicks**"), clientPart.indexOf("**Horse**"));
    for (const text of [hicks, CLIENT_FOOTERS["hicks-consulting-canonical"], opsNoelle]) {
      expect(text).toMatch(/Sequoia/);
      expect(text).toContain("owner-notes.md");
      expect(text).toMatch(/call ID/);
      expect(text).toMatch(/never (?:in|take it from) (?:your|Noelle's) handoff/);
    }
    expect(hicks).not.toMatch(/the owner'?s? (?:recorded )?(?:yes|approval)/i);
    const horse = clientPart.slice(clientPart.indexOf("**Horse**"));
    for (const text of [horse, CLIENT_FOOTERS["horse-legal-guide-velocity"]]) {
      expect(text).toContain("editorial_backlog.json");
      expect(text).toMatch(/max_pages_per_new_page`? (?:to `0`|is 0)/);
    }
  });

  it("the persona and docs carry no second site list or old watch rule, and point to sites.md", () => {
    for (const text of [persona, opsNoelle]) {
      expect(text).toMatch(/sites\.md/);
      expect(text).not.toMatch(/search-watch|proposal-only|approval evidence in\s+the handoff/i);
    }
    expect(persona).not.toMatch(/WPP-llm|Industry Guides|search only|main-site/);
    expect(opsNoelle).toContain("`hicks-consulting-canonical`");
    expect(opsNoelle).toContain("`horse-legal-guide-velocity`");
  });
});
