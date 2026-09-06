import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll } from "vitest";

/**
 * Applies the real migration files, seeds included. If a migration is malformed
 * the whole suite fails here, which is the correct place to find out.
 */
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
