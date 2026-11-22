import { describe, expect, it } from "vitest";
import { transcribeChunk, transcriptionAvailable, TranscriptionUnavailable } from "../src/worker/ai/providers/workersAiWhisper";

/**
 * The Whisper adapter Boss OS intake hears voice notes through (boss/intake/readFiles.ts). Moved here
 * from the retired chassis IC-stage suite on 22 Nov 2026; there is no AI binding under miniflare, so
 * the SHAPE handling is exercised against a stub and the model itself is not.
 */

describe("the transcription adapter, as far as it can honestly be tested offline", () => {
  it("reports itself unavailable with no binding, which is what disables the button", () => {
    expect(transcriptionAvailable(undefined)).toBe(false);
    expect(transcriptionAvailable({ run: async () => ({}) })).toBe(true);
  });

  it("refuses rather than returning empty text when the answer has no words in it", async () => {
    // "The field was missing" and "nobody spoke" have different causes and different fixes.
    // Collapsing them is how a transcript quietly loses a minute of a meeting.
    await expect(transcribeChunk({ run: async () => ({}) }, "AAAA")).rejects.toBeInstanceOf(TranscriptionUnavailable);
  });

  it("reads the shape Workers AI actually answers in", async () => {
    const out = await transcribeChunk({ run: async () => ({ text: "we will send the data room", word_count: 6 }) }, "AAAA");
    expect(out.text).toBe("we will send the data room");
    expect(out.wordCount).toBe(6);
  });

  it("passes the model's own error through unchanged, because that is the readable half", async () => {
    await expect(
      transcribeChunk({ run: async () => { throw new Error("5016 licence not accepted"); } }, "AAAA"),
    ).rejects.toMatchObject({ reason: "5016 licence not accepted" });
  });
});
