import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

/**
 * NO FOURTH HEADING LEVEL ANYWHERE IN THE CLIENT. The shell prints the page title as an h2, a
 * section is an h3 and a thing inside a section is an h4; an h5 is a fourth level in a product
 * with three, and it arrives the moment somebody nests one section inside another.
 *
 * Moved here from dealRecordLayout.test.ts when the fund screens it also checked retired
 * (22 Nov 2026). It walks all of src/client, Boss OS included.
 */
const CLIENT = new URL("../src/client/", import.meta.url).pathname;

/** Comments blanked, so a header that quotes `<h5>` as the defect it fixed is not the offence. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/^[ \t]*\/\/.*$/gm, (m) => " ".repeat(m.length));
}

function clientFiles(dir = CLIENT): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? clientFiles(`${dir}${e.name}/`) : e.name.endsWith(".tsx") ? [`${dir}${e.name}`] : [],
  );
}

describe("heading ranks across the client", () => {
  it("walks real files, Boss OS among them", () => {
    const files = clientFiles();
    expect(files.some((f) => f.includes("/client/boss/"))).toBe(true);
    expect(files.length).toBeGreaterThan(20);
  });

  it("has no h5 anywhere in the client", () => {
    const offenders = clientFiles().filter((f) => /<h5[ >]/.test(code(readFileSync(f, "utf8"))));
    expect(offenders.map((f) => f.split("/client/")[1])).toEqual([]);
  });
});
