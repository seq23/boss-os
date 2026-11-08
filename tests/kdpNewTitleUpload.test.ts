import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
// @ts-expect-error — plain .mjs ops script, no types
import { uploadStatus, categoryStep } from "../scripts/ops/kdp-new-title.mjs";

/**
 * KDP NEW TITLE READS THE CONTENT STEP THE WAY AMAZON SHOWS IT (7 Nov 2026).
 *
 * "The Co-Parenting Log" stopped UPLOAD_NOT_CONFIRMED: the run waited on the FIRST element saying
 * "Cover uploaded successfully" to become visible. Amazon's pages (AUI) keep status messages in the
 * DOM, hidden with `aok-hidden` until they apply, so a hidden copy earlier in the page never shows.
 * These fixtures are that page shape: only a SHOWN confirmation (or the new cover thumbnail) is
 * success, a shown error is a refusal, and the manuscript's message is never taken for the cover's.
 * The category step is the same page family: names match loosely and a leaf may be a tick box.
 */

const doc = (body: string) => {
  const w = new Window();
  w.document.body.innerHTML = body;
  return w.document as unknown as Document;
};
const INPUT = "#data-assets-cover-file-upload-AjaxInput";

const coverSection = (state: { creatorCopy?: boolean; ok?: boolean; err?: string; thumb?: string; busy?: boolean }) => `
  <div id="interior-section"><h3>Manuscript</h3>
    <div class="a-alert a-alert-success"><div class="a-alert-content">Manuscript "book.epub" uploaded successfully!</div></div>
  </div>
  <div id="cover-section"><h3>Kindle eBook Cover</h3>
    <div id="cover-creator-panel" class="aok-hidden">
      <div class="a-alert a-alert-success"><div class="a-alert-content">Cover uploaded successfully!</div></div>
    </div>
    <div id="cover-upload-panel">
      <input type="file" id="data-assets-cover-file-upload-AjaxInput">
      <img src="https://m.media-amazon.com/images/G/01/kdp/grey-pixel.gif" alt="">
      ${state.thumb ? `<img src="${state.thumb}" alt="cover">` : ""}
      <div class="a-alert a-alert-success${state.ok ? "" : " aok-hidden"}"><div class="a-alert-content">Cover uploaded successfully!</div></div>
      <div class="a-alert a-alert-error${state.err ? "" : " aok-hidden"}"><div class="a-alert-content">${state.err ?? "We could not process your cover."}</div></div>
      <span class="${state.busy ? "" : "aok-hidden"}">Uploading…</span>
    </div>
  </div>`;
const before = ["https://m.media-amazon.com/images/G/01/kdp/grey-pixel.gif"];

describe("uploadStatus — the cover upload on KDP's content step", () => {
  it("before Amazon answers: every confirmation is still hidden, so it waits", () => {
    expect(uploadStatus(doc(coverSection({})), "cover", INPUT, before).state).toBe("waiting");
  });
  it("Amazon's shown confirmation counts even though a hidden copy comes first in the page", () => {
    const r = uploadStatus(doc(coverSection({ ok: true })), "cover", INPUT, before);
    expect(r).toMatchObject({ state: "done", via: "message" });
    expect(r.text).toMatch(/Cover uploaded successfully/);
  });
  it("the new cover thumbnail alone counts as accepted", () => {
    expect(uploadStatus(doc(coverSection({ thumb: "https://kdp.amazon.com/thumb/abc.jpg" })), "cover", INPUT, before)).toMatchObject({ state: "done", via: "thumbnail" });
  });
  it("while Amazon says Uploading, a thumbnail is not yet success", () => {
    expect(uploadStatus(doc(coverSection({ busy: true, thumb: "https://kdp.amazon.com/thumb/abc.jpg" })), "cover", INPUT, before).state).toBe("working");
  });
  it("a shown error is Amazon's refusal, in Amazon's words", () => {
    const r = uploadStatus(doc(coverSection({ err: "Your cover image is too small." })), "cover", INPUT, before);
    expect(r).toMatchObject({ state: "refused" });
    expect(r.text).toContain("too small");
  });
  it("the manuscript's shown confirmation is never taken for the cover's", () => {
    expect(uploadStatus(doc(coverSection({})), "manuscript", INPUT, before).state).toBe("done");
    expect(uploadStatus(doc(coverSection({})), "cover", INPUT, before).state).toBe("waiting");
  });
});

describe("categoryStep — KDP's Kindle category chooser", () => {
  const modal = () =>
    doc(`<div class="a-popover" aria-hidden="false" id="m">
      <span class="a-dropdown-container"><select class="a-native-dropdown" id="cat">
        <option value="">Select one</option><option value="FAM">Family &amp; Relationships</option></select></span>
      <span class="a-dropdown-container"><select class="a-native-dropdown" id="sub">
        <option value="">Select one</option><option value="PAR">Parenting</option></select></span>
      <div class="aok-hidden"><label><input type="checkbox" id="h"><span>Divorce &amp; Separation</span></label></div>
      <label><input type="checkbox" id="div"><i class="a-icon a-icon-checkbox"></i><span class="a-label"> Divorce and Separation </span></label>
      <input type="checkbox" id="sp"><label for="sp">Single Parent</label>
    </div>`).getElementById("m")!;

  it("picks the dropdown option by name, '&' and 'and' alike", () => {
    const m = modal();
    expect(categoryStep(m, "Family & Relationships").did).toBe("selected");
    expect((m.querySelector("#cat") as unknown as HTMLSelectElement).value).toBe("FAM");
    expect(categoryStep(m, "Family & Relationships").did).toBe("already");
  });
  it("ticks a leaf that is a tick box (a two-level path), skipping hidden copies", () => {
    const m = modal();
    expect(categoryStep(m, "Divorce & Separation").did).toBe("ticked");
    expect((m.querySelector("#div") as unknown as HTMLInputElement).checked).toBe(true);
    expect((m.querySelector("#h") as unknown as HTMLInputElement).checked).toBe(false);
  });
  it("finds a tick box by its label[for] and names what it saw when a name is missing", () => {
    const m = modal();
    expect(categoryStep(m, "Single Parent").did).toBe("ticked");
    const miss = categoryStep(m, "Blended Families");
    expect(miss.did).toBe("missing");
    expect(miss.seen).toContain("Parenting");
  });
});
