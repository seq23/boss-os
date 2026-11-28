import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { parse } from "yaml";
import { installerJobs, readSchedule, wranglerCrons } from "../ops/lib/schedule.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OWNERS = new Set(["Monique", "Toni", "Danielle", "Zora", "Camille", "Kendra", "Imani", "Simone", "Noelle"]);
const WEST_PEEK = /^(com\.seq\.scooter-watch(?:-digest)?$|ventures\.westpeek\.)/;

function cronCalls(source) {
  const calls = [];
  const file = ts.createSourceFile("worker.ts", source, ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "waitUntil") {
      let work = node.arguments[0];
      while (work && ts.isCallExpression(work) && ts.isPropertyAccessExpression(work.expression)
        && ["then", "catch", "finally"].includes(work.expression.name.text)) work = work.expression.expression;
      calls.push(work && ts.isCallExpression(work) ? work.expression.getText(file) : node.getText(file));
    }
    ts.forEachChild(node, visit);
  };
  const scheduled = (node) => {
    if (ts.isMethodDeclaration(node) && node.name.getText(file) === "scheduled") visit(node);
    else ts.forEachChild(node, scheduled);
  };
  scheduled(file);
  return calls;
}

export function ownershipProblems(manifest, files) {
  const registry = manifest.workerJobs ?? {};
  const rows = new Map(manifest.rows.map((row) => [row.id, row]));
  const problems = [];
  const recorded = new Set();
  const need = (key) => { if (!recorded.has(key)) problems.push(`${key}: no owned registry job`); };
  for (const [id, job] of Object.entries(registry)) {
    if (!OWNERS.has(job?.owner)) {
      problems.push(`${id}: no Boss OS owner`);
      continue;
    }
    const schedule = rows.get(job.schedule ?? id);
    if (!schedule && !job.label && !job.call) problems.push(`${id}: no scheduled trigger`);
    if (job.schedule && !schedule) problems.push(`${id}: unknown Schedule row ${job.schedule}`);
    if (job.call) recorded.add(`Worker call ${job.call}`);
    if (job.label) recorded.add(`launchd ${job.label}`);
    if (!schedule || job.schedule) continue;
    const t = schedule.trigger;
    for (const label of t.launchd ?? []) recorded.add(`launchd ${label}`);
    if (t.repo === "boss-os" && t.file) {
      for (const cron of t.crons ?? []) recorded.add(`${t.file} ${cron}`);
      recorded.add(t.file);
    }
  }
  for (const row of manifest.rows) {
    const { duty, repo, launchd = [], wpos } = row.trigger;
    if (!wpos && (duty || repo === "boss-os" || launchd.some((label) => !WEST_PEEK.test(label))) && !Object.hasOwn(registry, row.id)) {
      problems.push(`${row.id}: Schedule row has no registered owner`);
    }
  }
  for (const [file, source] of files) {
    if (file === "src/worker/index.ts") for (const call of cronCalls(source)) need(`Worker call ${call}`);
    if (/(^|\/)wrangler\.(?:toml|jsonc?)$/.test(file)) for (const cron of wranglerCrons(source)) need(`${file} ${cron}`);
    if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(file)) {
      const events = parse(source)?.on;
      if (/\/job-[^/]+\.ya?ml$/.test(file) || events === "schedule" || events?.schedule || (Array.isArray(events) && events.includes("schedule"))) need(file);
    }
    if (file.endsWith(".plist") || /^scripts\/ops\/install[^/]*\.sh$/.test(file)) {
      const labels = new Set(Object.keys(installerJobs(source)));
      for (const match of source.matchAll(/<key>Label<\/key>\s*<string>([^<$]+)<\/string>/g)) labels.add(match[1].trim());
      if (file.endsWith(".plist") && !labels.size) problems.push(`${file}: could not read launchd Label`);
      for (const label of labels) if (!WEST_PEEK.test(label)) need(`launchd ${label}`);
    }
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const manifest = readSchedule(ROOT);
  const paths = execFileSync("git", ["-C", ROOT, "ls-files", "-z"], { encoding: "utf8" }).split("\0")
    .filter((file) => !/(^|\/)(?:tests?|fixtures?)\//.test(file))
    .filter((file) => file === "src/worker/index.ts" || file.endsWith(".plist")
      || /(^|\/)wrangler\.(?:toml|jsonc?)$|^\.github\/workflows\/[^/]+\.ya?ml$|^scripts\/ops\/install[^/]*\.sh$/.test(file));
  const problems = ownershipProblems(manifest, paths.map((file) => [file, readFileSync(join(ROOT, file), "utf8")]));
  if (problems.length) {
    for (const problem of problems) console.error(problem);
    process.exitCode = 1;
  } else console.log(`Scheduled worker owners: ${Object.keys(manifest.workerJobs).length} jobs, ${paths.length} trigger files checked.`);
}
