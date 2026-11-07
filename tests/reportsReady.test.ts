/** Finished research waits in her Boss OS inbox for 14 days (owner, 6 Nov 2026). Synthetic data. */
import { describe, expect, it } from "vitest";
import { reportsReady, REPORTS_READY_DAYS } from "../src/client/boss/components/ReportsReady";

const now = Date.UTC(2026, 10, 6, 23, 0);
const day = 86_400_000;
const p = (id: string, state: string, ago: number | null) => ({ id, state, title: id, summary: null, status: "complete", question: null, delivered_at: ago === null ? null : now - ago * day });

describe("Reports ready in the inbox", () => {
  it("shows delivered reports from the last 14 days, newest first, and nothing else", () => {
    const out = reportsReady([p("old", "delivered", REPORTS_READY_DAYS + 1), p("a", "delivered", 2), p("b", "delivered", 0.1), p("queued", "requested", null), p("failed", "failed", 1)], now);
    expect(out.map((x) => x.id)).toEqual(["b", "a"]);
  });
  it("is empty when nothing was delivered", () => {
    expect(reportsReady([p("queued", "requested", null)], now)).toEqual([]);
  });
});
