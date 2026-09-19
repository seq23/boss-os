#!/usr/bin/env node
/**
 * MONIQUE CAN READ spry.vc. SHE CAN NEVER SEND FROM IT.
 *
 * ─── Her words, 9 September 2026 ────────────────────────────────────────────
 *
 *   "monique can read spry.vc she just cant send from it"
 *
 * `staylor@spry.vc` is her mailbox at Rainmaker Securities, a FINRA-registered broker-dealer. Mail
 * leaving that address is mail from a registered representative of a broker-dealer to counterparties
 * in a live market. Boss OS reading it is a private convenience; Boss OS WRITING from it would be an
 * unsupervised communication from a regulated person, and no feature is worth that.
 *
 * ─── This is already true. That is exactly why it needs a guard. ───────────
 *
 * Three separate things currently make it impossible, and none of them is written down anywhere a
 * person changing this code would look:
 *
 *   1. The service account holds `gmail.readonly` and no send scope. Domain-wide delegation grants
 *      scopes explicitly and none of them can send.
 *   2. `spry.vc` is not a verified domain in either Resend account, so a send would 403.
 *   3. `notify.mjs` maps every employee onto `sequoiataylor.com`, with `westpeek.ventures` as a
 *      last resort, and refuses a name that is not on the roster.
 *
 * A RULE THAT LIVES ONLY IN THOSE THREE PLACES HAS A SIX-MONTH EXPIRY. Somebody adds a domain in
 * Resend to fix an unrelated bounce; somebody widens a scope to make a different job work; somebody
 * copies a sender line. Each of those is a small, reasonable change, and any one of them turns a
 * structural impossibility into a one-character mistake. So the rule is asserted on every build,
 * against the code, rather than remembered.
 *
 * ─── What counts as sending ────────────────────────────────────────────────
 *
 * Not "the string spry.vc appears". It appears throughout this repository and must — it is the
 * mailbox being read, the calendar being subscribed to, and the Workspace in half the migration
 * notes. THE TEST IS WHETHER IT IS BOUND TO AN OUTBOUND IDENTITY OR A WRITE SCOPE:
 *
 *   · a `from` field, a `sendersFor` roster entry, or a Resend/SMTP envelope carrying it
 *   · a Gmail write scope anywhere — `gmail.send`, `gmail.compose`, `gmail.modify`,
 *     `mail.google.com` — which would make sending possible even with no sender line yet.
 *     ONE EXCEPTION, NARROWED TO THE BONE (owner, 19 September 2026: "it should never send — the
 *     green button should be to create the draft"): `src/worker/boss/wealth/gmailDraft.ts` may hold
 *     `gmail.compose`, and ONLY `gmail.compose`, and ONLY while it names no send endpoint. The
 *     grant behind it is compose, not send, and the file is checked for `messages/send`,
 *     `drafts/send`, `.send(`, `gmail.send` and `gmail.modify` on every build. A draft in her own
 *     mailbox is not a communication from a regulated person; the moment this file could send one,
 *     the build fails.
 *   · a `reply_to` on that domain, which is an invitation to a reply that lands in a mailbox
 *     nothing here is allowed to answer from
 *
 * RULE 0: FINDING NO REFERENCE AT ALL IS A FAILURE, NOT A PASS. If this scan stops seeing `spry.vc`
 * anywhere, the mailbox has been renamed or moved and this guard is now watching an empty room
 * while the real one is unguarded.
 *
 *   node scripts/validate/spry-vc-never-sends.mjs
 *   node scripts/validate/spry-vc-never-sends.mjs --self-test
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DOMAIN = "spry.vc";
/** The one module that may hold gmail.compose. See the header. */
const DRAFT_MODULE = "src/worker/boss/wealth/gmailDraft.ts";

/** Drop comments and doc prose so a rule can be DESCRIBED in a file without the scan reading it as code. */
function stripProse(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

/** Where executable code lives. Migrations and docs describe the mailbox and cannot send from it. */
const SCAN_DIRS = ["scripts", "src"];
const SKIP = new Set(["node_modules", ".git", "dist", "build", ".wrangler", "coverage"]);

function sources() {
  const out = {};
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx|js|jsx|mjs|cjs|sh|md)$/.test(e.name)) continue;
      // This file's own self-test fixtures are deliberately-violating strings. Scanning them would
      // make the guard fail on its own proof that it works.
      if (e.name === "spry-vc-never-sends.mjs") continue;
      if (statSync(full).size > 2_000_000) continue;
      out[relative(ROOT, full)] = readFileSync(full, "utf8");
    }
  };
  for (const d of SCAN_DIRS) walk(join(ROOT, d));
  return out;
}

