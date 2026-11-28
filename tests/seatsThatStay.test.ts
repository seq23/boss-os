/**
 * THE SEATS THAT STAY, SAID THE SAME WAY EVERYWHERE (27 Nov 2026, #584 Not built). OPERATIONS.md's "Seats that
 * stay" table and the model boundary gate's exceptions file must name the same boss-os files with the same
 * reason (public web search or code edit), so a doc line cannot outlive the code or the other way round.
 */
import { expect, it } from "vitest";
import { readFileSync } from "node:fs";

const doc = readFileSync("docs/boss/OPERATIONS.md", "utf8");
const exceptions = JSON.parse(readFileSync("scripts/validate/worker-model-exceptions.json", "utf8")) as Record<string, { reason: string }>;
const section = doc.slice(doc.indexOf("### Seats that stay"), doc.indexOf("Outside this repo, where the gate does not scan"));
const rows = [...section.matchAll(/^\| [^|]+ \| `([^`]+)` \| (public web search|code edit) \|$/gm)].map((m) => [m[1], m[2]]);

it("the table has rows (a heading over an empty table proves nothing)", () => {
  expect(rows.length).toBeGreaterThanOrEqual(4);
});

it("every table row is an exception with the same reason", () => {
  for (const [file, why] of rows) expect(exceptions[file!]?.reason, file).toContain(`Seats that stay (${why})`);
});

it("every exception that says it stays is in the table", () => {
  const docFiles = new Set(rows.map(([file]) => file));
  for (const [file, { reason }] of Object.entries(exceptions)) if (/Seats that stay/.test(reason)) expect(docFiles.has(file), file).toBe(true);
});
