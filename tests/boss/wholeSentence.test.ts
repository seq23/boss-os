import { describe, expect, it } from "vitest";
import { sentencesOf, stands, vetoOf } from "../../src/shared/boss/text/wholeSentence.mjs";

/** The one splitter and judge every Boss OS keyword fallback uses (owner ruling, 19 Nov 2026). */
describe("whole sentences", () => {
  it("splits at . ! ? ; and line breaks, never inside an address or a host", () => {
    expect(sentencesOf("Approved. Send it to a@b.com; thanks!\nShip boss.example.com?").map((x) => x.text)).toEqual(["Approved.", "Send it to a@b.com;", "thanks!", "Ship boss.example.com?"]);
  });
  it("a phrase does not stand in a sentence that negates, conditions, reports or asks it", () => {
    expect(vetoOf("I don't think we should approve it", { from: 25, to: 32 })).toBe("NEGATES");
    expect(vetoOf("approve it if the numbers hold", { from: 0, to: 7 })).toBe("CONDITIONS");
    expect(vetoOf("last time she said approve", { from: 19, to: 26 })).toBe("REPORTS");
    expect(vetoOf('the button says "approve"', { from: 17, to: 24 })).toBe("REPORTS");
    expect(vetoOf("approve it?", { from: 0, to: 7 })).toBe("ASKS");
    expect(stands("Thanks. Approve it.", /approve/i)).toBe(true);
    expect(stands("Should I approve it? Not sure.", /approve/i)).toBe(false);
  });
});
