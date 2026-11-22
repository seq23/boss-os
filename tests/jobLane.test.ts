/**
 * THE JOB LANE (eng sweep, 22 Nov 2026). A scheduled `job ·` workflow (Simone's morning email, the errand
 * reminders, the scoreboards) must never wait behind a pull request's CI. GitHub queues every run that shares a
 * concurrency group, so a `job ·` workflow that shared one with PR CI could sit behind a PR's whole suite (or be
 * cancelled by it, under cancel-in-progress). Each `job ·` workflow therefore holds a group of its own: a literal
 * name used by no other workflow (PR CI above all, but also e2e, deploy and the other jobs: any run holding the
 * group makes the job wait). Groups are compared at both
 * levels GitHub has (the workflow's and each job's), because a group name is shared across the whole repo.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const DIR = join(__dirname, "..", ".github", "workflows");

type Flow = { file: string; name: string; own: string | null; groups: string[]; byPullRequest: boolean };

/** `concurrency: name` or `concurrency: { group: name }`; null when there is no readable group. */
const groupOf = (c: unknown): string | null => {
  const g = typeof c === "string" ? c : c && typeof c === "object" ? (c as { group?: unknown }).group : null;
  return typeof g === "string" && g.trim() ? g.trim() : null;
};

/** The facts this guard needs, read by a real YAML parser (a file that does not parse throws, so the test fails). */
function flowOf(file: string, text: string): Flow {
  const doc = (parse(text) ?? {}) as Record<string, unknown>;
  const on = doc.on;
  const events = typeof on === "string" ? [on] : Array.isArray(on) ? on.map(String) : on && typeof on === "object" ? Object.keys(on) : [];
  const own = groupOf(doc.concurrency);
  const jobGroups = Object.values((doc.jobs ?? {}) as Record<string, { concurrency?: unknown } | null>).map((j) => groupOf(j?.concurrency));
  const groups = [own, ...jobGroups].filter((g): g is string => g !== null);
  return { file, name: String(doc.name ?? ""), own, groups, byPullRequest: events.some((e) => e === "pull_request" || e === "pull_request_target") };
}

const flows = () => readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).map((f) => flowOf(f, readFileSync(join(DIR, f), "utf8")));
/** A job is a `job-*.yml` file (the repo's convention) or a workflow named `job ·`, so neither half can slip past. */
const isJob = (f: Flow) => /^job-/.test(f.file) || /^job ·/.test(f.name);
const isExpr = (g: string) => g.includes("${{");
/** A group with an expression (ci-${{ github.ref }}) can resolve to any name with its literal prefix. */
const collides = (job: string, other: string) => {
  const prefix = other.split("${{")[0] ?? "";
  return job === other || (isExpr(other) && prefix !== "" && job.startsWith(prefix));
};

/** Every way a `job ·` workflow can be made to wait on PR CI or on any other run. */
function laneProblems(all: Flow[]): string[] {
  const jobs = all.filter(isJob);
  const out: string[] = [];
  for (const j of jobs) {
    if (!j.own) out.push(`${j.file}: no concurrency group of its own`);
    for (const g of j.groups.filter(isExpr)) out.push(`${j.file}: group "${g}" is an expression, so it can resolve to another run's group`);
    if (j.byPullRequest) out.push(`${j.file}: a pull request starts it`);
    for (const o of all) if (o !== j) for (const g of j.groups) if (o.groups.some((og) => collides(g, og))) out.push(`${j.file}: shares group "${g}" with ${o.file}${o.byPullRequest ? " (PR CI)" : ""}`);
  }
  return out;
}

describe("the job lane: a `job ·` workflow never waits on PR CI", () => {
  it("every `job ·` workflow has its own literal group, shared with no other workflow", () => {
    const all = flows();
    expect(all.filter(isJob).length, "no `job ·` workflow found: the guard would pass while seeing nothing").toBeGreaterThanOrEqual(5);
    expect(all.filter((f) => f.byPullRequest).length, "no PR workflow found").toBeGreaterThanOrEqual(1);
    expect(laneProblems(all)).toEqual([]);
  });

  it("catches each way a job can share a lane, at the workflow level and the job level", () => {
    const ci = flowOf("ci.yml", "name: CI\non:\n  push:\n  pull_request:\nconcurrency:\n  group: ci-${{ github.ref }}\n  cancel-in-progress: true\njobs:\n  gate:\n    concurrency: gate-lane\n");
    const job = (file: string, rest: string, on = "  repository_dispatch:\n") => flowOf(file, `name: job · thing\non:\n${on}${rest}`);
    const own = "concurrency:\n  group: job-own\n";
    const problems = (...f: Flow[]) => laneProblems([ci, ...f]).join("\n");
    expect(problems(job("a.yml", "concurrency:\n  group: ci-main\n"))).toMatch(/a\.yml: shares group "ci-main" with ci\.yml \(PR CI\)/);
    expect(problems(job("b.yml", "concurrency:\n  group: job-${{ github.ref }}\n"))).toMatch(/b\.yml: group .* is an expression/);
    expect(problems(job("c.yml", ""))).toMatch(/c\.yml: no concurrency group of its own/);
    expect(problems(job("d.yml", "concurrency: { group: ci-x }\n"))).toMatch(/d\.yml: shares group "ci-x" with ci\.yml \(PR CI\)/);
    expect(problems(job("e.yml", "concurrency: job-x\n"), job("f.yml", "concurrency:\n  group: job-x\n"))).toMatch(/e\.yml: shares group "job-x" with f\.yml/);
    expect(problems(job("g.yml", `${own}jobs:\n  run:\n    concurrency: gate-lane\n`))).toMatch(/g\.yml: shares group "gate-lane" with ci\.yml \(PR CI\)/);
    expect(problems(job("h.yml", own, "  pull_request:\n"))).toMatch(/h\.yml: a pull request starts it/);
    expect(problems(flowOf("job-i.yml", `name: Nightly thing\non: [push]\n`))).toMatch(/job-i\.yml: no concurrency group/);
    const deploy = flowOf("deploy.yml", "name: Deploy\non:\n  push:\nconcurrency:\n  group: deploy-production\n");
    expect(laneProblems([ci, deploy, job("j.yml", "concurrency: deploy-production\n")]).join("\n")).toMatch(/j\.yml: shares group "deploy-production" with deploy\.yml$/m);
    expect(laneProblems([ci, job("ok.yml", "concurrency:\n  group: job-ok\n  cancel-in-progress: false\n")])).toEqual([]);
  });
});
