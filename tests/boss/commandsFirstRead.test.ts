/**
 * Her plain-word commands (morning email, LP nudge, duty drafts): the first read decides, and the keyword last resort
 * fires only on a sentence that stands (19 Nov 2026). Every phrasing below is one a keyword used to act on.
 */
import { describe, expect, it } from "vitest";
import { commandOf, commandsFromRead, morningCommands, withKeywordsTheReadMissed } from "../../src/shared/boss/mail/morningReply.mjs";
import { judgedNudgeAddressesIn } from "../../src/worker/boss/lp/nudge";
import { readDutyReply } from "../../src/shared/boss/duties/lane.mjs";
import { anchoredReading, readReply } from "../../src/shared/boss/repoChange/lane.mjs";
import { readCommentReply } from "../../src/shared/boss/commentWatch/lane.mjs";
import { quoteStands } from "../../src/shared/boss/text/wholeSentence.mjs";

describe("the morning keywords fire only on a line that stands", () => {
  it("a conditioned, asked or reported command is not a command", () => {
    expect(commandOf("drop 2 if he hasn't answered by Friday"), "conditioned").toBeNull();
    expect(commandOf("drop Ron Brooks?"), "asked").toBeNull();
    expect(commandOf("Don't you think we should stop the coaching?"), "asked, not a rule").toBeNull();
    expect(commandOf("grateful for whatever Dana said about the deck"), "reported").toBeNull();
  });
  it("a plain command and a negative rule with its own when still stand", () => {
    expect(commandOf("drop 2")).toEqual({ kind: "drop", number: 2 });
    expect(commandOf("gate done")).toEqual({ kind: "gate" });
    expect(commandOf("never prep maybes when I'm travelling")?.kind).toBe("rule");
    const { commands, rest } = morningCommands("drop 2 if he hasn't answered\ndrop 3");
    expect(commands).toEqual([{ kind: "drop", number: 3 }]);
    expect(rest).toMatch(/if he hasn't answered/);
  });
  it("the first read's commands become the commands, quoting her", () => {
    expect(commandsFromRead([
      { kind: "drop", n: 2, text: "lose the second one" },
      { kind: "drop", n: null, text: "drop Ron Brooks" },
      { kind: "gate", n: null, text: "" },
      { kind: "public", n: null, text: "Example Robotics is public now" },
      { kind: "drop", n: null, text: "it" },
    ], "lose the second one\ndrop Ron Brooks\ngate done\nExample Robotics is public now\nit")).toEqual([
      { kind: "drop", number: 2 },
      { kind: "drop", name: "Ron Brooks" },
      { kind: "gate" },
      { kind: "public", company: "Example Robotics" },
    ]);
  });
});

describe("the nudge keyword sends only on a sentence that stands", () => {
  it("a negated, conditioned, reported or asked nudge names no one", () => {
    expect(judgedNudgeAddressesIn("Don't nudge ann@lp.example yet.")).toEqual([]);
    expect(judgedNudgeAddressesIn("Nudge ann@lp.example if she hasn't replied by Friday.")).toEqual([]);
    expect(judgedNudgeAddressesIn("Robin said to nudge bob@lp.example.")).toEqual([]);
    expect(judgedNudgeAddressesIn("Should I nudge ann@lp.example?")).toEqual([]);
  });
  it("only the standing sentence's address goes", () => {
    expect(judgedNudgeAddressesIn("Please nudge ann@lp.example. Don't nudge bob@lp.example, he wrote back.")).toEqual(["ann@lp.example"]);
  });
});

describe("a duty draft reply: the first read decides approved or held", () => {
  it("her words with the read's reading", () => {
    expect(readDutyReply("sure, set it up", "approved").mode).toBe("approved");
    expect(readDutyReply("approved", "held").mode, "the read heard a hold").toBe("held");
    expect(readDutyReply("changes: daily at 3pm", "held").mode, "her changes: prefix still redrafts").toBe("changes");
    expect(readDutyReply("approved", "preview").mode, "no preview for a draft: the keywords read it").toBe("approved");
  });
});

/* The fresh review of #473 (20 Nov 2026): each reply below is one a live Gemini read got wrong, or one the doors lost. */
describe("the first read's commands pass the same sentence judge", () => {
  it("a conditioned drop the model quoted whole drops nothing (gemini-3.1-flash-lite, live)", () => {
    for (const words of ["drop 3 if Ron hasn't answered by Friday", "drop 2 unless Dana gets back to us today"]) {
      const n = Number(/\d/.exec(words)![0]);
      expect(commandsFromRead([{ kind: "drop", n, text: words }], words), words).toEqual([]);
      expect(commandsFromRead([{ kind: "drop", n, text: `drop ${n}` }], words), `${words}: a short quote is judged in her sentence`).toEqual([]);
    }
  });
  it("\"don't send it\" read as a drop is not a drop", () => {
    expect(commandsFromRead([{ kind: "drop", n: null, text: "don't send it" }], "don't send it")).toEqual([]);
  });
  it("a nudge address the read gave is judged in her sentence", () => {
    expect(quoteStands("Don't nudge ann.lee@lp.example yet.", "ann.lee@lp.example")).toBe(false);
    expect(quoteStands("Please nudge ann.lee@lp.example.", "ann.lee@lp.example")).toBe(true);
  });
});

describe("the comment digest reads every item she names", () => {
  const items = [1, 2, 3].map((n) => ({ n, comment_id: `c${n}`, proposed_action: n === 2 ? "hide" : "reply", proposed_reply: `draft ${n}` }));
  const acts = (r: { instructions: Array<{ n: number; action: string; reply_text: string | null }> }) => r.instructions.map((i) => `${i.n} ${i.action}${i.reply_text ? `:${i.reply_text}` : ""}`);
  it("\"approve 1 and 3, skip 2\" instructs all three, even when the read gave nothing", () => {
    expect(acts(readCommentReply("approve 1 and 3, skip 2", items, []))).toEqual(["1 reply:draft 1", "2 ignore", "3 reply:draft 3"]);
    expect(acts(readCommentReply("approve 1 and 3, skip 2", items, null)), "the keywords alone too").toEqual(["1 reply:draft 1", "2 ignore", "3 reply:draft 3"]);
  });
  it("\"reply to 1 as drafted, delete 2, leave 3\": the read's one item, and her words for the rest", () => {
    const r = readCommentReply("reply to 1 as drafted, delete 2, leave 3", items, [{ kind: "comment", n: 2, action: "hide", text: "delete 2" }]);
    expect(acts(r)).toEqual(["1 reply:draft 1", "2 hide", "3 ignore"]);
    expect(r.unread).toEqual([]);
  });
  it("an item she named that nothing instructs is said back as unread, never dropped", () => {
    const r = readCommentReply("fix 1 somehow, delete 2", items, []);
    expect(acts(r)).toEqual(["2 hide"]);
    expect(r.unread).toContain("1: no instruction read for it");
  });
  it("a conditioned or asked clause instructs nothing", () => {
    const r = readCommentReply("delete 2 if it's spam", items, [{ kind: "comment", n: 2, action: "hide", text: "delete 2" }]);
    expect(r.instructions).toEqual([]);
  });
});

describe("a reading is anchored to her words", () => {
  it("production without a preview needs her force words", () => {
    expect(anchoredReading("forced", "approved, push it straight to prod, skip the preview")).toBe("preview");
    expect(anchoredReading("forced", "approved to production")).toBe("forced");
    // Post-land replay, 20 Nov: a model read these as "preview", which starts work on a plan she held back.
    expect(anchoredReading("preview", "I don't approve this yet, I want to see the copy first.")).toBe("held");
    expect(anchoredReading("preview", "Can you show me the phone version first?")).toBe("held");
    expect(anchoredReading("preview", "preview first")).toBe("preview");
    expect(anchoredReading("preview", "Looks good, send me a preview")).toBe("preview");
    expect(readReply("approved, push it straight to prod", "forced").mode).toBe("preview");
  });
  it("a partial approval is never a full one (Kindle, duty, plan doors)", () => {
    expect(anchoredReading("approved", "approve 1 and 3, skip 2")).toBe("answers");
    expect(anchoredReading("approved", "yes but not the second one")).toBe("answers");
    expect(anchoredReading("approved", "looks good, go ahead")).toBe("approved");
    expect(readDutyReply("approve 1 and 3, skip 2", "approved").mode).not.toBe("approved");
  });
});

describe("live misses of the backstop rung (Workers AI, 20 Nov 2026)", () => {
  const items = [1, 2, 3].map((n) => ({ n, comment_id: `c${n}`, proposed_action: n === 2 ? "hide" : "reply", proposed_reply: `draft ${n}` }));
  it("her plain \"skip 2\" wins over a read of hide", () => {
    const r = readCommentReply("approve 1 and 3, skip 2", items, [{ kind: "comment", n: 2, action: "hide", text: "skip 2" }]);
    expect(r.instructions.map((i) => `${i.n} ${i.action}`)).toEqual(["1 reply", "2 ignore", "3 reply"]);
  });
});

describe("a morning command the read missed", () => {
  it("\"drop 2\" beside \"gate done\" still acts when the read gave only the gate; nothing twice", () => {
    const words = "drop 2\ngate done";
    const fromRead = commandsFromRead([{ kind: "gate", n: null, text: "gate done" }], words);
    expect(withKeywordsTheReadMissed(fromRead, morningCommands(words).commands)).toEqual([{ kind: "gate" }, { kind: "drop", number: 2 }]);
  });
});
