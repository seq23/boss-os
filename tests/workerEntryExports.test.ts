import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * THE WORKER'S ENTRY MODULE EXPORTS ONLY HANDLERS (15 Nov 2026). workerd reads every named export of
 * src/worker/index.ts as an entrypoint; `export const MAIL_ALARM_CRON = "*\/5 * * * *"` (#420) made it
 * refuse to start ("Incorrect type for map entry ... not of type 'function or ExportedHandler'"), and
 * only the post-merge e2e caught it. A value export there is caught here, before a merge.
 */
describe("the Worker entry module", () => {
  it("exports only functions, classes and the default handler", () => {
    const src = readFileSync("src/worker/index.ts", "utf8");
    const values = [...src.matchAll(/^export\s+(?:const|let|var|enum)\s+(\w+)/gm)].map((m) => m[1]);
    expect(values).toEqual([]);
    // Proven on the defect itself.
    expect([...`export const MAIL_ALARM_CRON = "x";`.matchAll(/^export\s+(?:const|let|var|enum)\s+(\w+)/gm)].map((m) => m[1])).toEqual(["MAIL_ALARM_CRON"]);
  });
});
