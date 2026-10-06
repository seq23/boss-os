import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRules, runAll, productSources, DOC } from "../scripts/validate/service-rules.mjs";
import { BOSS_WAIT_KINDS, waitDetail, WAIT_SHAPE, blockReplyDoor, taskTokenIn } from "../src/shared/boss/service/waits.mjs";
import { SERVICE_PRACTICES, deferredItemsIn, deferKey, standingConstraintsIn, missingKeysIn } from "../src/shared/boss/service/practices.mjs";
import { readSecretLines, scrubSecretValues, carriesSecretValue, secretNameProblem } from "../src/shared/boss/service/secretLines.mjs";
import { outboundFilesPlan } from "../src/shared/boss/service/files.mjs";
import { registeredRepoIn, parseRepoChange } from "../src/shared/boss/repoChange/lane.mjs";

/**
 * docs/SERVICE_RULES.md IS READ BY CODE (a specification no code reads is a wish). This test parses
 * the document the validator parses, pins its shape, and exercises the pure halves of the rules.
 */
const markdown = readFileSync(DOC, "utf8");

describe("the service rules document", () => {
  const { rules, problems } = parseRules(markdown);

  it("holds R1–R31, contiguous, with no malformed line", () => {
    expect(problems).toEqual([]);
    expect(rules.map((r) => r.n)).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
  });

  it("tags R1–R23 ALL-KINDS and R24–R31 REPO-ONLY, as West Peek OS numbers them", () => {
    expect(rules.filter((r) => r.tag === "ALL-KINDS").map((r) => r.n)).toEqual(Array.from({ length: 23 }, (_, i) => i + 1));
    expect(rules.filter((r) => r.tag === "REPO-ONLY").map((r) => r.n)).toEqual([24, 25, 26, 27, 28, 29, 30, 31]);
  });

  it("passes the validator against the real tree: every anchor exists, every ALL-KINDS rule on the shared layer", () => {
    const out = runAll({ markdown, sources: productSources() });
    expect(out.violations).toEqual([]);
    expect(out.laneOnly).toBe(0);
  });

  it("records every divergence from West Peek OS, each naming a rule that exists", () => {
    const section = markdown.split("## Divergences from West Peek OS")[1]?.split("\n## ")[0] ?? "";
    const ds = [...section.matchAll(/^- \*\*D(\d+) · (?:R(\d+)(?:\/R(\d+))?)?/gm)];
    expect(ds.length).toBeGreaterThanOrEqual(10);
    for (const d of ds) for (const n of [d[2], d[3]].filter(Boolean)) expect(rules.some((r) => r.n === Number(n))).toBe(true);
    expect(section).toMatch(/AUTHORITY_MODEL/);
  });

  it("every practice line in the fragment is an ALL-KINDS rule in the document", () => {
    for (const p of SERVICE_PRACTICES) expect(rules.find((r) => `R${r.n}` === p.rule)?.tag).toBe("ALL-KINDS");
  });
});

describe("the pure halves", () => {
  it("every wait kind renders in three parts", () => {
    for (const k of BOSS_WAIT_KINDS) expect(waitDetail(k, { what: "X", why: "Y" })).toMatch(WAIT_SHAPE);
  });

  it("a SECRET line is read, a reserved name refused, and the value scrubbed from quoted-printable and base64 parts", () => {
    const v = "abcd-1234-efgh-5678";
    const r = readSecretLines(`hi\nSECRET RESEND_API_KEY=${v}\nSECRET PATH=/evil`);
    expect(r.found).toEqual([{ name: "RESEND_API_KEY", value: v }]);
    expect(r.refused.map((x) => x.name)).toEqual(["PATH"]);
    expect(secretNameProblem("CLAUDE_TOKEN")).toMatch(/reserved prefix/);
    const raw = [
      "Content-Type: multipart/alternative; boundary=\"b1\"", "", "--b1",
      "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", btoa(`SECRET RESEND_API_KEY=${v}\n`),
      "--b1", "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: quoted-printable", "", `<p>SECRET RESEND_API_KEY=3D${v}</p>`, "--b1--", "",
    ].join("\r\n");
    expect(carriesSecretValue(raw, [v])).toBe(true);
    const clean = scrubSecretValues(raw, [v]);
    expect(carriesSecretValue(clean, [v])).toBe(false);
  });

  it("deferred lines, missing keys and standing constraints are read exactly", () => {
    expect(deferredItemsIn("- Deferred to 2026-10-13: send the deck\nDeferred to 2026-13-45: bad")).toHaveLength(1);
    const item = { ask: "send the deck", due_at: "2026-10-13T14:00:00.000Z" };
    expect(deferKey("tsk_a", item)).toBe(deferKey("tsk_a", item));
    expect(deferKey("tsk_a", item)).not.toMatch(/[%_]{2}|%/);
    expect(missingKeysIn("Missing key: RUNWARE_API_KEY\nMissing key: ANTHROPIC_API_KEY")).toEqual(["RUNWARE_API_KEY"]);
    expect(standingConstraintsIn("I never want that\nNever: book before 9am")).toEqual(["Never: book before 9am"]);
  });

  it("a reply's first words choose the door; the subject token names the task", () => {
    expect(blockReplyDoor("Try again please")).toBe("RETRY");
    expect(blockReplyDoor("yes")).toBe("RETRY");
    expect(blockReplyDoor("drop it")).toBe("DROP");
    expect(blockReplyDoor("use the blue one")).toBe("ANSWER");
    expect(taskTokenIn("Re: Stopped: x [tsk_m2abc123]")).toBe("tsk_m2abc123");
  });

  it("files: attached up to 10 MB in total, every one listed, a large one says where it is", () => {
    const plan = outboundFilesPlan([
      { name: "a.png", bytes: 6 * 1024 * 1024, path: "/tmp/a.png" },
      { name: "b.png", bytes: 6 * 1024 * 1024, path: "/tmp/b.png" },
    ]);
    expect(plan.attach).toEqual([0]);
    expect(plan.lines[1]).toMatch(/on your Mac at \/tmp\/b\.png/);
  });

  it("any repo she names by its GitHub address registers — and West Peek's never do", () => {
    expect(registeredRepoIn("fix https://github.com/someone/new-site please")).toEqual({ repo: "new-site", github_repo: "someone/new-site" });
    expect(parseRepoChange("github.com/seq23/west-peek-os header")).toHaveProperty("excluded");
  });
});
