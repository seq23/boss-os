import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DESTINATIONS, FANOUT_ADDRESS, OWNER_INBOX, OUTREACH_MAILBOX, fanout, type Forwardable } from "../src/mail-fanout/index";

/** A message that records each forward; `fail` names destinations whose forward rejects. */
function message(to: string, fail: string[] = []) {
  const forwarded: string[] = [];
  const rejected: string[] = [];
  const m: Forwardable = {
    to,
    async forward(rcpt: string) {
      forwarded.push(rcpt);
      if (fail.includes(rcpt)) throw new Error(`${rcpt} refused`);
    },
    setReject(reason: string) { rejected.push(reason); },
  };
  return { m, forwarded, rejected };
}

describe("Industry Guides mail fan-out (owner, 13 Oct 2026)", () => {
  it("forwards hello@theindustryguides.com to the owner's inbox AND the outreach mailbox", async () => {
    expect(FANOUT_ADDRESS).toBe("hello@theindustryguides.com");
    expect([...DESTINATIONS]).toEqual(["cryptoclearr@gmail.com", "st@time-2-read.com"]);
    const { m, forwarded, rejected } = message("Hello@TheIndustryGuides.com");
    const r = await fanout(m);
    expect(forwarded.sort()).toEqual([OWNER_INBOX, OUTREACH_MAILBOX].sort());
    expect(r.delivered.sort()).toEqual([OWNER_INBOX, OUTREACH_MAILBOX].sort());
    expect(rejected).toEqual([]);
  });

  it("one failing forward never blocks the other, in either order", async () => {
    for (const bad of [OWNER_INBOX, OUTREACH_MAILBOX]) {
      const { m, forwarded, rejected } = message(FANOUT_ADDRESS, [bad]);
      const r = await fanout(m);
      expect(forwarded.length, bad).toBe(2);
      expect(r.delivered, bad).toEqual(DESTINATIONS.filter((d) => d !== bad));
      expect(r.failed.map((f) => f.to), bad).toEqual([bad]);
      expect(rejected, bad).toEqual([]);
    }
  });

  it("rejects (so the sender gets a bounce) only when every forward failed", async () => {
    const { m, rejected } = message(FANOUT_ADDRESS, [...DESTINATIONS]);
    const r = await fanout(m);
    expect(r.delivered).toEqual([]);
    expect(rejected.length).toBe(1);
  });

  it("anything else that reaches it goes to the owner's inbox only", async () => {
    const { m, forwarded } = message("maya@theindustryguides.com");
    await fanout(m);
    expect(forwarded).toEqual([OWNER_INBOX]);
  });

  it("ships as its own tiny worker with no bindings, deployed by the production path, and is on the map", () => {
    const toml = readFileSync("workers/industry-guides-mail-fanout/wrangler.toml", "utf8");
    expect(toml).toMatch(/^name = "industry-guides-mail-fanout"$/m);
    expect(toml).toMatch(/^main = "\.\.\/\.\.\/src\/mail-fanout\/index\.ts"$/m);
    const lines = toml.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
    expect(lines.map((l) => l.split("=")[0]!.trim()).sort()).toEqual(["compatibility_date", "main", "name", "workers_dev"]);
    expect(readFileSync("scripts/deploy/production.mjs", "utf8")).toContain('run("node scripts/deploy/mail-fanout.mjs")');
    const map = readFileSync("docs/OUTBOUND_EMAIL_MAP.md", "utf8");
    expect(map).toContain("hello@theindustryguides.com → industry-guides-mail-fanout Worker → cryptoclearr@gmail.com and st@time-2-read.com");
  });
});
