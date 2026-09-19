#!/usr/bin/env node
/**
 * THE GREEN BUTTON ON AN INBOX LETTER MAKES A DRAFT. NOTHING ON THAT PATH CAN SEND.
 *
 * ─── Her words, 19 September 2026 ────────────────────────────────────────────
 *
 *   "it should never send — the green button should be to create the draft."
 *
 * The primary action on a letter card in the Inbox is "Create the draft in my Gmail". There is no
 * send action on the card, and the code the card reaches — the decide route, the resume handler,
 * the draft module, the desk routes — imports no transport and names no send endpoint.
 *
 * ─── Why a validator and not a comment ───────────────────────────────────────
 *
 * The chassis this repository was cloned from carries three working email transports
 * (`effects/resendClient.ts`, `effects/cloudflareEmailClient.ts`, `effects/emailTransport.ts`) and
 * an OAuth client holding `gmail.send`. All four are one import away from the inbox path, and an
 * import is a one-line change nobody reviews as a policy decision. This scan makes it one.
 *
 * ─── What it checks ──────────────────────────────────────────────────────────
 *
 *   1. THE CARD. `JudgementDocket.tsx` renders exactly ONE primary (`btn-approve`) button for a
 *      letter, its label says "draft", and no button label on the card is a send verb.
 *   2. THE PATH. None of the files the card reaches imports a transport or the OAuth send client,
 *      and none names `messages/send`, `drafts/…/send`, `drafts.send`, `messages.send` or
 *      `email.send` in code (prose stripped).
 *   3. RULE 0. Every file on the path must exist and the card must yield at least one label. A scan
 *      that read nothing passes nothing.
 *
 *   node scripts/validate/the-inbox-draft-never-sends.mjs
 *   node scripts/validate/the-inbox-draft-never-sends.mjs --self-test
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const CARD = "src/client/boss/components/JudgementDocket.tsx";

/** Every file her press on the card can reach before it touches Gmail. */
export const PATH_FILES = [
  CARD,
  "src/client/boss/pages/Inbox.tsx",
  "src/client/boss/components/Docket.tsx",
  "src/worker/boss/routes/approvals.ts",
  "src/worker/boss/approvals/execute.ts",
  "src/worker/boss/approvals/resume.ts",
  "src/worker/boss/wealth/gmailDraft.ts",
  "src/worker/boss/routes/wealth.ts",
];

const TRANSPORT_IMPORT = /from\s+["'][^"']*(effects\/(emailTransport|resendClient|cloudflareEmailClient|googleClient))["']/;
const SEND_IN_CODE = /messages\/send|drafts\/[^"'`\s]*\/send|drafts\.send|messages\.send|["'`]email\.send["'`]|GMAIL_SEND_SCOPE|gmail\.send/i;
/** A button whose label is a send verb. "sends nothing" in prose is not a label; this reads labels only. */
const SEND_LABEL = /^\s*(send( it| this| now| the letter)?|i sent it)\s*$/i;

function stripProse(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ").replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");
}

/**
 * The labels of every `<button …>…</button>` in a TSX source, with JSX expressions reduced to their
 * string literals so `{busy ? "Creating…" : "Create the draft in my Gmail"}` yields both strings.
 * Returns [{ primary: boolean, labels: string[] }].
 */
export function buttons(tsx) {
  const out = [];
  const re = /<button\b([^>]*)>([\s\S]*?)<\/button>/g;
  let m;
  while ((m = re.exec(tsx))) {
    const attrs = m[1];
    const inner = m[2];
    const primary = /className=["'`][^"'`]*\bbtn-approve\b/.test(attrs) || /className=\{`[^`]*\bbtn-approve\b/.test(attrs);
    const literals = [...inner.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    const plain = inner.replace(/\{[\s\S]*?\}/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const labels = [...literals, ...(plain ? [plain] : [])].filter(Boolean);
    out.push({ primary, labels });
  }
  return out;
}

/** Pure over { relativePath: source } so the self-test drives the exact code the scan does. */
export function violations(files) {
  const bad = [];
  for (const rel of PATH_FILES) {
    if (!(rel in files)) {
      bad.push(`${rel}: is on the inbox draft path and is missing. Rule 0 — a path this scan cannot read is a path it cannot vouch for.`);
    }
  }
  if (bad.length) return { bad, labels: 0 };

  // 1 · The card.
  const card = files[CARD];
  const cardButtons = buttons(card);
  const allLabels = cardButtons.flatMap((b) => b.labels);
  if (allLabels.length === 0) bad.push(`${CARD}: the scan found no button labels on the card. Rule 0 — nothing was examined.`);
  for (const label of allLabels) {
    if (SEND_LABEL.test(label)) bad.push(`${CARD}: a button on the inbox card is labelled "${label}". The card creates a draft; it never sends.`);
  }
  const primaries = cardButtons.filter((b) => b.primary);
  /*
   * ONE primary per rendered card. The component renders the primary inside ONE branch (the
   * not-asking branch), so the source holds exactly one `btn-approve` button; two would mean two
   * green buttons could appear together, and a reader cannot tell which is the act.
   */
  if (primaries.length !== 1) {
    bad.push(`${CARD}: expected exactly one primary (btn-approve) button in the source, found ${primaries.length}.`);
  } else {
    const labels = primaries[0].labels;
    const draftLabel = labels.find((l) => /\bdraft\b/i.test(l));
    if (!draftLabel) bad.push(`${CARD}: the primary button's labels [${labels.map((l) => `"${l}"`).join(", ")}] never say "draft". Her words: the green button should be to create the draft.`);
    /*
     * THE LETTER BRANCH MUST BE THE DRAFT, and the non-letter branch may keep its own words. The
     * label expression is `judgement?.letter ? "…draft…" : "…"`; the first string literal after
     * `letter ?` is the letter's label, and it is the one that must say draft.
     */
    const letterLabel = /letter\s*\?\s*"([^"]+)"/.exec(stripProse(card))?.[1];
    if (!letterLabel || !/\bdraft\b/i.test(letterLabel)) {
      bad.push(`${CARD}: the label the card shows for a LETTER is "${letterLabel ?? "(not found)"}" and it does not say draft.`);
    }
  }

  // 2 · The path.
  for (const rel of PATH_FILES) {
    const code = stripProse(files[rel]);
    if (TRANSPORT_IMPORT.test(code)) bad.push(`${rel}: imports an email transport or the OAuth send client. The inbox path may not reach a sender.`);
    if (SEND_IN_CODE.test(code)) bad.push(`${rel}: names a send endpoint or a send scope in code. The green button creates a draft; it never sends.`);
  }
  return { bad, labels: allLabels.length };
}

