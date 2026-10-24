/** "Use OpenAI first for everything" (owner, 24 Oct 2026): the one place seats are ordered. */
import { describe, expect, it } from "vitest";
import { orderSeats, isOn } from "../src/worker/boss/duties/seatOrder";

describe("orderSeats", () => {
  it("off: every ladder stays exactly as the duty wrote it", () => {
    expect(orderSeats(["bk_claude_code", "bk_codex"], false)).toEqual(["bk_claude_code", "bk_codex"]);
    expect(orderSeats(["bk_claude_code"], false)).toEqual(["bk_claude_code"]);
  });
  it("on: OpenAI's seat goes before Claude's, added when the ladder had only Claude; nothing else moves", () => {
    expect(orderSeats(["bk_claude_code", "bk_codex"], true)).toEqual(["bk_codex", "bk_claude_code"]);
    expect(orderSeats(["bk_claude_code"], true)).toEqual(["bk_codex", "bk_claude_code"]);
    expect(orderSeats(["bk_codex", "bk_claude_code"], true)).toEqual(["bk_codex", "bk_claude_code"]);
    expect(orderSeats(["bk_workers_ai"], true)).toEqual(["bk_workers_ai"]);
    expect(orderSeats([], true)).toEqual([]);
  });
  it("reads the setting's words", () => {
    expect([isOn("on"), isOn("true"), isOn("off"), isOn(null)]).toEqual([true, true, false, false]);
  });
});
