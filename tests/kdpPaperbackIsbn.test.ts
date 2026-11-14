import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs ops script, no types
import { isbnSection } from "../scripts/ops/kdp-paperback.mjs";

/**
 * THE PAPERBACK RUN WAITS FOR KDP'S CONTENT STEP TO DRAW (9 Nov 2026).
 *
 * parallel-parenting stopped CONTROL_NOT_FOUND: the URL had moved to /content, the page showed only
 * KDP's spinner, and the run looked for "Get a free KDP ISBN" at once. A fake page whose ISBN section
 * appears only after a few waits stands in for that spinner.
 */
const fakePage = (opts: { drawsAfter: number; assigned?: boolean }) => {
  let waits = 0;
  const drawn = () => waits >= opts.drawsAfter;
  const loc = (present: () => boolean) => ({
    count: async () => (present() ? 1 : 0),
    first: () => ({ isVisible: async () => present() }),
  });
  return {
    getByText: (re: RegExp) =>
      loc(() => drawn() && (/97\[89\]/.test(re.source) ? Boolean(opts.assigned) : !opts.assigned && re.test("Get a free KDP ISBN"))),
    getByLabel: (re: RegExp) => loc(() => drawn() && !opts.assigned && re.test("Get a free KDP ISBN")),
    waitForTimeout: async () => { waits += 1; },
    get waits() { return waits; },
  };
};

describe("isbnSection — the paperback content step", () => {
  it("waits through the spinner and then finds the free ISBN choice", async () => {
    const page = fakePage({ drawsAfter: 3 });
    expect(await isbnSection(page, { timeout: 60_000, every: 0 })).toBe("free");
    expect(page.waits).toBe(3);
  });
  it("a resumed draft with its ISBN already assigned needs nothing", async () => {
    expect(await isbnSection(fakePage({ drawsAfter: 2, assigned: true }), { timeout: 60_000, every: 0 })).toBe("assigned");
  });
  it("a page that never draws gives null, so the caller stops CONTROL_NOT_FOUND", async () => {
    expect(await isbnSection(fakePage({ drawsAfter: Infinity }), { timeout: 5, every: 0 })).toBeNull();
  });
});
