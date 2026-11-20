/**
 * Her plain-word commands (morning email, LP nudge, duty drafts): the first read decides, and the keyword last resort
 * fires only on a sentence that stands (19 Nov 2026). Every phrasing below is one a keyword used to act on.
 */
import { describe, expect, it } from "vitest";
import { commandOf, commandsFromRead, morningCommands } from "../../src/shared/boss/mail/morningReply.mjs";
import { judgedNudgeAddressesIn } from "../../src/worker/boss/lp/nudge";
import { readDutyReply } from "../../src/shared/boss/duties/lane.mjs";

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
    ])).toEqual([
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
