/**
 * THE PRIVATE WORDS (22 Nov 2026, review of #546: client names and personal mail addresses reached the
 * Director's prompts). privacy.mjs finds the words her brains hold only inside a private span, and a
 * personal mail address; Noelle's context (src/worker/boss/growth/noelle.ts noelleContext) holds a business
 * whose rulings would carry one (PRIVATE_IN_PROMPT), or every business when no private word is known
 * (PRIVACY_UNREAD): tests/boss/noelleRun.test.ts. Placeholders only: no real name or address is in this repo.
 *   - a private word reaching text is a leak; a word also written in public is not private;
 *   - a personal address ends at the provider's own domain; a brand host is not one.
 */
import { describe, expect, it } from "vitest";
import { leaksIn, privateOnlyTerms } from "../src/shared/boss/growth/privacy.mjs";

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
describe("private words and personal addresses", () => {
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

  it("a personal address ends at the provider's own domain; a brand host that starts with a provider word is not one", () => {
    const none = { names: [], mails: [] };
    for (const t of ["write to zz.placeholder@gmail.com.", "zz@yahoo.co.uk", "(zz@outlook.com)", "zz@me.com, then", "ZZ@ICLOUD.COM"]) expect(leaksIn(t, none).mail, t).toBe(1);
    for (const t of ["hello@live.brand.com", "x@mac.brand.co", "team@me.brandname.io", "help@gmail.company.org", "support@keepmyproof.com"]) expect(leaksIn(t, none).mail, t).toBe(0);
  });

});
