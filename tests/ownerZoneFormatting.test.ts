import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { inOwnerZone, dayInOwnerZone } from "../src/shared/boss/timezone";

/**
 * THE SPIRIT SCREEN WENT DOWN IN PRODUCTION FOR THIS, on 13 September 2026.
 *
 * `Intl.DateTimeFormat` THROWS — `TypeError: Invalid option : option` — when a style shortcut
 * (`dateStyle`/`timeStyle`) is combined with any individual component (`weekday`, `hour`, …).
 * `inOwnerZone` supplied both styles as defaults and spread the caller's options over them, so the
 * first caller to ask for components collided with the defaults and the whole page rendered
 * "The Spirit screen could not be drawn."
 *
 * THE PART WORTH REMEMBERING: `/api/boss/spirit/day` returned 200 with correct data throughout.
 * The endpoint was verified and the RENDER was not, so every check passed while the screen was
 * blank. A formatter is not exercised by testing the thing that feeds it.
 *
 * So this test does not assert on the helper in the abstract. It SCRAPES EVERY `inOwnerZone(...)`
 * CALL OUT OF THE CLIENT and runs each option literal, which is the only version of this test that
 * would have caught it.
 */
const CLIENT = join(__dirname, "../src/client/boss");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return name.endsWith(".tsx") || name.endsWith(".ts") ? [full] : [];
  });
}

/** Every `inOwnerZone(x, { … })` option literal written anywhere in the client. */
function optionLiteralsInClient(): { file: string; literal: string }[] {
  const out: { file: string; literal: string }[] = [];
  for (const file of tsxFiles(CLIENT)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/inOwnerZone\([^,)]+,\s*(\{[^}]*\})/g)) {
      out.push({ file: file.replace(CLIENT, "client"), literal: m[1] ?? "" });
    }
  }
  return out;
}

const TS = 1789309662644; // the void-of-course start that was on screen when it broke

describe("owner-zone formatting", () => {
  it("EVERY inOwnerZone option literal in the client actually formats", () => {
    const calls = optionLiteralsInClient();

    // Rule 0: if the scrape finds nothing, it proved nothing — the call sites were renamed or
    // moved, and this test would otherwise pass over an empty list for ever.
    expect(calls.length).toBeGreaterThan(0);

    const broken: string[] = [];
    for (const { file, literal } of calls) {
      let opts: Intl.DateTimeFormatOptions;
      try {
        // eslint-disable-next-line no-eval
        opts = eval(`(${literal})`) as Intl.DateTimeFormatOptions;
      } catch {
        continue; // not a static literal; nothing to check
      }
      try {
        const rendered = inOwnerZone(TS, opts);
        expect(rendered).not.toBe("");
      } catch (e) {
        broken.push(`${file}: inOwnerZone(ts, ${literal}) threw ${(e as Error).message}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("a style shortcut and components together do not throw", () => {
    // The exact collision. Before the fix this threw TypeError: Invalid option : option.
    expect(() =>
      inOwnerZone(TS, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }),
    ).not.toThrow();
    expect(inOwnerZone(TS, { weekday: "long", month: "long", day: "numeric" })).toMatch(/Sunday/);
  });

  it("the defaults still apply when the caller asks for nothing", () => {
    expect(inOwnerZone(TS)).toMatch(/\d{4}/);
    expect(inOwnerZone(TS)).toMatch(/(AM|PM)/);
  });

  it("date-only still drops the time, and a missing instant is not a crash", () => {
    expect(dayInOwnerZone(TS)).not.toMatch(/(AM|PM)/);
    expect(inOwnerZone(null)).toBe("—");
    expect(inOwnerZone(undefined)).toBe("—");
    expect(inOwnerZone(Number.NaN)).toBe("—");
  });
});