/**
 * The checks, pure over { relativePath: source }, so the self-test drives exactly the same code the
 * real scan does. A validator whose self-test exercises a different function proves nothing.
 */
export function violations(files) {
  const bad = [];
  let mentions = 0;

  /** An outbound identity: a from/reply_to/sender/envelope field carrying the domain. */
  const OUTBOUND_FIELD = new RegExp(
    String.raw`\b(from|reply_?to|sender|envelope_?from|mail_?from|return_?path)\b\s*[:=]\s*` +
    String.raw`[^\n;,)}]{0,120}` + DOMAIN.replace(".", "\\."),
    "i",
  );
  /** `<something@spry.vc>` inside an RFC-5322 display-name envelope is a sender line by construction. */
  const ENVELOPE = new RegExp(String.raw`<[^>\s]+@` + DOMAIN.replace(".", "\\.") + String.raw`>`, "i");
  /** Any Gmail scope that can write. Sending becomes possible the moment one of these is asked for. */
  const WRITE_SCOPE = /gmail\.send|gmail\.compose|gmail\.modify|mail\.google\.com|auth\/gmail\.insert/i;
  /** Wider than compose: the scopes the draft module may never ask for. */
  const WIDER_THAN_COMPOSE = /gmail\.send|gmail\.modify|mail\.google\.com|auth\/gmail\.insert/i;
  /** Every shape a Gmail send takes: the two REST endpoints and a client-library `.send(`. */
  const SEND_ENDPOINT = /messages\/send|drafts\/[^"'`\s]*\/send|drafts\.send|messages\.send|\.send\s*\(/i;
  const DOMAIN_RE = new RegExp(DOMAIN.replace(".", "\\."), "i");

  for (const [rel, src] of Object.entries(files)) {
    const hasDomain = DOMAIN_RE.test(src);
    if (hasDomain) mentions += 1;

    /*
     * THE WRITE-SCOPE CHECK IS SCOPED TO IMPERSONATION, AND THE NARROWING IS THE POINT.
     *
     * The first version failed on `src/worker/effects/googleClient.ts`, which does hold
     * `gmail.send`. That is the West Peek chassis's partner path: a person completes an OAuth
     * consent for THEIR OWN account and mail goes out as them. It cannot reach spry.vc — user
     * consent is not domain-wide delegation, and nobody at spry.vc has granted it — so failing on
     * it was a false alarm, and a false alarm from a validator is worse than no validator: it sends
     * someone chasing a problem that does not exist and teaches them to ignore the next one.
     *
     * DOMAIN-WIDE DELEGATION IS THE ONLY MECHANISM BY WHICH THIS REPOSITORY COULD EVER SEND AS
     * staylor@spry.vc: a service-account JWT carrying a `sub` claim, which is precisely how the
     * mailbox is read today. So the test is exactly that mechanism — a file that impersonates a
     * Workspace user must never also ask for a scope that can write.
     */
    // CODE, NOT PROSE. A comment that names the scope in order to forbid it cannot acquire it; the
    // env declaration and the egress allowlist both describe the draft module's grant in words.
    const code = stripProse(src);
    const impersonates = /GSC_SERVICE_ACCOUNT_JSON/.test(code)
      || (/\bsub\b\s*[:,]/.test(code) && /oauth2\.googleapis\.com\/token/.test(code));
    if (rel === DRAFT_MODULE) {
      /*
       * THE ONE FILE THAT MAY COMPOSE, HELD TO A STRICTER RULE THAN EVERYTHING ELSE. It must
       * impersonate (that is its job), it must ask for compose and nothing wider, and it must
       * contain no send endpoint of any shape. Each of those is a separate named failure.
       */
      if (!impersonates) bad.push(`${rel}: is the draft module and no longer impersonates the mailbox — the draft path has moved and this guard is watching an empty room.`);
      if (!/gmail\.compose/.test(code)) bad.push(`${rel}: is the draft module and no longer asks for gmail.compose — the grant this file exists to use is gone from it.`);
      if (WIDER_THAN_COMPOSE.test(code)) bad.push(`${rel}: asks for a Gmail scope wider than compose. Compose is the whole grant; anything wider can send.`);
      if (SEND_ENDPOINT.test(code)) bad.push(`${rel}: names a send endpoint. The green button creates a draft; it never sends.`);
    } else if (impersonates && WRITE_SCOPE.test(code)) {
      bad.push(`${rel}: impersonates a Workspace user AND asks for a Gmail scope that can WRITE. `
        + `Reading ${DOMAIN} is permitted; sending from it never is.`);
    }
    // An entry on the egress allowlist or an env declaration may NAME the scope in prose; a file
    // that both impersonates and holds the scope in code is what the rule above catches.

    if (!hasDomain) continue;

    for (const line of src.split(/\r?\n/)) {
      if (!DOMAIN_RE.test(line)) continue;
      // A line that is prose about the prohibition is not a violation of it. This validator's own
      // header, and the headers of the scripts it guards, say the domain and the word "from" in the
      // same sentence on purpose.
      if (/^\s*(\*|\/\/|#|--)/.test(line)) continue;
      if (OUTBOUND_FIELD.test(line)) {
        bad.push(`${rel}: binds ${DOMAIN} to an outbound identity — ${line.trim().slice(0, 120)}`);
      } else if (ENVELOPE.test(line)) {
        bad.push(`${rel}: carries a ${DOMAIN} sender envelope — ${line.trim().slice(0, 120)}`);
      }
    }
  }
  return { bad, mentions };
}

/**
 * The roster in notify.mjs is the ONE place an employee becomes an address, so it is asserted
 * directly rather than only pattern-matched. Every Boss OS employee writes from sequoiataylor.com.
 */
export function rosterViolations(notify) {
  const bad = [];
  if (!notify) return ["scripts/ops/notify.mjs is missing — the one place a sender identity is decided no longer exists."];
  if (new RegExp(String.raw`<\$\{[^}]+\}@` + DOMAIN.replace(".", "\\.")).test(notify) || notify.includes(`@${DOMAIN}>`)) {
    bad.push(`scripts/ops/notify.mjs: an employee can now be addressed at ${DOMAIN}.`);
  }
  if (!/sequoiataylor\.com/.test(notify)) {
    bad.push("scripts/ops/notify.mjs: no longer sends from sequoiataylor.com. Boss OS employees write from that domain and nowhere else.");
  }
  return bad;
}

// ─── Self-test ───────────────────────────────────────────────────────────────

if (process.argv.includes("--self-test")) {
  const cases = [
    ["a from field on the domain",
     { "scripts/ops/x.mjs": 'const payload = { from: "Monique <monique@spry.vc>", to };' }, true],
    ["an envelope on the domain",
     { "scripts/ops/x.mjs": 'send("Monique · Boss OS <monique@spry.vc>");' }, true],
    ["a reply_to on the domain",
     { "scripts/ops/x.mjs": 'reply_to: "staylor@spry.vc",' }, true],
    ["an impersonating script that acquires a send scope",
     { "scripts/ops/x.mjs": 'const creds = JSON.parse(process.env.GSC_SERVICE_ACCOUNT_JSON);\nconst S = "https://www.googleapis.com/auth/gmail.send";' }, true],
    ["a partner OAuth send path that cannot impersonate, which is allowed",
     { "src/worker/effects/googleClient.ts": 'export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";' }, false],
    ["reading it, which is allowed",
     { "scripts/ops/x.mjs": 'const creds = JSON.parse(process.env.GSC_SERVICE_ACCOUNT_JSON);\nconst MAILBOX = "staylor@spry.vc";\nconst SCOPE = "https://www.googleapis.com/auth/gmail.readonly";' }, false],
    ["prose about the rule, which is allowed",
     { "scripts/ops/x.mjs": ' * NEVER SEND FROM spry.vc — she can read staylor@spry.vc and never write from it.\nconst MAILBOX = "staylor@spry.vc";' }, false],
    ["the draft module, composing and naming only drafts.create, which is allowed",
     { "src/worker/boss/wealth/gmailDraft.ts": 'const S = "https://www.googleapis.com/auth/gmail.compose";\nconst claims = { iss, sub: mailbox, aud: "https://oauth2.googleapis.com/token" };\nawait fetchImpl("https://gmail.googleapis.com/gmail/v1/users/me/drafts", { method: "POST" });' }, false],
    ["the draft module growing a messages.send call",
     { "src/worker/boss/wealth/gmailDraft.ts": 'const S = "https://www.googleapis.com/auth/gmail.compose";\nconst claims = { iss, sub: mailbox, aud: "https://oauth2.googleapis.com/token" };\nawait fetchImpl("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST" });' }, true],
    ["the draft module growing a drafts.send call",
     { "src/worker/boss/wealth/gmailDraft.ts": 'const S = "https://www.googleapis.com/auth/gmail.compose";\nconst claims = { iss, sub: mailbox, aud: "https://oauth2.googleapis.com/token" };\nawait fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${id}/send`);' }, true],
    ["the draft module asking for gmail.send beside compose",
     { "src/worker/boss/wealth/gmailDraft.ts": 'const S = "https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.send";\nconst claims = { iss, sub: mailbox, aud: "https://oauth2.googleapis.com/token" };' }, true],
    ["the draft module whose prose mentions send is still clean — only code counts",
     { "src/worker/boss/wealth/gmailDraft.ts": '/* no users.messages.send here, and no drafts.send */\nconst S = "https://www.googleapis.com/auth/gmail.compose";\nconst claims = { iss, sub: mailbox, aud: "https://oauth2.googleapis.com/token" };' }, false],
    ["ANY OTHER impersonating file asking for compose",
     { "src/worker/boss/routes/wealth.ts": 'const S = "https://www.googleapis.com/auth/gmail.compose";\nconst claims = { iss, sub: mailbox, aud: "https://oauth2.googleapis.com/token" };' }, true],
  ];
  let failed = 0;
  for (const [name, files, shouldCatch] of cases) {
    const caught = violations(files).bad.length > 0;
    if (caught !== shouldCatch) { console.error(`  ✗ self-test: ${name} — expected ${shouldCatch ? "caught" : "clean"}`); failed += 1; }
    else console.log(`  ✓ ${name}`);
  }
  const rosterCaught = rosterViolations('const ROSTER = { monique: "monique" };\nreturn [{ from: `${label} <${local}@spry.vc>` }];').length > 0;
  if (!rosterCaught) { console.error("  ✗ self-test: a roster mapping onto spry.vc was not caught"); failed += 1; }
  else console.log("  ✓ a roster mapping onto spry.vc");
  if (failed) { console.error(`SPRY SENDER SELF-TEST FAILED (${failed})`); process.exit(1); }
  console.log("SPRY SENDER SELF-TEST PASSED");
  process.exit(0);
}

// ─── The real scan ───────────────────────────────────────────────────────────

const files = sources();
if (!(DRAFT_MODULE in files)) {
  console.error(`SPRY SENDER SCAN FAILED — ${DRAFT_MODULE} is missing. The one file allowed to compose has moved or gone; the exception must move with it or be removed.`);
  process.exit(2);
}
if (Object.keys(files).length === 0) {
  console.error(`SPRY SENDER SCAN FAILED — examined 0 files under ${SCAN_DIRS.join(", ")}.`);
  process.exit(2);
}

const { bad, mentions } = violations(files);
const notify = files["scripts/ops/notify.mjs"] ?? null;
bad.push(...rosterViolations(notify));

/*
 * RULE 0. A scan that finds no reference to the mailbox is not a clean repository — it is a scan
 * pointed at the wrong place, standing guard over an empty room.
 */
if (mentions === 0) {
  console.error(`SPRY SENDER SCAN FAILED — ${DOMAIN} appears in no source file at all.`);
  console.error("  The brokerage mailbox has been renamed or moved. This guard is now watching");
  console.error("  nothing while the real mailbox is unguarded. Point it at the new name deliberately.");
  process.exit(2);
}

if (bad.length) {
  console.error(`SPRY SENDER SCAN FAILED — ${bad.length} violation(s):`);
  for (const v of bad) console.error(`  ✗ ${v}`);
  console.error(`\n  "monique can read ${DOMAIN} she just cant send from it".`);
  console.error("  It is her mailbox at a FINRA-registered broker-dealer. Reading it is a private");
  console.error("  convenience; writing from it is an unsupervised communication from a regulated");
  console.error("  person. Send as monique@sequoiataylor.com through scripts/ops/notify.mjs.");
  process.exit(1);
}

console.log(`SPRY SENDER SCAN PASSED: ${DOMAIN} is referenced by ${mentions} source file(s), `
  + "every one of them reading it; no outbound identity, no envelope and no Gmail write scope anywhere.");
