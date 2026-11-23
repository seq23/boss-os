import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
// @ts-expect-error — plain .mjs ops script, no types
import { seriesDialogStep, seriesPick } from "../scripts/ops/kdp-new-title.mjs";

/**
 * THE SERIES PICKER READS KDP'S REAL MODAL (23 Nov 2026).
 *
 * "How to Get a Job in Tech" stopped SERIES_NOT_FOUND although "Ambitious Grads" exists: KDP's
 * "Add title to a series" modal opens on a two-choice step (New series / Existing series), the
 * press on "Select series" did not take, and the run looked for the list without checking it had
 * opened. The fixtures are that modal, captured live from the publisher profile the same morning:
 * the choice step, the unsearched list (5 of 6 series, Ambitious Grads 4th) and the searched list.
 */

const FIX = join(__dirname, "fixtures/kdp");
const load = (name: string) => {
  const w = new Window();
  w.document.body.innerHTML = readFileSync(join(FIX, name), "utf8");
  return w.document as unknown as Document;
};
const AG = "TECK77YY8MZ";

describe("which step the series modal is on", () => {
  it("the choice step is read as the choice step, never as the list", () => {
    expect(seriesDialogStep(load("series-choice.html"))).toBe("choice");
  });
  it("both list views are the list; an empty page is neither", () => {
    expect(seriesDialogStep(load("series-list.html"))).toBe("list");
    expect(seriesDialogStep(load("series-list-searched.html"))).toBe("list");
    expect(seriesDialogStep(new Window().document as unknown as Document)).toBe("none");
  });
});

describe("the series is picked by its exact name", () => {
  it("in the full list, Ambitious Grads is found by name though it is not the first row", () => {
    const r = seriesPick(load("series-list.html"), "Ambitious Grads");
    expect(r).toMatchObject({ id: AG, ambiguous: false });
    expect(r.seen.length).toBe(5);
    expect(r.seen[0]).not.toBe("ambitious grads");
  });
  it("in the searched list, the one row with that name", () => {
    expect(seriesPick(load("series-list-searched.html"), "Ambitious Grads").id).toBe(AG);
  });
  it("on the choice step nothing is picked (the list is not open yet)", () => {
    expect(seriesPick(load("series-choice.html"), "Ambitious Grads")).toMatchObject({ id: null, seen: [] });
  });
  it("a name that is only part of a listed name, or one not listed, picks nothing, never the first row", () => {
    const doc = load("series-list.html");
    expect(seriesPick(doc, "Ambitious").id).toBeNull();
    expect(seriesPick(doc, "Ambitious Grads 2").id).toBeNull();
    expect(seriesPick(doc, "KeepMyProof Record Books").id).toBeNull();
  });
  it("a recorded id is never used when its row carries another name", () => {
    expect(seriesPick(load("series-list.html"), "Ambitious Grads 2", AG).id).toBeNull();
  });
  it("two rows with the same name: the recorded id, else none", () => {
    const doc = load("series-list-searched.html");
    const li = doc.querySelector("li")!;
    const twin = li.cloneNode(true) as Element;
    twin.querySelector("[data-test-id]")!.setAttribute("data-test-id", "series-search-result-ZZZTWIN0001");
    li.parentElement!.insertBefore(twin, li);
    expect(seriesPick(doc, "Ambitious Grads")).toMatchObject({ id: null, ambiguous: true });
    expect(seriesPick(doc, "Ambitious Grads", AG).id).toBe(AG);
  });
});
