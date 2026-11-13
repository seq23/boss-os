import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll } from "vitest";

/**
 * Applies the real migration files, seeds included. If a migration is malformed
 * the whole suite fails here, which is the correct place to find out.
 */
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

/*
 * THE NETWORK IS OFF IN THESE TESTS. A delivery now checks that cited sources answer a plain GET
 * (duties/floors.ts `sourcesReachable`), and a suite whose result depends on whether a news site is
 * up is not a suite. A test that needs an answer stubs one (helpers.ts `stubFetch`); everything else
 * gets a refusal, which the floor reads as "the check could not see", never as a dead source.
 */
globalThis.fetch = (async () => { throw new Error("the network is off in tests: stub fetch (tests/boss/helpers.ts stubFetch)"); }) as typeof fetch;
