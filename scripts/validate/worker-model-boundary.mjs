#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../..", import.meta.url));
const jobDirs = [
  "scripts/ops", "scripts/brains", "scripts/lib", "scripts/outreach", "scripts/sync-agent",
  "src/worker/boss/capital", "src/worker/boss/cron", "src/worker/boss/duties",
  "src/worker/boss/health", "src/worker/boss/lp", "src/worker/boss/outreach", "src/worker/boss/practice",
  "src/shared/boss/capital", "src/shared/boss/duties", "src/shared/boss/lp", "src/shared/boss/outreach",
];
const boundaryFile = new URL("./worker-model-exceptions.json", import.meta.url);
const modelSdk = /^(?:ai|openai|ollama|@anthropic-ai\/sdk|@google\/(?:genai|generative-ai)|@google-cloud\/vertexai|@openrouter\/sdk|@ai-sdk\/[^/]+|@aws-sdk\/client-bedrock-runtime)(?:\/|$)/;
const routerImport = /(?:^|\/)router(?:\/(?:index|route|backends|anthropic|openai|gemini|workersAi|fireworks|openrouter)(?:\.[cm]?[jt]s)?)?$/;
const modelEndpoint = /(?:https?:\/\/|^)(?:api\.(?:openai\.com|anthropic\.com|perplexity\.ai|fireworks\.ai)|generativelanguage\.googleapis\.com|openrouter\.ai)(?:[/:]|$)|\/ai\/run(?:\/|$)/i;
const providerRequest = (url) => modelEndpoint.test(url) && !/\/api\/v1\/credits(?:[?#]|$)/.test(url);
const cli = /(?:^|\/)(?:claude|codex|ai-run)(?:\.exe)?$/;
const childProcessCall = /^(?:exec|execSync|execFile|execFileSync|spawn|spawnSync|fork|run|runSpawn|spawnImpl)$/;

function jsEdges(file, code) {
  const edges = [];
  const parsed = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  const literal = (node) => node && (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node))
    ? (ts.isTemplateExpression(node) ? node.head.text + node.templateSpans.map((span) => span.literal.text).join("") : node.text)
    : "";
  const access = (node) => {
    if (ts.isPropertyAccessExpression(node)) return `${access(node.expression)}.${node.name.text}`;
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
      return `${access(node.expression)}.${node.argumentExpression.text}`;
    }
    return node.getText(parsed);
  };
  const command = (node) => {
    const value = literal(node);
    return cli.test(value) || /^(?:claude|codex|ai-run)\s/.test(value)
      ? value.split(/\s+/)[0].split("/").at(-1) : null;
  };
  const constants = new Map();
  const declare = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      constants.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, declare);
  };
  declare(parsed);
  const resolve = (node, matches, seen = new Set()) => {
    if (!node || seen.has(node)) return null;
    seen.add(node);
    return matches(node)
      ?? (ts.isIdentifier(node) ? resolve(constants.get(node.text), matches, seen) : null)
      ?? (ts.isBinaryExpression(node) ? resolve(node.left, matches, seen) ?? resolve(node.right, matches, seen) : null)
      ?? (ts.isCallExpression(node) && /(?:^|\.)join$/.test(node.expression.getText(parsed))
        ? resolve(node.arguments.at(-1), matches, seen) : null)
      ?? (ts.isTemplateExpression(node) ? node.templateSpans.map(({ expression }) => resolve(expression, matches, seen)).find(Boolean) : null);
  };
  const importEdge = (name) => {
    if (modelSdk.test(name) || routerImport.test(name) || /(?:^|\/)(?:sync-agent\/runner|codex-seat)(?:\.mjs)?$/.test(name)) {
      edges.push(`import ${name}`);
    }
  };
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly)
      || (ts.isExportDeclaration(node) && !node.isTypeOnly)) importEdge(literal(node.moduleSpecifier));
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const target = access(node.expression);
      const arg = node.arguments?.[0];
      if (target === "import" || target === "require") importEdge(literal(arg));
      if (childProcessCall.test(target.split(".").at(-1))) {
        const binary = resolve(arg, command);
        if (binary) edges.push(`command ${binary}`);
      }
      if (/^(?:routeCompletion|askClaudeJson|defaultExecutor)$|(?:^|\.)AI\s*\.\s*run$|\bAGENT_EXECUTORS\[/.test(target)) {
        edges.push(`call ${target}`);
      }
      if (/(?:^|\.)(?:fetch|fetchImpl|request|axios|post|URL)$/.test(target)) {
        const url = [arg, ...(target === "post" ? [node.arguments?.[1]] : [])]
          .map((candidate) => resolve(candidate, (part) => providerRequest(literal(part)) ? literal(part) : null)).find(Boolean);
        if (url) edges.push(`endpoint ${url}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return edges;
}

function shellEdges(code) {
  const edges = [];
  for (const raw of code.split("\n")) {
    if (/^\s*#/.test(raw)) continue;
    const expansions = [];
    // Keep quoted executable names, variables and URLs. Other quoted words are arguments, so
    // punctuation inside a log message cannot introduce a second command.
    const line = raw.replace(/"(?:\\.|[^"\\])*"|'[^']*'/g, (quoted) => {
      const value = quoted.slice(1, -1);
      if (quoted.startsWith('"')) {
        for (const match of value.matchAll(/(?<!\\)\$\(([^()]*)\)/g)) expansions.push(match[1]);
      }
      if (cli.test(value) || /^\$\{?[A-Z_][A-Z_0-9]*\}?$/.test(value) || /^https?:\/\/\S+$/.test(value)) return quoted;
      return '"_"';
    });
    for (const expansion of expansions) edges.push(...shellEdges(expansion));
    for (const match of line.matchAll(/(?:^\s*|[|;&(]\s*|\b(?:exec|env|xargs)\s+|\btimeout\s+\S+\s+|(?:^|\s)[A-Z_][A-Z_0-9]*=[^\s]+\s+)(?:"|')?(?:(?:[^\s"'$|;&()]+\/)*(claude|codex|ai-run)|\$\{?((?:[A-Z_]+_)?(?:CLAUDE|CODEX|AI_RUN)(?:_BIN)?)\}?)(?:"|')?(?=\s|$|[;&|)])/g)) {
      edges.push(`command ${match[1] ?? "$" + match[2]}`);
    }
    for (const match of line.matchAll(/(?:curl|wget)\s+[^#\n]*?(https?:\/\/[^\s"']+)/g)) {
      if (providerRequest(match[1])) edges.push(`endpoint ${match[1]}`);
    }
  }
  return edges;
}

function check(file, code, known = [], checkStale = false) {
  const remaining = [...known];
  const extra = (file.endsWith(".sh") ? shellEdges(code) : jsEdges(file, code)).flatMap((edge) => {
    const i = remaining.indexOf(edge);
    if (i < 0) return [`${file}: ${edge}`];
    remaining.splice(i, 1);
    return [];
  });
  return checkStale ? extra.concat(remaining.map((edge) => `${file}: remove unused exception for ${edge}`)) : extra;
}

if (process.argv.includes("--self-test")) {
  const clean = `import { readWorkerSource } from "../router/freeModel.ts";
    // A comment can describe invoking claude.
    const help = "Read the documentation for https://api.openai.com/v1/responses";
    await readWorkerSource(input, env);`;
  const violations = [
    [".ts", 'import Service from "@google/genai"'],
    [".mjs", 'await import("../router/gemini.ts")'],
    [".ts", 'import { WIRING_BY_PROVIDER } from "../router/backends"'],
    [".mjs", 'spawn("claude", ["--print", instruction])'],
    [".mjs", 'const seat = process.env.SEAT ?? "claude"; spawn(seat, ["--print", instruction])'],
    [".mjs", 'await env.AI.run(slug, payload)'],
    [".mjs", 'await env["AI"]["run"](slug, payload)'],
    [".mjs", 'await fetch("https://api.openai.com/v1/responses")'],
    [".sh", 'echo "$input" | /opt/local/bin/codex exec'],
    [".sh", 'SEAT="$seat" "$AI_RUN" --role brain'],
  ];
  if (check("worker.ts", clean).length || check("logger.sh", 'echo "For troubleshooting; claude is optional"').length
      || violations.some(([ext, code]) => !check("worker" + ext, code).length)
      || !check("worker.mjs", 'spawn("claude", []); spawn("claude", ["--print", prompt]);', ["command claude"]).length) {
    throw new Error("Worker model boundary fixtures failed");
  }
  console.log("Worker model boundary fixtures passed");
} else {
  const exceptions = JSON.parse(readFileSync(boundaryFile, "utf8"));
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...jobDirs], { cwd: root, encoding: "utf8" })
    .split("\0").filter((file) => /\.(?:[cm]?[jt]sx?|sh)$/.test(file) && !/\.d\.[cm]?ts$/.test(file) && existsSync(root + "/" + file));
  if (!files.length) throw new Error("No worker job sources found");
  const scanned = new Set(files);
  const violations = Object.entries(exceptions).flatMap(([file, entry]) =>
    scanned.has(file) && entry.reason && entry.edges?.length ? [] : [`${file}: invalid or stale exception`]);
  violations.push(...files.flatMap((file) => check(file, readFileSync(root + "/" + file, "utf8"), exceptions[file]?.edges, true)));
  if (violations.length) {
    console.error("Worker model calls must use readWorkerSource:\n" + violations.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(`Worker model boundary passed (${files.length} sources).`);
  }
}
