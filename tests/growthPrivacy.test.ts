/**
 * THE GROWTH PRIVACY DRY RUN (22 Nov 2026, review of #546: client names and personal mail addresses
 * reached the Director's prompts). `npm run growth:privacy` builds every active business's decision
 * prompt from a brain copy and fails on a word the brains hold only inside a private span, or on a
 * personal mail address. Placeholders only: no real name or address is in this repo.
 *   - a clean pair of brains passes with every business checked;
 *   - a personal address left unmarked in a ruling is a leak (exit 1), named by heading only;
 *   - a private word reaching a prompt is a leak; a word also written in public is not private;
 *   - it fails closed (exit 2) on a missing copy, no private span at all, rulings not read, too few prompts.
 */
import { describe, expect, it } from "vitest";
import { checkPrompts, leaksIn, privateOnlyTerms, MIN_PROMPTS } from "../scripts/ops/growth-privacy.mjs";

const SPRY_LABELS = ["KeepMyProof", "ApprovalPrep", "Dream Wedding", "A Player Mode", "Peace Be Still"];
const entry = (label: string) => `### ${label}\n- key: ${label.toLowerCase().replace(/\s+/g, "-")}\n- buyer: a buyer\n- offer: an offer\n- money: sales\n- channels: app-store [listing] · pinterest [pin]\n`;
const spry = (labels = SPRY_LABELS, settledExtra = "") => `## Company
- The umbrella. <!-- confidential -->**Studio clients:** Zephyrine and Quillon (Zephyrine Studio); mail zz.placeholder@gmail.com<!-- /confidential -->

## People
- <!-- confidential -->Quillon's own email (pending).<!-- /confidential -->

## Settled decisions
### Umbrella, scope and money
- 2026-11-01 — The creator studios are free. <!-- confidential -->Zephyrine and Quillon.<!-- /confidential -->
### Growth (Shoestring Growth Plan, 21 Nov 2026)
- 2026-11-22 — The backlink network is an outside publisher.${settledExtra}
### Search, sites and freshness
- 2026-11-02 — SEARCH-RULING
### Brand and social
- 2026-11-03 — BRAND-RULING
### All apps
- 2026-11-04 — APPS-RULING
### Pinterest
- 2026-11-05 — PIN-RULING
${labels.map((l) => `### ${l}\n- 2026-11-06 — ${l} ruling`).join("\n")}

## Growth
${labels.map(entry).join("\n")}`;
const PNP = `## Settled decisions
### Services
- 2026-11-01 — PNP-RULING. <!-- confidential -->Customer Brindlewood<!-- /confidential -->

## Growth
### Porch & Party
- key: porch-and-party
- buyer: hosts
- offer: rentals
- money: requests
- channels: instagram [reel]
`;
const OPTS = { playbook: "THE PLAYBOOK", today: "2026-11-23" };

describe("growth:privacy, the dry run of every decision prompt", () => {
  it("clean brains pass, every active business checked, private words known", () => {
    const r = checkPrompts({ spry: spry(), "porch-and-party": PNP }, OPTS);
    expect(r.stop).toBeNull();
    expect(r.ok).toBe(true);
    expect(r.exit).toBe(0);
    expect(r.prompts).toBe(6);
    expect(r.rows.map((x) => x.business)).toEqual(["Porch & Party", ...SPRY_LABELS]);
    expect(r.rows.every((x) => x.private === 0 && x.mail === 0)).toBe(true);
    expect(r.terms).toBeGreaterThanOrEqual(4);
  });

  it("a personal address left unmarked in a ruling is a leak, named by its heading, never printed", () => {
    const r = checkPrompts({ spry: spry(SPRY_LABELS, " Posts go out from someone.else@gmail.com."), "porch-and-party": PNP }, OPTS);
    expect(r.ok).toBe(false);
    expect(r.exit).toBe(1);
    const kmp = r.rows.find((x) => x.business === "KeepMyProof")!;
    expect(kmp.mail).toBe(1);
    expect(kmp.where).toEqual(["Growth (Shoestring Growth Plan, 21 Nov 2026)"]);
    expect(JSON.stringify(r)).not.toContain("someone.else");
  });

  it("private words are the ones written only inside a span; one reaching a prompt is a leak", () => {
    const md = spry();
    const terms = privateOnlyTerms({ spry: md, "porch-and-party": PNP });
    expect(terms.names).toEqual(expect.arrayContaining(["zephyrine", "quillon", "brindlewood"]));
    expect(terms.mails).toEqual(["zz.placeholder@gmail.com"]);
    expect(terms.names).not.toContain("the");
    expect(leaksIn("A plan for Zephyrine.", terms).private).toBe(1);
    expect(leaksIn("A plan.", terms).private).toBe(0);
    // A word the prompt's own fixed text carries is not a leak, a name is.
    expect(leaksIn("A plan for the Studio of Zephyrine.", terms, new Set(["for", "studio"])).private).toBe(1);
    // A word she also writes in public is not treated as private.
    const pub = privateOnlyTerms({ spry: md.replace("- The umbrella.", "- The umbrella, Zephyrine."), "porch-and-party": PNP });
    expect(pub.names).not.toContain("zephyrine");
  });

  it("fails closed: a missing copy, no private span, rulings not read, or too few prompts is exit 2", () => {
    expect(checkPrompts({ spry: spry(), "porch-and-party": null }, OPTS).stop).toMatch(/NAMED STOP \[BRAIN_COPY_MISSING\]/);
    expect(checkPrompts({ spry: "", "porch-and-party": PNP }, OPTS).exit).toBe(2);
    const unmarked = (s: string) => s.replace(/<!--\s*\/?confidential\s*-->/g, "");
    const none = checkPrompts({ spry: unmarked(spry()), "porch-and-party": unmarked(PNP) }, OPTS);
    expect(none.exit).toBe(2);
    expect(none.stop).toMatch(/NO_PRIVATE_TERMS/);
    const noSettled = checkPrompts({ spry: spry().replace("## Settled decisions", "## Scratch"), "porch-and-party": PNP }, OPTS);
    expect(noSettled.stop).toMatch(/RULINGS_NOT_READ/);
    const few = checkPrompts({ spry: spry(SPRY_LABELS.slice(0, 4)), "porch-and-party": PNP }, OPTS);
    expect(few.exit).toBe(2);
    expect(few.stop).toMatch(new RegExp(`TOO_FEW_PROMPTS\\] 5 prompts built, at least ${MIN_PROMPTS}`));
  });
});
