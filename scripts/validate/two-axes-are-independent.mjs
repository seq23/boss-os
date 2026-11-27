#!/usr/bin/env node
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");

const files = {
  router: read("src/worker/boss/router/index.ts"),
  policy: read("src/worker/boss/router/policy.ts"),
  vendor: read("src/worker/boss/router/modelAccess.ts"),
  queue: read("src/worker/boss/queue/consumer.ts"),
  research: read("src/worker/boss/queue/freeRung.ts"),
  intake: read("src/worker/boss/intake/firstRead.ts"),
};

function problems(sources) {
  const forbidden = /private_model_only|scanForModelAccess|privateLexicon|FUND_INSTRUMENT_PATTERNS|DEAL_TERM_PATTERNS|AMBIGUOUS_TERM_PATTERNS/;
  const failures = Object.entries(sources)
    .filter(([, source]) => !source.trim() || forbidden.test(source))
    .map(([file]) => `${file}: source is empty or still carries the retired model routing rule`);
  if (/\baudience\s*\??:/.test(sources.policy)) failures.push("Model eligibility reads the recipient approval axis");
  return failures;
}

const failures = problems(files);
if (process.argv.includes("--self-test")) {
  if (!problems({ ...files, policy: files.policy + '\nconst refusal = "private_model_only";' }).length) failures.push("Missed the retired rule");
  if (!problems({ ...files, policy: files.policy + '\ninterface Context { audience: string }' }).length) failures.push("Missed the recipient field");
  if (!problems({ ...files, intake: "" }).length) failures.push("Missed an empty source");
}
for (const failure of failures) console.error(failure);
if (failures.length) process.exitCode = 1;
else console.log("Boss OS router, policy, vendor, queue, research and intake have no private model lane. Recipient labels stay outside eligibility.");
