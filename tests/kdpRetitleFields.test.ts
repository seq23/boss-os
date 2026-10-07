import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs ops script, no types
import { FIELD_SELECTORS, FIELD_LABELS, AI_ANSWERS, aiAnswersOk } from "../scripts/ops/kdp-retitle.mjs";

/**
 * KDP RETITLE FINDS THE KINDLE eBOOK FIELDS BY NAME (confirmed in the live page, 7 Oct 2026).
 *
 * 27 Sep the script guessed `#data-title` / `#data-subtitle`; the live Kindle eBook details page has
 * neither. Its inputs are `input[name="data[title]"]` and `input[name="data[subtitle]"]`. These pin
 * the order against a fixture of that page, so a reorder or a lost name selector fails here rather
 * than in Simone's run, which is where the owner got asked to do the edit by hand last time.
 */

type Input = Record<string, string>;
const inputsOf = (html: string): Input[] =>
  [...html.matchAll(/<input\b([^>]*)>/g)].map((m) =>
    Object.fromEntries([...m[1]!.matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1]!, a[2]!])),
  );

/** The three selector forms FIELD_SELECTORS uses, matched the way a browser would. */
function matches(sel: string, el: Input): boolean {
  let m: RegExpExecArray | null;
  if ((m = /^#([\w-]+)$/.exec(sel))) return el.id === m[1];
  if ((m = /^input\[name="([^"]+)"\]$/.exec(sel))) return el.name === m[1];
  if ((m = /^input\[id\*="([^"]+)"\]$/.exec(sel))) return (el.id ?? "").includes(m[1]!);
  throw new Error(`selector form the fixture matcher does not know: ${sel}`);
}
const firstHit = (which: "title" | "subtitle", inputs: Input[]) =>
  (FIELD_SELECTORS[which] as string[]).find((s) => inputs.some((el) => matches(s, el))) ?? null;

const kindle = inputsOf(readFileSync(new URL("./fixtures/kdp/kindle-ebook-details.html", import.meta.url), "utf8"));

describe("kdp:retitle finds the Kindle eBook title and subtitle by name", () => {
  it("tries the confirmed name selectors FIRST", () => {
    expect(FIELD_SELECTORS.title[0]).toBe('input[name="data[title]"]');
    expect(FIELD_SELECTORS.subtitle[0]).toBe('input[name="data[subtitle]"]');
  });

  it("resolves both fields on the live page's shape, by name, to type=text inputs", () => {
    expect(kindle.length).toBeGreaterThan(0);
    expect(firstHit("title", kindle)).toBe('input[name="data[title]"]');
    expect(firstHit("subtitle", kindle)).toBe('input[name="data[subtitle]"]');
    for (const name of ["data[title]", "data[subtitle]"]) {
      expect(kindle.find((el) => el.name === name)!.type).toBe("text");
    }
  });

  it("the live page has no data-title / data-subtitle — the old guess matches nothing there", () => {
    for (const el of kindle) {
      expect(el.id ?? "").not.toMatch(/^data-(sub)?title$/);
      expect(Object.keys(el)).not.toContain("data-title");
      expect(Object.keys(el)).not.toContain("data-subtitle");
    }
    expect(kindle.some((el) => matches("#data-title", el) || matches("#data-subtitle", el))).toBe(false);
  });

  it("does not mistake the series title for the title", () => {
    const hit = firstHit("title", kindle)!;
    expect(kindle.filter((el) => matches(hit, el)).map((el) => el.name)).toEqual(["data[title]"]);
  });

  it("keeps the fallbacks: a print-book page by its ids, then the visible label", () => {
    const print = [{ type: "text", id: "data-print-book-title", name: "data[print_book][title]" }, { type: "text", id: "data-print-book-subtitle", name: "data[print_book][subtitle]" }];
    expect(firstHit("title", print)).toBe('input[name="data[print_book][title]"]');
    expect(firstHit("subtitle", print)).toBe('input[name="data[print_book][subtitle]"]');
    expect(firstHit("title", [{ type: "text", name: "renamed" }])).toBeNull();
    expect(FIELD_LABELS.title.test("Book Title")).toBe(true);
    expect(FIELD_LABELS.subtitle.test("Subtitle (Optional)")).toBe(true);
  });

  it("publishes only over the AI answers she filed: Entire work, with extensive editing / None / None", () => {
    expect(AI_ANSWERS).toEqual(["Entire work, with extensive editing", "None", "None"]);
    expect(aiAnswersOk(["English", "Entire work, with extensive editing", "None", "None", "No"])).toBe(true);
    expect(aiAnswersOk(["Entire work, with minimal or no editing", "None", "None"])).toBe(false);
    expect(aiAnswersOk(["Entire work, with extensive editing", "Some", "None"])).toBe(false);
    expect(aiAnswersOk([])).toBe(false);
  });
});
