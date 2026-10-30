import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOSS_INTAKE_SENDERS, isOwner } from "../src/shared/boss/intake/mail.mjs";
import { toBossEnv } from "../src/worker/bossMount";
import { bossOsProcessEnv } from "../scripts/lib/vault-env.mjs";

describe("extra owner sender configuration", () => {
  beforeEach(() => vi.stubEnv("BOSS_EXTRA_OWNER_SENDERS", ""));
  afterEach(() => vi.unstubAllEnvs());
  it("trims and case-folds every extra address, preserving the existing list", () => {
    const extra = " , Work@Example.com, product@example.com , ,";
    for (const address of ["work@example.com", " PRODUCT@EXAMPLE.COM ", ...BOSS_INTAKE_SENDERS]) {
      expect(isOwner(address, extra), address).toBe(true);
    }
    for (const address of ["unknown@example.com", "", " ", null, undefined, "other-work@example.com"]) {
      expect(isOwner(address, extra)).toBe(false);
    }
  });

  it.each([undefined, "", " , , "])("keeps the old behavior for %s", (extra) => {
    for (const address of BOSS_INTAKE_SENDERS) expect(isOwner(address, extra)).toBe(true);
    expect(isOwner("work@example.com", extra)).toBe(false);
    expect(isOwner("", extra)).toBe(false);
  });

  it("passes the Worker binding through the Boss mount", () => {
    const boss = toBossEnv({
      WP_OS_DB: {}, WP_OS_DOCUMENTS: {}, WP_OS_KV: {},
      BOSS_EXTRA_OWNER_SENDERS: "work@example.com",
    } as never);
    expect(boss.BOSS_EXTRA_OWNER_SENDERS).toBe("work@example.com");
  });

  it("allows the same private setting through the vault's Mac and Worker paths", () => {
    const extra = "work@example.com";
    expect(bossOsProcessEnv({ BOSS_EXTRA_OWNER_SENDERS: extra }).BOSS_EXTRA_OWNER_SENDERS).toBe(extra);
    const mapping = JSON.parse(readFileSync("scripts/vault/cloudflare-mapping.json", "utf8"));
    expect(mapping.secret_names).toContain("BOSS_EXTRA_OWNER_SENDERS");
    expect(mapping.not_synced).not.toHaveProperty("BOSS_EXTRA_OWNER_SENDERS");
  });

  it("reads the same environment variable in Mac-side Node callers", () => {
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
      import { isOwner } from './src/shared/boss/intake/mail.mjs';
      console.log(JSON.stringify([isOwner('work@example.com'), isOwner('unknown@example.com'), isOwner('')]));
      process.env.BOSS_EXTRA_OWNER_SENDERS = 'product@example.com';
      console.log(JSON.stringify([isOwner('work@example.com'), isOwner('product@example.com')]));
      console.log(JSON.stringify([isOwner('product@example.com', '')]));
      delete process.env.BOSS_EXTRA_OWNER_SENDERS;
      console.log(JSON.stringify([isOwner('work@example.com'), isOwner('')]));
      process.env.BOSS_EXTRA_OWNER_SENDERS = ' , , ';
      console.log(JSON.stringify([isOwner('work@example.com'), isOwner('')]));
    `], { env: { ...process.env, BOSS_EXTRA_OWNER_SENDERS: " , WORK@EXAMPLE.COM , " }, encoding: "utf8" });
    expect(output.trim().split("\n")).toEqual(["[true,false,false]", "[false,true]", "[false]", "[false,false]", "[false,false]"]);
  });
});
