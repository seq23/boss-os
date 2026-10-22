import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FUND_TEAM_KEYS, bossOsProcessEnv, isWestPeekKey } from "../scripts/lib/vault-env.mjs";

/**
 * NO WEST PEEK KEY CAN REACH A BOSS OS PROCESS (owner, 22 Oct 2026).
 *
 * The Mac vault is shared with West Peek OS. `npm run vault:run` used to inject every key it holds,
 * so every Boss OS process carried RESEND_API_KEY — the West Peek FUND's Resend team — and six
 * chassis scripts fell back to sending through it. Four doors, one test each:
 *   1. the process door: `vault:run` spawns with bossOsProcessEnv, which strips every West Peek key;
 *   2. the Worker door: cloudflare-mapping.json never syncs one, and sync:cloudflare refuses to;
 *   3. the code door: no file in scripts/ or src/ reads one from process.env;
 *   4. the list itself names the fund's Resend key and the WP_ prefix.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

/** A file that reads a West Peek key out of its environment. */
export const READS_WEST_PEEK_KEY = /process\.env(?:\.|\[\s*["'`])(RESEND_API_KEY|WP_[A-Z0-9_]+)\b/;

export function filesReadingWestPeekKeys(files: Array<{ file: string; source: string }>): string[] {
  return files.filter(({ source }) => READS_WEST_PEEK_KEY.test(source)).map(({ file }) => file);
}

describe("the West Peek key list", () => {
  it("names the fund's Resend team key and every WP_ credential, and nothing of Boss OS's", () => {
    expect(FUND_TEAM_KEYS).toContain("RESEND_API_KEY");
    for (const k of ["RESEND_API_KEY", "WP_OS_SECRET_HANDOFF_KEY", "WP_NETWORK_OS_INTAKE_SECRET"]) expect(isWestPeekKey(k), k).toBe(true);
    for (const k of ["BOSS_OS_MAIL_KEY", "BOSS_OS_FALLBACK_MAIL_KEY", "CLOUDFLARE_API_TOKEN", "OPENROUTER_API_KEY"]) expect(isWestPeekKey(k), k).toBe(false);
  });
});

describe("door 1 — vault:run never hands a Boss OS process a West Peek key", () => {
  it("bossOsProcessEnv strips them and keeps Boss OS's own", () => {
    const env = bossOsProcessEnv({ RESEND_API_KEY: "fund", WP_OS_SECRET_HANDOFF_KEY: "wp", BOSS_OS_MAIL_KEY: "boss", PATH: "/bin" });
    expect(env).toEqual({ BOSS_OS_MAIL_KEY: "boss", PATH: "/bin" });
  });

  it("the run command spawns with bossOsProcessEnv, and with nothing raw", () => {
    const src = read("scripts/vault/vault.mjs");
    const run = src.slice(src.indexOf('case "run":'), src.indexOf('case "remove":'));
    expect(run.length, "the run case moved").toBeGreaterThan(50);
    expect(run).toMatch(/env:\s*bossOsProcessEnv\(\{\s*\.\.\.process\.env,\s*\.\.\.secrets\s*\}\)/);
    expect(src, "a spawn elsewhere passes the raw vault").not.toMatch(/env:\s*\{\s*\.\.\.process\.env,\s*\.\.\.secrets\s*\}/);
  });
});

describe("door 2 — the Boss OS Worker never holds a West Peek key", () => {
  const mapping = JSON.parse(read("scripts/vault/cloudflare-mapping.json"));
  it("secret_names lists none, and the fund's key is classified not_synced with a reason", () => {
    expect((mapping.secret_names as string[]).length).toBeGreaterThan(0);
    expect((mapping.secret_names as string[]).filter((n) => isWestPeekKey(n))).toEqual([]);
    expect(String(mapping.not_synced.RESEND_API_KEY ?? "")).toMatch(/fund/i);
  });
  it("sync:cloudflare refuses a West Peek key in secret_names", () => {
    expect(read("scripts/vault/vault.mjs")).toMatch(/names\.filter\(\(n\) => isWestPeekKey\(n\)\)[\s\S]{0,200}fail\(/);
  });
});

describe("door 3 — no Boss OS file reads a West Peek key", () => {
  const files = execFileSync("git", ["ls-files", "scripts", "src"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.(ts|tsx|mjs|js|cjs|sh)$/.test(f))
    .map((file) => ({ file, source: read(file) }));

  it("scans files (hard fail on zero)", () => {
    expect(files.length).toBeGreaterThan(100);
  });
  it("finds none", () => {
    expect(filesReadingWestPeekKeys(files), "Boss OS sends only through BOSS_OS_MAIL_KEY / BOSS_OS_FALLBACK_MAIL_KEY").toEqual([]);
  });
  it("the pattern catches the old fallback and spares a fake env object", () => {
    expect(filesReadingWestPeekKeys([{ file: "a.mjs", source: "key: process.env.RESEND_API_KEY," }])).toEqual(["a.mjs"]);
    expect(filesReadingWestPeekKeys([{ file: "b.mjs", source: 'process.env["WP_OS_SECRET_HANDOFF_KEY"]' }])).toEqual(["b.mjs"]);
    expect(filesReadingWestPeekKeys([{ file: "c.mjs", source: 'const env = { RESEND_API_KEY: "not-a-real-key" };' }])).toEqual([]);
  });
});