// ─── Self-test ───────────────────────────────────────────────────────────────

const CLEAN_CARD = `export function JudgementDocket() {
  return (<article>
    {asking ? (<div className="decide">
      <button className="btn btn-reject" onClick={() => decide("rejected", note)}>{busy ? "Sending back…" : "Send it back"}</button>
      <button className="btn btn-defer">Cancel</button>
    </div>) : (<div className="decide">
      <button className="btn btn-approve" onClick={() => decide("approved")}>
        {busy === "approved" ? "Creating the draft…" : judgement?.letter ? "Create the draft in my Gmail" : "Approve — carry on and finish"}
      </button>
      <button className="btn btn-reject" onClick={() => setAsking(true)}>Try again</button>
    </div>)}
  </article>);
}`;
const CLEAN_PATH = Object.fromEntries(PATH_FILES.map((f) => [f, `// ${f}\nexport const ok = 1;`]));
CLEAN_PATH[CARD] = CLEAN_CARD;

if (process.argv.includes("--self-test")) {
  const withCard = (card) => ({ ...CLEAN_PATH, [CARD]: card });
  const cases = [
    ["a clean card and a clean path", CLEAN_PATH, false],
    ["a card with a send button", withCard(CLEAN_CARD.replace('<button className="btn btn-defer">Cancel</button>', '<button className="btn btn-defer">Send it</button>')), true],
    ["a card whose letter label does not say draft", withCard(CLEAN_CARD.replace('"Create the draft in my Gmail"', '"Approve — it is ready to send"')), true],
    ["a card with two primary buttons", withCard(CLEAN_CARD.replace('<button className="btn btn-reject" onClick={() => setAsking(true)}>Try again</button>', '<button className="btn btn-approve">Try again</button>')), true],
    ["a card with no buttons at all (Rule 0)", withCard("export function JudgementDocket() { return <article/>; }"), true],
    ["the draft module importing the Resend transport", { ...CLEAN_PATH, "src/worker/boss/wealth/gmailDraft.ts": 'import { sendEmail } from "../../effects/resendClient";' }, true],
    ["the resume handler importing the OAuth client that holds gmail.send", { ...CLEAN_PATH, "src/worker/boss/approvals/resume.ts": 'import { GMAIL_SEND_SCOPE } from "../../effects/googleClient";' }, true],
    ["the draft module naming messages.send in code", { ...CLEAN_PATH, "src/worker/boss/wealth/gmailDraft.ts": 'await fetchImpl("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");' }, true],
    ["the draft module naming a send endpoint in prose only, which is allowed", { ...CLEAN_PATH, "src/worker/boss/wealth/gmailDraft.ts": '/* there is no users.messages.send here */\nexport const ok = 1;' }, false],
    ["a file on the path missing (Rule 0)", Object.fromEntries(Object.entries(CLEAN_PATH).filter(([k]) => k !== "src/worker/boss/routes/wealth.ts")), true],
  ];
  let failed = 0;
  for (const [name, files, shouldCatch] of cases) {
    const caught = violations(files).bad.length > 0;
    if (caught !== shouldCatch) { console.error(`  ✗ self-test: ${name} — expected ${shouldCatch ? "caught" : "clean"}`); failed += 1; }
    else console.log(`  ✓ ${name}`);
  }
  if (failed) { console.error(`INBOX DRAFT SELF-TEST FAILED (${failed})`); process.exit(1); }
  console.log("INBOX DRAFT SELF-TEST PASSED");
  process.exit(0);
}

// ─── The real scan ───────────────────────────────────────────────────────────

const files = {};
for (const rel of PATH_FILES) {
  const full = join(ROOT, rel);
  if (existsSync(full)) files[rel] = readFileSync(full, "utf8");
}
const { bad, labels } = violations(files);
if (bad.length) {
  console.error(`INBOX DRAFT SCAN FAILED — ${bad.length} violation(s):`);
  for (const b of bad) console.error(`  ✗ ${b}`);
  console.error('\n  "it should never send — the green button should be to create the draft." (19 Sep 2026)');
  process.exit(1);
}
console.log(`INBOX DRAFT SCAN PASSED: ${PATH_FILES.length} files on the inbox draft path reach no sender; the card's ${labels} button labels include one primary, and it makes a draft.`);
