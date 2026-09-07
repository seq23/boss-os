/* Guard on the extractor's privacy claim: it must never request anything but the three headers. */
import { readFileSync } from "node:fs";
const src = readFileSync("scripts/ops/gmail-metadata.mjs", "utf8");
let fail = 0;
const must = [
  [/u\.searchParams\.set\("format", "metadata"\)/, "requests format=metadata"],
  [/for \(const h of \["From", "To", "Date", "List-Unsubscribe"\]\)/,
   "allowlists exactly From, To, Date and List-Unsubscribe — the last is a bulk-sender marker, not content"],
  [/gmail\.readonly/, "asks for a read-only scope"],
];
const mustNot = [
  [/metadataHeaders", "Subject/i, "must not request Subject"],
  [/format=full|"format", "full"/i, "must not request full messages"],
  [/\.snippet/, "must not read snippets"],
  [/gmail\.modify|gmail\.send|mail\.google\.com/, "must not ask for a write scope"],
];
for (const [re, why] of must) if (!re.test(src)) { console.error("MISSING:", why); fail = 1; }
for (const [re, why] of mustNot) if (re.test(src)) { console.error("FORBIDDEN:", why); fail = 1; }
console.log(fail ? "GMAIL EXTRACTOR SCAN FAILED" : `GMAIL EXTRACTOR SCAN PASSED: ${must.length + mustNot.length} checks.`);
process.exit(fail);
