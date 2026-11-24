import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * KDP:RETITLE STOPS BEFORE IT TYPES ANYTHING WHEN THE PAGE IS NOT THE BOOK, NOT SIGNED IN, OR LOCKED.
 *
 * 24 Nov 2026: she renamed her two Ambitious Grads guides. One is Live, and Amazon locks a published
 * eBook's title and subtitle (KDP help G200736410: "After publishing your book, certain book details are
 * locked and can't be changed."). The real run (`cli`) is driven here against a fake KDP page built from
 * the saved fixtures, so each stop is proven on the path Simone runs, not on a helper alone:
 *   - signed out → `reauth_required`, never `live`
 *   - the page reads another book than the register → `title_mismatch`, nothing typed
 *   - a Live eBook (hidden title inputs, as Amazon serves them) → `locked_after_publish`, nothing typed
 *   - Amazon's page does not load → `failed`, exit 1
 *   - an editable draft still reaches `dry_run` (the lock check does not refuse every book)
 * and on every stop the only page opened is the book's details page: never Content (the manuscript
 * and cover) or Pricing, and no Save is pressed.
 */
const onlyDetails = () => {
  expect(world.visited.length).toBeGreaterThan(0);
  for (const u of world.visited) expect(u).toMatch(/\/title-setup\/kindle\/[A-Z0-9]+\/details$/);
  expect(world.clicks).toEqual([]);
};

type El = { name: string; id?: string; type: string; value: string };
const inputsOf = (html: string): El[] =>
  [...html.matchAll(/<input\b([^>]*)>/g)]
    .map((m) => Object.fromEntries([...m[1]!.matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1]!, a[2]!])))
    .filter((a) => a.name) as El[];
const fixture = (f: string) => inputsOf(readFileSync(new URL(`./fixtures/kdp/${f}`, import.meta.url), "utf8"));

const world = { inputs: [] as El[], landAt: null as string | null, gotoThrows: false, typed: [] as string[], clicks: [] as string[], visited: [] as string[] };

function locatorFor(sel: string) {
  const byName = /^input\[name="([^"]+)"\]$/.exec(sel)?.[1];
  const byId = /^#([\w-]+)$/.exec(sel)?.[1];
  const el = world.inputs.find((e) => (byName && e.name === byName) || (byId && e.id === byId)) ?? null;
  return {
    count: async () => (el ? 1 : 0),
    inputValue: async () => el!.value,
    evaluate: async (fn: (x: unknown) => unknown) => fn({ ...el, disabled: false, readOnly: false }),
    click: async () => { world.clicks.push(sel); },
  };
}
const page = {
  _url: "",
  goto: async (u: string) => { world.visited.push(u); if (world.gotoThrows) throw new Error("net::ERR_INTERNET_DISCONNECTED"); page._url = world.landAt ?? u; },
  waitForTimeout: async () => {},
  url: () => page._url,
  locator: (sel: string) => ({ first: () => locatorFor(sel), count: async () => 0 }),
  getByLabel: () => ({ first: () => ({ count: async () => 0 }) }),
  evaluate: async () => "",
  keyboard: { press: async (k: string) => { world.typed.push(k); }, type: async (t: string) => { world.typed.push(t); } },
};
vi.mock("../scripts/ops/browser.mjs", () => ({
  openProfile: async () => ({ context: { pages: () => [page], newPage: async () => page, close: async () => {} } }),
}));

const REF = "A2C99P6JESFOP0";
async function retitle(registerTitle: string, extra: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), "retitle-"));
  const reg = join(dir, "register.json");
  writeFileSync(reg, JSON.stringify({ titles: [{ title_ref: REF, title: registerTitle, author: "S. Taylor" }] }));
  process.env.BOSS_OS_KDP_REGISTER = reg;
  process.argv = ["node", "kdp-retitle.mjs", "--ref", REF, "--subtitle", "Templates to Challenge a Report Error", ...extra];
  vi.resetModules();
  const logs: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((m: string) => { logs.push(String(m)); });
  // @ts-expect-error — plain .mjs ops script, no types
  const { cli } = await import("../scripts/ops/kdp-retitle.mjs");
  await cli();
  spy.mockRestore();
  const lines = logs.filter((l) => l.startsWith("RETITLE:"));
  expect(lines).toHaveLength(1);
  return { line: lines[0]!, code: process.exitCode };
}

const argv = process.argv;
beforeEach(() => { Object.assign(world, { inputs: [], landAt: null, gotoThrows: false, typed: [], clicks: [], visited: [] }); process.exitCode = 0; });
afterEach(() => { process.argv = argv; process.exitCode = 0; delete process.env.BOSS_OS_KDP_REGISTER; });

describe("kdp:retitle stops before typing", () => {
  it("signed out: reauth_required, never live, nothing typed", async () => {
    world.inputs = fixture("kindle-ebook-details-live.html");
    world.landAt = "https://www.amazon.com/ap/signin?max_auth_age=0";
    const r = await retitle("The Credit Dispute Letter");
    expect(r.line).toMatch(/^RETITLE: reauth_required/);
    expect(r.code).not.toBe(0);
    expect(world.typed).toEqual([]);
    onlyDetails();
  });

  it("Amazon's page does not load: failed, exit 1, never live", async () => {
    world.gotoThrows = true;
    const r = await retitle("The Credit Dispute Letter");
    expect(r.line).toMatch(/^RETITLE: failed/);
    expect(r.line).not.toMatch(/live|in_review/);
    expect(r.code).toBe(1);
  });

  it("the page's title is not the register's: title_mismatch, nothing typed or clicked", async () => {
    world.inputs = fixture("kindle-ebook-details.html"); // a draft reading "The Gift Letter"
    const r = await retitle("The Ultimate Guide to Wall Street");
    expect(r.line).toMatch(/^RETITLE: title_mismatch/);
    expect(r.code).toBe(9);
    expect(world.typed).toEqual([]);
    onlyDetails();
    expect(world.clicks).toEqual([]);
  });

  it("a Live eBook (Amazon serves its title and subtitle as hidden inputs): locked_after_publish, nothing typed", async () => {
    world.inputs = fixture("kindle-ebook-details-live.html");
    expect(world.inputs.map((e) => e.type)).toEqual(["hidden", "hidden"]);
    const r = await retitle("The Credit Dispute Letter");
    expect(r.line).toMatch(/^RETITLE: locked_after_publish/);
    expect(r.line).toContain("new edition");
    expect(r.code).toBe(16);
    expect(world.typed).toEqual([]);
    onlyDetails();
    expect(world.clicks).toEqual([]);
  });

  it("an editable draft still gets through to the dry run (the lock refuses only locked fields)", async () => {
    world.inputs = fixture("kindle-ebook-details.html");
    const r = await retitle("The Gift Letter", ["--dry-run"]);
    expect(r.line).toMatch(/^RETITLE: dry_run/);
    expect(r.code).toBe(0);
    expect(world.typed).toEqual([]);
    onlyDetails();
  });
});
