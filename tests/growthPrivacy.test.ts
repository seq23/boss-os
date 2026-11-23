/**
 * THE GROWTH PRIVACY DRY RUN (22 Nov 2026, review of #546: client names and personal mail addresses
 * reached the Director's prompts). `npm run growth:privacy` builds every active business's decision
 * prompt from a brain copy and fails on a word the brains hold only inside a private span, or on a
 * personal mail address. Placeholders only: no real name or address is in this repo.
 *   - a clean pair of brains passes with every business checked;
 *   - a personal address left unmarked in a ruling is a leak (exit 1), named by heading only;
 *   - a private word reaching a prompt is a leak; a word also written in public is not private;
 *   - it fails closed (exit 2) on a missing copy, no private span at all, rulings not read, an empty
 *     roster or no active business;
 *   - one prompt per ACTIVE business, however many: pausing one never breaks the check.
 * The same check (promptLeak) runs inside every Monday cycle: tests/boss/growthDirector.test.ts.
 */
import { describe, expect, it } from "vitest";
import { checkPrompts } from "../scripts/ops/growth-privacy.mjs";
import { leaksIn, privateOnlyTerms, promptLeak } from "../src/shared/boss/growth/privacy.mjs";

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

  it("fails closed: a missing copy, no private span, rulings not read, an empty roster or nothing active is exit 2", () => {
    expect(checkPrompts({ spry: spry(), "porch-and-party": null }, OPTS).stop).toMatch(/NAMED STOP \[BRAIN_COPY_MISSING\]/);
    expect(checkPrompts({ spry: "", "porch-and-party": PNP }, OPTS).exit).toBe(2);
    const unmarked = (s: string) => s.replace(/<!--\s*\/?confidential\s*-->/g, "");
    const none = checkPrompts({ spry: unmarked(spry()), "porch-and-party": unmarked(PNP) }, OPTS);
    expect(none.exit).toBe(2);
    expect(none.stop).toMatch(/NO_PRIVATE_TERMS/);
    const noSettled = checkPrompts({ spry: spry().replace("## Settled decisions", "## Scratch"), "porch-and-party": PNP }, OPTS);
    expect(noSettled.stop).toMatch(/RULINGS_NOT_READ/);
    const empty = checkPrompts({ spry: spry().replace(/\n## Growth\n[\s\S]*$/, "\n## Growth\nNothing yet.\n"), "porch-and-party": PNP }, OPTS);
    expect(empty.exit).toBe(2);
    expect(empty.stop).toMatch(/NAMED STOP \[ROSTER_EMPTY\] the spry brain/);
    const pause = (md: string) => md.replace(/(- channels: [^\n]*\n)/g, "$1- paused: for the winter\n");
    const idle = checkPrompts({ spry: pause(spry()), "porch-and-party": pause(PNP) }, OPTS);
    expect(idle.exit).toBe(2);
    expect(idle.stop).toMatch(/NAMED STOP \[NO_ACTIVE_BUSINESS\]/);
  });

  it("the prompt count is the active roster's: pausing a business, or a smaller roster, still passes", () => {
    const paused = spry().replace("- key: dream-wedding\n", "- key: dream-wedding\n- paused: off-season\n");
    const r = checkPrompts({ spry: paused, "porch-and-party": PNP }, OPTS);
    expect(r.stop).toBeNull();
    expect(r.exit).toBe(0);
    expect(r.prompts).toBe(5);
    expect(r.rows.map((x) => x.business)).not.toContain("Dream Wedding");
    const small = checkPrompts({ spry: spry(SPRY_LABELS.slice(0, 2)), "porch-and-party": PNP }, OPTS);
    expect(small.exit).toBe(0);
    expect(small.prompts).toBe(3);
  });
});

describe("promptLeak, the check the Monday cycle runs on each prompt before its model call", () => {
  const terms = { names: ["zephyrine"], mails: ["zz.placeholder@gmail.com"] };
  const msg = (t: string) => ({ messages: [{ role: "user", content: t }], left: [] as string[] });
  const bare = msg("Business: KeepMyProof\nTHE PLAYBOOK");
  const rulings = (body: string) => ({ own: [{ heading: "KeepMyProof", body }], shared: [{ heading: "Brand and social", body: "Calm voice." }] });

  it("a span-only word that reached a ruling (a cut that missed) is a leak, named by its heading", () => {
    const r = rulings("Plan for Zephyrine.");
    const hit = promptLeak({ fit: msg(`${bare.messages[0]!.content}\nPlan for Zephyrine.\nCalm voice.`), bare, rulings: r, terms });
    expect(hit).toEqual({ unread: false, private: 1, mail: 0, where: ["KeepMyProof"] });
  });

  it("a personal address, marked or not, is a leak; a clean prompt is not", () => {
    const hit = promptLeak({ fit: msg("x someone.else@gmail.com"), bare, rulings: rulings("from someone.else@gmail.com"), terms });
    expect(hit.mail).toBe(1);
    expect(hit.where).toEqual(["KeepMyProof"]);
    expect(promptLeak({ fit: msg("Calm voice."), bare, rulings: rulings("Calm."), terms })).toEqual({ unread: false, private: 0, mail: 0, where: [] });
  });

  it("a personal address ends at the provider's own domain; a brand host that starts with a provider word is not one", () => {
    const none = { names: [], mails: [] };
    for (const t of ["write to zz.placeholder@gmail.com.", "zz@yahoo.co.uk", "(zz@outlook.com)", "zz@me.com, then", "ZZ@ICLOUD.COM"]) expect(leaksIn(t, none).mail, t).toBe(1);
    for (const t of ["hello@live.brand.com", "x@mac.brand.co", "team@me.brandname.io", "help@gmail.company.org", "support@keepmyproof.com"]) expect(leaksIn(t, none).mail, t).toBe(0);
  });

  it("no private word known, or a failed read, is unread, never clean", () => {
    for (const t of [{ names: [], mails: [] }, null]) expect(promptLeak({ fit: msg("Calm."), bare, rulings: rulings("Calm."), terms: t }).unread).toBe(true);
  });

  it("a shared group left out for size is not named", () => {
    const r = { own: [], shared: [{ heading: "Brand and social", body: "from someone.else@gmail.com" }] };
    expect(promptLeak({ fit: { ...msg("Calm."), left: ["Brand and social"] }, bare, rulings: r, terms }).where).toEqual([]);
  });
});
