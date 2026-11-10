import { execFileSync } from "node:child_process";

/**
 * One `wrangler d1 execute` normally finishes in a few seconds. Without a bound, a CLI wedged on the
 * SQLite file `wrangler dev` holds would block the Playwright worker (execFileSync is synchronous, so
 * no test timeout can fire) until the CI job is cancelled, and the spec would report nothing. Each
 * attempt is killed at this bound and the spec fails with a named reason instead.
 */
const D1_ATTEMPT_TIMEOUT_MS = 60_000;

function isHung(error: unknown): boolean {
  const e = error as { code?: string; signal?: string };
  return e.code === "ETIMEDOUT" || e.signal === "SIGKILL";
}

function describeFailure(error: unknown, sql: string): string {
  const e = error as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string; code?: string; signal?: string };
  const hung = isHung(error);
  return [
    hung ? `D1_EXECUTE_HUNG: wrangler d1 execute did not finish within ${D1_ATTEMPT_TIMEOUT_MS / 1000}s and was killed (sql: ${sql.slice(0, 120)})` : "",
    e.stderr?.toString(), e.stdout?.toString(), e.message,
  ]
    .filter((part) => part && part.trim().length > 0)
    .join("\n")
    .trim();
}

/**
 * Insert fixture rows into the SAME local D1 that `wrangler dev` is serving.
 *
 * Two specs need a second identity that the seeds do not create (an INVESTMENT_TEAM member with no
 * Managing Partner role). There is no route that creates a firm user — deliberately — so the row is
 * written with `wrangler d1 execute --local`.
 *
 * That opens the miniflare SQLite in a SECOND workerd process while `wrangler dev` still holds it,
 * and the two contend. Measured on 2026-08-17: a full `npm run e2e` failed
 * `d1-design-states.spec.ts` with `✘ [ERROR] internal error; reference = dkdae7obnj73j826o0q9r58c`
 * after 8.4s in `beforeAll`, while `p3-governed-work.spec.ts` — the identical statement through the
 * identical pattern — succeeded in the same run. 59 passed, 1 failed, 2 did not run. The contention
 * is in the wrangler CLI's access to the file, not in West Peek OS: no application code ran, and no
 * assertion was reached.
 *
 * So the write is retried instead of being reported as a product failure. Retrying weakens nothing:
 * the statements must still succeed before the spec proceeds, and a genuinely bad one (syntax
 * error, missing table, constraint violation) fails every attempt and still fails the spec, with
 * wrangler's own output attached rather than swallowed.
 *
 * Arguments are passed as an argv array, so the SQL is never re-parsed by a shell.
 */
export function provisionLocalD1(sql: string, attempts = 5): void {
  let lastDetail = "";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      execFileSync("npx", ["wrangler", "d1", "execute", "WP_OS_DB", "--local", "--command", sql], {
        stdio: "pipe",
        timeout: D1_ATTEMPT_TIMEOUT_MS,
        killSignal: "SIGKILL",
      });
      return;
    } catch (error) {
      lastDetail = describeFailure(error, sql);
      // A wedged CLI is not lock contention that clears in a second: fail now, by name.
      if (isHung(error)) throw new Error(lastDetail);
      // Back off before the next attempt: the holder releases the file in well under a second,
      // and the last attempt must not sleep for nothing.
      if (attempt < attempts) execFileSync("sleep", [String(attempt)]);
    }
  }

  throw new Error(`local D1 provisioning failed after ${attempts} attempts.\n${lastDetail}`);
}

/**
 * Read rows back out of the SAME local D1, for the handful of facts no route exposes.
 *
 * USED SPARINGLY AND ONLY WHERE THERE IS NO SURFACE. `pending_deck` is the case it exists for: the
 * deck queue records WHY a deck could not be read — "the reason is stored, not swallowed", because
 * "the deck said nothing about revenue" and "nobody read the deck" look identical on a company card
 * unless one of them is written down — and nothing serves that row over HTTP. A journey that could
 * not see it would have to stop one step before the property worth proving.
 *
 * Same retry reasoning as `provisionLocalD1`: this opens the miniflare SQLite in a second workerd
 * process while `wrangler dev` still holds it, and the two contend.
 */
export function queryLocalD1<T = Record<string, unknown>>(sql: string, attempts = 5): T[] {
  let lastDetail = "";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const out = execFileSync(
        "npx",
        ["wrangler", "d1", "execute", "WP_OS_DB", "--local", "--json", "--command", sql],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: D1_ATTEMPT_TIMEOUT_MS, killSignal: "SIGKILL" },
      );
      // wrangler prints an array of statement results; each carries its own `results`.
      const parsed = JSON.parse(out.slice(out.indexOf("["))) as Array<{ results?: T[] }>;
      return parsed.flatMap((r) => r.results ?? []);
    } catch (error) {
      lastDetail = describeFailure(error, sql);
      // A wedged CLI is not lock contention that clears in a second: fail now, by name.
      if (isHung(error)) throw new Error(lastDetail);
      if (attempt < attempts) execFileSync("sleep", [String(attempt)]);
    }
  }

  throw new Error(`local D1 read failed after ${attempts} attempts.\n${lastDetail}`);
}
