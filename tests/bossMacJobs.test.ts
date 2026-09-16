import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectorStartFailure } from "../scripts/ops/credential-check.mjs";
import { bookFromMirror, MIRROR_MAX_AGE_DAYS } from "../scripts/ops/lib/book-mirror.mjs";

/**
 * THE JOBS THAT RUN ON HER MAC, TESTED IN THE CHASSIS (NODE) SUITE — they are Node processes, and
 * `tests/boss` runs inside workerd where `node:fs` and `spawnSync` do not exist.
 *
 * Both are 15 September 2026 findings from Today's Critical Alerts:
 *   - a probe timeout reported as "the Claude CLI could not be started on this machine";
 *   - a weekly hunt that read a hand-typed `book.txt` while the book she filed sat unread in D1.
 */
describe("the credential probe names the failure it had", () => {
  it("a timeout is a timeout, not a missing binary", () => {
    const t = connectorStartFailure({ code: "ETIMEDOUT" });
    expect(t.state).toBe("unknown");
    expect(t.detail).toMatch(/did not finish within three minutes/);
    expect(t.detail).not.toMatch(/could not be started/);
  });
  it("a missing binary says PATH, and anything else carries its code", () => {
    expect(connectorStartFailure({ code: "ENOENT" }).detail).toMatch(/not on this machine's PATH/);
    expect(connectorStartFailure({ code: "EACCES" }).detail).toMatch(/EACCES/);
    expect(connectorStartFailure(undefined).detail).toMatch(/unknown error/);
  });
});

describe("the hunt reads the mirror of the book she filed", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "boss-book-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  const mirror = (pulledAgoDays: number) => {
    const file = join(dir, "book.json");
    writeFileSync(file, JSON.stringify({
      pulled_at: Date.now() - pulledAgoDays * 86_400_000,
      book: { id: "bok_x", version: 3, received_at: Date.now() - 86_400_000 },
      lines: [
        { asset: "Anthropic", side: "sell", size_usd: 2e9, size_text: "$2B", source_line: "Anthropic IPO shares $2B" },
        { asset: "Databricks", side: "sell", size_usd: null, size_text: "size TBD", source_line: "Databricks — size TBD" },
      ],
    }));
    return file;
  };

  it("a fresh mirror is the book, sizeless lots included, and it says which version it is", () => {
    const b = bookFromMirror(mirror(0))!;
    expect(b.positions.map((p) => p.asset)).toEqual(["Anthropic", "Databricks"]);
    expect(b.positions[1]!.size_usd).toBeNull();
    expect(b.source).toMatch(/book v3/);
    expect(b.stale).toBe(false);
  });
  it("a mirror older than the pull cadence is marked stale rather than served as current", () => {
    expect(bookFromMirror(mirror(MIRROR_MAX_AGE_DAYS + 1))!.stale).toBe(true);
  });
  it("no mirror, or a broken one, is null — the offline file is the fallback, never a guess", () => {
    expect(bookFromMirror(join(dir, "missing.json"))).toBeNull();
    const broken = join(dir, "broken.json");
    writeFileSync(broken, "{not json");
    expect(bookFromMirror(broken)).toBeNull();
    writeFileSync(broken, JSON.stringify({ lines: "nope" }));
    expect(bookFromMirror(broken)).toBeNull();
  });
});
