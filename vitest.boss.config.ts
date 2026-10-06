import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The ported Boss OS suites, run the way they were written: inside workerd against real D1, R2
 * and KV with the actual migration files applied.
 *
 * A SECOND CONFIG RATHER THAN A MERGED ONE. The chassis suites run in plain node and stand up
 * their own miniflare per file; these need the workers pool and a single worker. Those two pool
 * settings are mutually exclusive in one config, so `vitest.config.ts` excludes tests/boss and
 * this file owns them. Both run under `npm run validate`.
 *
 * BINDINGS KEEP THEIR ORIGINAL NAMES. These tests import Boss modules directly rather than going
 * through bossMount.ts, so they see DB/VAULT/SESSIONS/TASKS exactly as the artifact did. The
 * rename to WP_OS_* happens only at the mount, which is the one seam where both worlds meet.
 */
export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(here, "migrations"));

  return {
    resolve: {
      alias: {
        "@shared": path.join(here, "src/shared"),
        "@worker": path.join(here, "src/worker"),
      },
    },
    test: {
      include: ["tests/boss/**/*.test.ts"],
      setupFiles: ["./tests/boss/setup.ts"],
      silent: true,
      poolOptions: {
        workers: {
          singleWorker: true,
          miniflare: {
            compatibilityDate: "2025-10-01",
            compatibilityFlags: ["nodejs_compat"],
            d1Databases: ["DB"],
            r2Buckets: ["VAULT"],
            kvNamespaces: ["SESSIONS"],
            queueProducers: { TASKS: "boss-os-tasks" },
            bindings: {
              TEST_MIGRATIONS: migrations,
              /*
               * THE SUITE RUNS AS THE PRIVATE RUNTIME.
               *
               * Most of these tests are about mechanism - does a snapshot round-trip, does a
               * restore drill pass - and the private vault is the one that covers everything, so
               * it is the honest place to test the mechanism. The CLOUD restriction is not left
               * untested by that: tests/boss/leakage.test.ts states its domain explicitly on every
               * snapshot it takes, and asserts both directions - excluded on cloud, included on
               * private. Production defaults to cloud when this is unset.
               */
              BOSS_DOMAIN: "private",
              BOSS_OS_VERSION: "21.0.0-test",
              DEFAULT_PROVIDER: "fireworks",
              BOSS_PASSCODE: "test-passcode",
              SESSION_SECRET: "test-session-secret",
              FIREWORKS_API_KEY: "test-key-not-a-real-credential",
              // R3: a fixed 32-byte TEST key (base64) so the secret door runs in tests. Not a credential.
              BOSS_OS_SECRET_HANDOFF_KEY: "dGVzdC1rZXktMzItYnl0ZXMtbm90LWEtc2VjcmV0ISE=",
            },
          },
        },
      },
    },
  };
});
