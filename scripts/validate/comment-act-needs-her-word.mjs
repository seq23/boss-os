#!/usr/bin/env node
/**
 * NO COMMENT IS HIDDEN OR ANSWERED AS THE CHANNEL WITHOUT AN INSTRUCTION ROW THAT IS HERS.
 *
 * ─── What the lane promises ─────────────────────────────────────────────────
 *
 * Monique reads the channel's comments and proposes; Sequoia decides; Monique acts. The act half on
 * the Mac hands how-we-know's `loop/comments.py act` an instruction file, and that file must come
 * from ONE feed — rows that carry her verified word — or the lane is a bot that moderates a public
 * channel on its own initiative. Four facts hold that promise up, and this checks each one over
 * the code as written, not over a description of it:
 *
 *   1. The mailbox writes an instruction only BELOW its verified-sender refusal:
 *      `answerCommentWatchFromMail(` appears after `if (!authorised)` in inboundMail.ts.
 *   2. The Worker has exactly ONE writer of `instructed_at` (the mailbox's answer module), and it
 *      writes `instructed_by`, `instructed_at` and `source` together — the record how-we-know's
 *      `act` demands.
 *   3. The `/pending-instructions` feed selects `instructed_at IS NOT NULL` and `applied_at IS NULL`,
 *      and nothing else in the routes hands out an item's action.
 *   4. The Mac script reaches `act` only with rows from `/pending-instructions`, refuses a row that
 *      lacks who / when / via, and never carries a literal instruction file of its own.
 *
 * Also: `your call` is recorded as a pre-approval WITH the phrase (the parser returns it and the
 * answer module writes it into `source`), and the empty-digest path sends no email.
 *
 * RULE 0: examining zero facts is a failure. `--self-test` breaks each fact in a copy and shows
 * the check returns.
 *
 *   node scripts/validate/comment-act-needs-her-word.mjs
 *   node scripts/validate/comment-act-needs-her-word.mjs --self-test
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FILES = {
  mailbox: "src/worker/boss/intake/inboundMail.ts",
  answer: "src/worker/boss/commentWatch/answer.ts",
  routes: "src/worker/boss/routes/commentWatch.ts",
  mac: "scripts/ops/youtube-comment-watch.mjs",
  lane: "src/shared/boss/commentWatch/lane.mjs",
};
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

/** Returns a list of problems; empty means every fact holds. */
export function findings(src) {
  const problems = [];
  const mailbox = strip(src.mailbox);
  const answer = strip(src.answer);
  const routes = strip(src.routes);
  const mac = strip(src.mac);
  const lane = strip(src.lane);

  // 1. Below the refusal.
  const refusal = mailbox.indexOf("if (!authorised)");
  const call = mailbox.indexOf("answerCommentWatchFromMail(");
  if (refusal < 0) problems.push("mailbox: the verified-sender refusal `if (!authorised)` is missing");
  if (call < 0) problems.push("mailbox: never calls answerCommentWatchFromMail — her reply would write nothing");
  if (refusal >= 0 && call >= 0 && call < refusal) problems.push("mailbox: answerCommentWatchFromMail is called ABOVE the sender refusal — a stranger's mail could instruct a hide");

  // 2. One writer, and a complete record.
  const writers = [mailbox, answer, routes, mac].map((s) => (s.match(/SET[^;]*\binstructed_at\s*=/g) ?? []).length);
  const total = writers.reduce((a, b) => a + b, 0);
  if (total !== 1 || writers[1] !== 1) problems.push(`instructed_at has ${total} writer(s) across the lane; exactly one, in the answer module, is allowed`);
  const write = answer.match(/SET[^;]*\binstructed_at\s*=[^;]*/);
  if (!write || !/instructed_by\s*=/.test(write[0]) || !/\bsource\s*=/.test(write[0])) problems.push("answer: the instruction write does not set instructed_by and source beside instructed_at");
  if (!/instructed_at IS NULL/.test(write?.[0] ?? "")) problems.push("answer: the instruction write can overwrite an existing instruction (no `instructed_at IS NULL` guard)");
  if (!/pre-approved by her reply/.test(answer) || !/parsed\.phrase/.test(answer)) problems.push("answer: `your call` is not recorded as a pre-approval carrying the phrase");

  // 3. The feed.
  const feed = routes.match(/get\("\/pending-instructions"[\s\S]*?\n\}\);/);
  if (!feed) problems.push("routes: no GET /pending-instructions");
  else {
    if (!/instructed_at IS NOT NULL/.test(feed[0])) problems.push("routes: /pending-instructions does not require instructed_at IS NOT NULL");
    if (!/applied_at IS NULL/.test(feed[0])) problems.push("routes: /pending-instructions does not exclude applied rows");
    if (!/instructed_by IS NOT NULL/.test(feed[0]) || !/source IS NOT NULL/.test(feed[0])) problems.push("routes: /pending-instructions can hand out a row without who/via");
  }

  // 4. The Mac.
  if (!/\/comment-watch-items\/pending-instructions/.test(mac)) problems.push("mac: never reads /pending-instructions");
  const actAt = mac.indexOf('"act"');
  const pendAt = mac.indexOf("pending-instructions");
  if (actAt < 0) problems.push("mac: never runs act");
  if (actAt >= 0 && pendAt >= 0 && pendAt > actAt) problems.push("mac: runs act before reading the pending feed");
  if (!/INSTRUCTION_UNBACKED/.test(mac)) problems.push("mac: does not refuse a row lacking who/when/via before act");
  if (/instructed_by:\s*["'`][^"'`]+["'`]/.test(mac)) problems.push("mac: carries a literal instructed_by — an instruction invented on the Mac");
  if (/"act",\s*"--instructions",\s*"[^"]*\.json"/.test(mac)) problems.push("mac: hands act a fixed instruction file instead of the feed's rows");

  // The empty-digest rule and the reply forms.
  if (!/shouldEmail\(/.test(mac) || !/NOTHING_TO_REPORT/.test(mac)) problems.push("mac: the empty digest is not the no-email, NOTHING_TO_REPORT path");
  if (!/items\.length > 0/.test(lane)) problems.push("lane: shouldEmail does not gate on items");
  const forms = lane.match(/REPLY_FORMS\s*=\s*\[[\s\S]*?\];/)?.[0] ?? "";
  for (const form of ["`1 delete`", "`2 reply as drafted`", "`3 reply: <your words>`", "`4 ignore`", "`your call`"]) {
    if (!forms.includes(form)) problems.push(`lane: the reply forms no longer print ${form}`);
  }
  return problems;
}

function real() {
  return Object.fromEntries(Object.entries(FILES).map(([k, v]) => [k, read(v)]));
}

function main() {
  const p = findings(real());
  if (p.length) {
    console.error("FAIL: the comment lane can act without her word:");
    for (const x of p) console.error(`  ✗ ${x}`);
    process.exit(1);
  }
  console.log("COMMENT ACT NEEDS HER WORD: the mailbox instructs only below the sender refusal, instructed_at has one writer that records who/when/via, the pending feed is the only source act reads, the Mac refuses an unbacked row, `your call` is a recorded pre-approval, and an empty digest sends nothing.");
}

function selfTest() {
  const base = real();
  if (findings(base).length) { console.error("self-test: the real files should pass first"); process.exit(1); }
  const cases = [
    ["mailbox call moved above the refusal", (s) => {
      const m = s.mailbox;
      const call = m.slice(m.indexOf("  const commentAnswer"), m.indexOf("    : null;\n", m.indexOf("  const commentAnswer")) + 12);
      return { ...s, mailbox: call + m.replace(call, "") };
    }, /ABOVE the sender refusal/],
    ["mailbox never instructs", (s) => ({ ...s, mailbox: s.mailbox.replace("answerCommentWatchFromMail(", "neverCalled(") }), /never calls/],
    ["a second writer of instructed_at in the routes", (s) => ({ ...s, routes: s.routes + "\nconst x = `UPDATE comment_watch_items SET instructed_at = 1 WHERE 1`;\n" }), /2 writer/],
    ["the write drops source", (s) => ({ ...s, answer: s.answer.replace("instructed_at = ?, source = ?", "instructed_at = ?") }), /instructed_by and source/],
    ["the write can overwrite", (s) => ({ ...s, answer: s.answer.replace("AND instructed_at IS NULL", "") }), /overwrite/],
    ["your call loses its phrase", (s) => ({ ...s, answer: s.answer.replace("pre-approved by her reply", "approved") }), /pre-approval/],
    ["the feed forgets instructed_at", (s) => ({ ...s, routes: s.routes.replace("i.instructed_at IS NOT NULL AND", "") }), /require instructed_at/],
    ["the feed hands out applied rows", (s) => ({ ...s, routes: s.routes.replace("AND i.applied_at IS NULL", "") }), /exclude applied/],
    ["the Mac invents an instruction", (s) => ({ ...s, mac: s.mac.replace("instructed_by: r.instructed_by", 'instructed_by: "monique"') }), /literal instructed_by/],
    ["the Mac stops refusing unbacked rows", (s) => ({ ...s, mac: s.mac.replace("INSTRUCTION_UNBACKED", "OK") }), /refuse a row/],
    ["the Mac emails an empty digest", (s) => ({ ...s, mac: s.mac.replace(/shouldEmail\(/g, "always(").replace(/NOTHING_TO_REPORT/g, "NTR") }), /no-email/],
    ["a reply form disappears from the email", (s) => ({ ...s, lane: s.lane.replace("`your call` — Monique applies", "`whatever` — Monique applies") }), /your call/],
  ];
  let n = 0;
  for (const [name, mutate, expect] of cases) {
    const p = findings(mutate(base));
    if (!p.some((x) => expect.test(x))) { console.error(`self-test: "${name}" was not caught; got ${JSON.stringify(p)}`); process.exit(1); }
    n += 1;
  }
  if (n === 0) { console.error("self-test examined zero cases"); process.exit(1); }
  console.log(`self-test OK: ${n}/${cases.length} broken shapes caught, the real files pass.`);
}

if (process.argv.includes("--self-test")) selfTest(); else main();
