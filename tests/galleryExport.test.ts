import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectArtifacts, gallerySources, titleBeside } from "../scripts/ops/gallery-export.mjs";

/**
 * ZORA'S GALLERY INPUT HAS A WRITER (22 Oct 2026). Without one her archive audit read nothing every
 * Friday. Rule 0: the writer finds real links with real titles, and finding none is a failure.
 */
const U = "https://claude.ai/artifact/QhkCPRzzuNm9Kd1ystTuDd";

describe("titles come from beside the link", () => {
  it("reads a table row, a markdown link and a bullet", () => {
    expect(titleBeside(`| **Open Loops** | ${U} | The standing queue |`, U)).toBe("Open Loops");
    expect(titleBeside(`see the [Search Readiness Checklist](${U}) first`, U)).toBe("Search Readiness Checklist");
    expect(titleBeside(`- How We Know Numbers ${U}`, U)).toBe("How We Know Numbers");
  });
});

describe("collectArtifacts", () => {
  it("dedupes by URL, the first (most authoritative) source's title wins, and dates come from the file", () => {
    const files: Record<string, string> = {
      "/h/HANDOFF.md": `| **Open Loops** | ${U} | q |`,
      "/h/mem.md": `---\nname: something else\n---\nOpen Loops again ${U}\nand [Other page](https://claude.ai/code/artifact/abcdefgh-1234)`,
    };
    const got = collectArtifacts(Object.keys(files), (p: string) => files[p]!, () => new Date("2026-10-20T00:00:00Z"));
    expect(got.map((a) => [a.title, a.url, a.updated])).toEqual([
      ["Open Loops", U, "2026-10-20"],
      ["Other page", "https://claude.ai/code/artifact/abcdefgh-1234", "2026-10-20"],
    ]);
  });

  it("finds HANDOFF, repo docs and memory notes as sources, and nothing in an empty home (rule 0 input)", () => {
    const home = mkdtempSync(path.join(tmpdir(), "gallery-"));
    expect(gallerySources(home)).toEqual([]);
    writeFileSync(path.join(home, "HANDOFF.md"), `- Page ${U}`);
    mkdirSync(path.join(home, "GitHub", "repo", "docs"), { recursive: true });
    writeFileSync(path.join(home, "GitHub", "repo", "docs", "X.md"), `${U}\n# X`);
    const mem = path.join(home, ".claude", "projects", home.replace(/\//g, "-"), "memory");
    mkdirSync(mem, { recursive: true });
    writeFileSync(path.join(mem, "n.md"), "no link");
    expect(gallerySources(home).map((p) => path.relative(home, p)).sort()).toEqual(
      ["HANDOFF.md", path.join("GitHub", "repo", "docs", "X.md"), path.relative(home, path.join(mem, "n.md"))].sort());
    expect(collectArtifacts(gallerySources(home)).length).toBe(1);
  });
});
