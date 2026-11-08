import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
// @ts-expect-error — plain .mjs ops script, no types
import { aiState, aiAnswers } from "../scripts/ops/kdp-new-title.mjs";

/**
 * KDP NEW TITLE READS AMAZON'S AI QUESTION AS AMAZON DRAWS IT (8 Nov 2026).
 *
 * "The Co-Parenting Log" stopped AI_DISCLOSURE_NOT_FOUND "no Yes answer": the run looked for
 * radio INPUTS, but KDP draws Yes/No as an AUI accordion (role="radio" divs with aria-checked)
 * and each answer as a native <select> labelled generative-ai-questionnaire-<key>-label.
 * The images list has no "Entire work…" option, so the default must be one KDP offers.
 */
const TEXT = ["Select", "None", "Some sections, with minimal or no editing", "Some sections, with extensive editing", "Entire work, with minimal or no editing", "Entire work, with extensive editing"];
const IMAGES = ["Select", "None", "One or a few AI-generated images, with minimal or no editing", "One or a few AI-generated images, with extensive editing", "Many AI-generated images, with minimal or no editing", "Many AI-generated images, with extensive editing"];
const sel = (key: string, opts: string[], pick = 0) =>
  `<span aria-labelledby="generative-ai-questionnaire-${key}-label" class="a-dropdown-container"><select>${opts.map((o, i) => `<option${i === pick ? " selected" : ""}>${o}</option>`).join("")}</select></span>`;
const page = (yes: boolean, picks: [number, number, number] = [0, 0, 0], tool = "") => {
  const w = new Window();
  w.document.body.innerHTML = `
  <div class="a-row"><span id="generative-ai-questionnaire-question">Did you use AI tools in creating texts, images, and/or translations in your book?</span></div>
  <div aria-labelledby="generative-ai-questionnaire-question" data-a-accordion-name="generative-ai-questionnaire-accordion" class="a-box-group a-accordion">
    <div class="a-box" data-a-accordion-row-name="yes"><div class="a-box-inner"><div class="a-accordion-row-a11y" role="radio" aria-checked="${yes}"><a class="a-accordion-row" href="#"><i class="a-icon a-accordion-radio ${yes ? "a-icon-radio-active" : "a-icon-radio-inactive"}"></i><h5>Yes</h5></a></div>
      <div class="a-accordion-inner">${sel("text", TEXT, picks[0])}<input placeholder="e.g. ChatGPT" value="${tool}">${sel("images", IMAGES, picks[1])}<input placeholder="e.g. DALL-E">${sel("translations", TEXT, picks[2])}</div></div></div>
    <div class="a-box" data-a-accordion-row-name="no"><div class="a-box-inner"><div class="a-accordion-row-a11y" role="radio" aria-checked="false"><a class="a-accordion-row" href="#"><h5>No</h5></a></div></div></div>
  </div>
  <input type="radio" name="data[accessibility][image_reading]" value="unknown" checked>`;
  w.document.querySelectorAll("select").forEach((s, i) => { (s as unknown as HTMLSelectElement).selectedIndex = picks[i] ?? 0; });
  return w.document as unknown as Document;
};

describe("KDP AI question (accordion, not radio inputs)", () => {
  it("finds the question though it has no radio inputs of its own, and reads Yes from aria-checked", () => {
    expect(aiState(page(false))).toMatchObject({ found: true, yes: false });
    expect(aiState(page(true))).toMatchObject({ found: true, yes: true });
  });
  it("reads each answer from its labelled select, blank while on Select", () => {
    expect(aiState(page(true)).selects).toEqual({ text: "", images: "", translations: "" });
    const st = aiState(page(true, [3, 2, 1], "Claude"));
    expect(st.selects).toEqual({ text: "Some sections, with extensive editing", images: "One or a few AI-generated images, with minimal or no editing", translations: "None" });
    expect(st.tools).toEqual({ text: "Claude", images: "" });
  });
  it("reports not found on a page without the question", () => {
    const w = new Window();
    w.document.body.innerHTML = `<input type="radio" name="x"><span>Did you use AI tools?</span>`;
    expect(aiState(w.document as unknown as Document).found).toBe(false);
  });
  it("every default answer is one KDP actually offers", () => {
    const a = aiAnswers({ ai_disclosure: { text: "ai_generated", images: "ai_generated" } });
    expect(TEXT).toContain(a.texts);
    expect(IMAGES).toContain(a.images);
    expect(TEXT).toContain(a.translations);
  });
});
