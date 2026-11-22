/**
 * THE JOB LANE (eng sweep, 22 Nov 2026). A scheduled `job ·` workflow (Simone's morning email, the errand
 * reminders, the scoreboards) must never wait behind a pull request's CI. GitHub queues every run that shares a
 * concurrency group, so a `job ·` workflow that shared one with PR CI could sit behind a PR's whole suite (or be
 * cancelled by it, under cancel-in-progress). Each `job ·` workflow therefore holds a group of its own: a literal
 * name, used by no workflow a pull request starts and by no other `job ·` workflow.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(__dirname, "..", ".github", "workflows");

type Flow = { file: string; name: string; group: string | null; byPullRequest: boolean };

/** The three facts this guard needs, read from a workflow's top-level keys. Pure. */
export function flowOf(file: string, text: string): Flow {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const name = (lines.find((l) => /^name:/.test(l)) ?? "").replace(/^name:\s*/, "").replace(/^["']|["']$/g, "").trim();
  const block = (key: string) => {
    const i = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
    if (i < 0) return [] as string[];
    const out = [lines[i]];
    for (const l of lines.slice(i + 1)) { if (/^\S/.test(l)) break; out.push(l); }
    return out;
  };
  const conc = block("concurrency");
  const inline = (conc[0] ?? "").replace(/^concurrency:\s*/, "").trim();
  const groupLine = conc.find((l) => /^\s+group:/.test(l));
  const group = groupLine ? groupLine.replace(/^\s+group:\s*/, "").replace(/^["']|["']$/g, "").trim() : inline ? inline.replace(/^["']|["']$/g, "") : null;
  const on = block("on").join("\n");
  const byPullRequest = /\bpull_request(_target)?\b/.test(on);
  return { file, name, group, byPullRequest };
}

const flows = () => readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).map((f) => flowOf(f, readFileSync(join(DIR, f), "utf8")));
const isJob = (f: Flow) => /^job ·/.test(f.name);

/** Every way a `job ·` workflow can be made to wait on PR CI or on another job. Pure. */
export function laneProblems(all: Flow[]): string[] {
  const jobs = all.filter(isJob);
  const prGroups = all.filter((f) => f.byPullRequest).map((f) => ({ file: f.file, group: f.group ?? "" }));
  const out: string[] = [];
  for (const j of jobs) {
    if (!j.group) { out.push(`${j.file}: no concurrency group of its own`); continue; }
    if (/\$\{\{/.test(j.group)) out.push(`${j.file}: group "${j.group}" is an expression, so it can resolve to another run's group`);
    if (j.byPullRequest) out.push(`${j.file}: a pull request starts it`);
    for (const p of prGroups.filter((g) => g.file !== j.file)) {
      // A PR group with an expression (ci-${{ github.ref }}) is compared by its literal prefix.
      const prefix = p.group.split("${{")[0];
      if (p.group === j.group || (p.group.includes("${{") && prefix && j.group.startsWith(prefix))) out.push(`${j.file}: shares group "${j.group}" with PR CI ${p.file}`);
    }
    for (const o of jobs) if (o !== j && o.group === j.group) out.push(`${j.file}: shares group "${j.group}" with ${o.file}`);
  }
  return out;
}

describe("the job lane: a `job ·` workflow never waits on PR CI", () => {
  it("every `job ·` workflow has its own literal group, shared with no PR workflow and no other job", () => {
    const all = flows();
    expect(all.filter(isJob).length, "no `job ·` workflow found: the guard would pass while seeing nothing").toBeGreaterThanOrEqual(5);
    expect(all.filter((f) => f.byPullRequest).length, "no PR workflow found").toBeGreaterThanOrEqual(1);
    expect(laneProblems(all)).toEqual([]);
  });

  it("catches a job that shares PR CI's group, an expression group, a missing group and two jobs on one group", () => {
    const ci = flowOf("ci.yml", "name: CI\non:\n  push:\n  pull_request:\nconcurrency:\n  group: ci-${{ github.ref }}\n  cancel-in-progress: true\n");
    const job = (file: string, conc: string) => flowOf(file, `name: job · thing\non:\n  repository_dispatch:\n${conc}`);
    expect(laneProblems([ci, job("a.yml", "concurrency:\n  group: ci-${{ github.ref }}\n")]).join("\n")).toMatch(/shares group .* with PR CI ci\.yml/);
    expect(laneProblems([ci, job("b.yml", "concurrency:\n  group: ci-main\n")]).join("\n")).toMatch(/with PR CI ci\.yml/);
    expect(laneProblems([ci, job("c.yml", "concurrency:\n  group: job-${{ github.ref }}\n")]).join("\n")).toMatch(/is an expression/);
    expect(laneProblems([ci, job("d.yml", "")]).join("\n")).toMatch(/no concurrency group/);
    expect(laneProblems([ci, job("e.yml", "concurrency: job-x\n"), job("f.yml", "concurrency:\n  group: job-x\n")]).join("\n")).toMatch(/e\.yml: shares group "job-x" with f\.yml/);
    expect(laneProblems([ci, job("g.yml", "concurrency:\n  group: job-g\n  cancel-in-progress: false\n")])).toEqual([]);
  });
});
