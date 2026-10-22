import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { FUND_SIDE_CHASSIS_SENDERS } from "../scripts/ops/fund-side-chassis.mjs";
import { FALLBACK_FROM, sendersFor } from "../scripts/ops/notify.mjs";

/**
 * BOSS OS'S OWN MAIL NEVER GOES THROUGH A WEST PEEK ACCOUNT OR DOMAIN (owner, 12 Oct 2026; "Boss
 * emails can go thru any domain in cryptoclearr"). notify.mjs used to fall back from BOSS_OS_MAIL_KEY
 * to `<name>@westpeek.ventures` on the West Peek Resend team for every employee message. The fallback
 * is now The Industry Guides team (BOSS_OS_FALLBACK_MAIL_KEY, hello@theindustryguides.com).
 *
 * 1. No Boss OS file in scripts/ops or src names a From on westpeek.ventures or joinwestpeek.com.
 *    The fund-side chassis copies are exempt BY NAME, from the one list in fund-side-chassis.mjs.
 * 2. sendersFor's default fallback is The Industry Guides, never RESEND_API_KEY.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WP = String.raw`(?:westpeek\.ventures|joinwestpeek\.com)`;
/** A From on a West Peek domain: `Name <x@westpeek.ventures>` or `from: "x@joinwestpeek.com"`. */
export const WEST_PEEK_FROM = [
  new RegExp(String.raw`<[^<>\s"'\`]*@${WP}>`),
  new RegExp(String.raw`\bfrom["'\`]?\s*[:=]\s*["'\`][^"'\`\n]*@${WP}`, "i"),
];

// NO EXEMPTIONS since 22 Oct 2026: the fund-side chassis copies send through Boss OS's own team too.
const EXEMPT = new Set<string>();

export function westPeekFroms(files: Array<{ file: string; source: string }>): string[] {
  return files.filter(({ file, source }) => !EXEMPT.has(file) && WEST_PEEK_FROM.some((re) => re.test(source))).map(({ file }) => file);
}

const scanned = execFileSync("git", ["ls-files", "scripts/ops", "src"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ts|tsx|mjs|js|cjs|sh)$/.test(f))
  .map((file) => ({ file, source: readFileSync(path.join(ROOT, file), "utf8") }));

describe("Boss OS mail never names a West Peek From", () => {
  it("scans files (hard fail on zero)", () => {
    expect(scanned.length, "git ls-files found nothing under scripts/ops or src").toBeGreaterThan(0);
  });

  it("no Boss OS file in scripts/ops or src sends From a West Peek domain", () => {
    expect(
      westPeekFroms(scanned),
      "Boss OS's own mail falls back to The Industry Guides (BOSS_OS_FALLBACK_MAIL_KEY), never West Peek. " +
        "No file is exempt: the fund-side chassis copies send through Boss OS's own team as well.",
    ).toEqual([]);
  });

  it("has no exemptions, and scans every fund-side chassis copy", () => {
    expect([...EXEMPT]).toEqual([]);
    const names = new Set(scanned.map((f) => f.file));
    expect(FUND_SIDE_CHASSIS_SENDERS.filter((f) => !names.has(f))).toEqual([]);
  });

  it("the pattern catches the old notify.mjs fallback and spares the new one", () => {
    const old = "{ from: `${label} <${local}@westpeek.ventures>`, key: process.env.RESEND_API_KEY }";
    expect(westPeekFroms([{ file: "scripts/ops/notify.mjs", source: old }])).toEqual(["scripts/ops/notify.mjs"]);
    expect(westPeekFroms([{ file: "src/x.ts", source: 'const FROM = "Porter <porter@joinwestpeek.com>";' }])).toEqual(["src/x.ts"]);
    expect(westPeekFroms([{ file: "scripts/ops/lp-outcomes.mjs", source: old }])).toEqual(["scripts/ops/lp-outcomes.mjs"]);
    expect(westPeekFroms([{ file: "scripts/ops/notify.mjs", source: `from: "${FALLBACK_FROM}"; // MAILBOX = "sequoia@westpeek.ventures"` }])).toEqual([]);
  });
});

describe("sendersFor's fallback", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of ["BOSS_OS_MAIL_KEY", "BOSS_OS_FALLBACK_MAIL_KEY", "RESEND_API_KEY"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("is The Industry Guides team for Boss OS mail, and RESEND_API_KEY is never used", () => {
    process.env.BOSS_OS_MAIL_KEY = "primary";
    process.env.BOSS_OS_FALLBACK_MAIL_KEY = "fallback";
    process.env.RESEND_API_KEY = "west-peek";
    const [primary, fallback, ...rest] = sendersFor("Danielle");
    expect(rest).toEqual([]);
    expect(primary).toMatchObject({ from: "Danielle · Boss OS <danielle@sequoiataylor.com>", key: "primary" });
    expect(fallback).toMatchObject({ from: "Boss OS <hello@theindustryguides.com>", key: "fallback", reply_to: "danielle@sequoiataylor.com", tag: "#danielle", fallback: true });
    delete process.env.BOSS_OS_FALLBACK_MAIL_KEY;
    expect(sendersFor("Danielle").map((s) => s.key)).toEqual(["primary"]);
  });

  it("the fund-side chassis copies use the default Boss OS pair and never pass a West Peek fallback", () => {
    process.env.BOSS_OS_MAIL_KEY = "primary";
    process.env.BOSS_OS_FALLBACK_MAIL_KEY = "fallback";
    process.env.RESEND_API_KEY = "west-peek";
    expect(sendersFor("Monique").map((s) => s.key)).toEqual(["primary", "fallback"]);
    expect(FUND_SIDE_CHASSIS_SENDERS.length).toBeGreaterThan(0);
    for (const f of FUND_SIDE_CHASSIS_SENDERS) {
      const src = readFileSync(path.join(ROOT, f), "utf8");
      expect(src, `${f} must not pass a West Peek fallback`).not.toMatch(/westPeekFallback|fallback:\s*\w/);
      expect(src, `${f} must call sendersFor`).toMatch(/sendersFor\(/);
    }
  });
});
