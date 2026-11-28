#!/usr/bin/env node
/**
 * DANIELLE'S AHREFS DIGEST ON THE SHARED FREE READER (27 Nov 2026, #584 Not built).
 *
 * Ahrefs sends its Site Audit mail to her personal Gmail only: a read-only probe of every business mailbox the
 * service account reads (westpeek.ventures, time-2-read.com, spry.vc) found no Ahrefs mail in 60 days, and no
 * Ahrefs API key exists. So this reads personal Gmail through the same direct read-only grant Toni uses
 * (`TONI_GMAIL_*`, toni-mail.mjs `personalToken`), and each message is read by `readWorkerSource` as Danielle.
 * Code lists the mail, counts it and writes the digest; the model only reads what one email says.
 *
 *   npm run --silent vault:run -- node scripts/ops/ahrefs-digest.mjs --out <path>
 *
 * Exit 0 the digest is written (a week with no mail writes the SEARCHED line and NO AHREFS SITE AUDIT MAIL
 * THIS WEEK, from the real search) · 10 NAMED STOP [HER_ACCOUNT]: the read-only grant is not in the vault yet,
 * so ahrefs-audit-fix.sh keeps its connector step until it is · 3 the mailbox or the free reader failed (an
 * outage or a spent allowance): NOTHING is written, never a partial or empty digest, and the next run retries
 * · 2 bad arguments. An email the reader could not decide is listed under "Unread" with its Gmail link, and
 * the second line says how many, so the repair pass knows the week was not fully read.
 */
import { writeFileSync, renameSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dayOf } from "../../src/shared/boss/schedule/clock.mjs";
import { readWorkerSource } from "../../src/worker/boss/router/freeModel.ts";
import { readJsonObject } from "../../src/worker/boss/router/types.ts";
import { listLpTargets, lpReplyThread } from "./lp-positive.mjs";
import { messageLink } from "./lib/held-for-person.mjs";
import { personalGrantPresent, personalToken, readGmailJson } from "./lib/toni-mail.mjs";

const DAY = 86_400_000;
export const WINDOW_DAYS = 8;
export const AHREFS_QUERIES = Object.freeze([
  `from:sa@ahrefs.com newer_than:${WINDOW_DAYS}d in:anywhere`,
  `from:ahrefs.com newer_than:${WINDOW_DAYS}d in:anywhere`,
]);
export const NO_MAIL = "NO AHREFS SITE AUDIT MAIL THIS WEEK";

const INSTRUCTION = "You read ONE email from Ahrefs to the site owner and report what it says about a Site Audit. " +
  "Ahrefs sends two kinds and both count: the weekly Site Audit report, and an alert email per issue whose subject reads " +
  "'(Project) Issue name: N URLs' (for example '(Spry) 3XX redirect: 2 URLs'), which never says the words Site Audit. " +
  "Set kind to site_audit for either kind, not_site_audit for any other Ahrefs email (billing, product news, rank tracker), " +
  "and uncertain when you cannot tell. For site_audit, copy the project name, the site, the crawl date (YYYY-MM-DD) and the " +
  "health score if given, and every issue named with its URL count and severity exactly as the email says them; use empty " +
  "strings and -1 for anything the email does not say. Never infer an issue the email does not name.";

const SCHEMA = { name: "ahrefs_email", schema: { type: "object", required: ["kind", "project", "site", "crawl_date", "health_score", "issues"], properties: {
  kind: { type: "string", enum: ["site_audit", "not_site_audit", "uncertain"] },
  project: { type: "string" }, site: { type: "string" }, crawl_date: { type: "string" }, health_score: { type: "integer" },
  issues: { type: "array", items: { type: "object", required: ["name", "urls", "severity"], properties: {
    name: { type: "string" }, urls: { type: "integer" }, severity: { type: "string" },
  } } },
} } };

/** The model's answer for one email, or null when it is not in the shape asked for. Pure. */
export function parseAhrefsEmail(text) {
  const row = readJsonObject(text);
  if (!row || !["site_audit", "not_site_audit", "uncertain"].includes(row.kind) || !Array.isArray(row.issues)) return null;
  if (row.issues.some((issue) => typeof issue?.name !== "string" || !Number.isInteger(issue?.urls))) return null;
  return {
    kind: row.kind, project: String(row.project ?? ""), site: String(row.site ?? ""), crawl_date: String(row.crawl_date ?? ""),
    health_score: Number.isInteger(row.health_score) ? row.health_score : -1,
    issues: row.issues.map(({ name, urls, severity }) => ({ name, urls, severity: String(severity ?? "") })),
  };
}

/** The digest the repair pass reads: the SEARCHED line first (evidence.mjs `digestSearched`), always. Pure. */
export function renderDigest({ since, until, perQuery, messages, audits, unread }) {
  const lines = [`SEARCHED: mailbox=personal Gmail (read-only grant) since=${since} until=${until} messages=${messages} queries=${AHREFS_QUERIES.join(" | ")}`];
  if (unread.length) lines.push(`UNREAD: ${unread.length} of ${messages} email(s) the free reader could not decide; each is listed under Unread below.`);
  if (!audits.length) {
    lines.push("", NO_MAIL, ...perQuery.map(({ query, count }) => `- ${query}: ${count} email(s)`));
  } else {
    const byProject = new Map();
    for (const audit of audits) {
      const key = `${audit.project}\u0000${audit.site}`;
      if (!byProject.has(key)) byProject.set(key, []);
      byProject.get(key).push(audit);
    }
    for (const rows of byProject.values()) {
      const { project, site } = rows[0];
      lines.push("", `## ${project || "(project not named)"}${site ? ` — ${site}` : ""}`);
      for (const row of rows) {
        lines.push(`- Email "${row.subject}" (${row.date})${row.crawl_date ? `, crawl ${row.crawl_date}` : ""}${row.health_score >= 0 ? `, health score ${row.health_score}` : ""}`);
        for (const issue of row.issues) lines.push(`  - ${issue.name}: ${issue.urls} URLs${issue.severity ? ` (${issue.severity})` : ""}`);
      }
    }
  }
  if (unread.length) lines.push("", "## Unread", ...unread.map((row) => `- "${row.subject}" (${row.date}): ${row.link}`));
  return `${lines.join("\n")}\n`;
}

/**
 * Read the week's Ahrefs mail into a digest. Throws on a failed mailbox read or a read that ended without a
 * usable answer for reasons other than the model's own uncertainty, so no digest is ever written from part of
 * a week. Everything is injectable for tests.
 */
export async function buildAhrefsDigest({
  token = () => personalToken(), now = Date.now(), env = process.env,
  list = (access, query) => listLpTargets(access, query, readGmailJson),
  load = (threadId, access) => lpReplyThread(threadId, access, readGmailJson),
  read = readWorkerSource,
} = {}) {
  const access = await token();
  const perQuery = [];
  const threads = new Map();
  for (const query of AHREFS_QUERIES) {
    const rows = await list(access, query);
    perQuery.push({ query, count: rows.reduce((n, [, ids]) => n + ids.size, 0) });
    for (const [threadId, ids] of rows) threads.set(threadId, new Set([...(threads.get(threadId) ?? []), ...ids]));
  }
  const audits = [];
  const unread = [];
  let messages = 0;
  for (const [threadId, ids] of threads) {
    const thread = await load(threadId, access);
    for (const id of ids) {
      const message = thread.find((m) => m.id === id);
      if (!message) throw new Error("NAMED STOP [AHREFS_MAIL_UNREAD] Gmail omitted a listed Ahrefs message");
      messages += 1;
      const subject = String(message.headers?.subject ?? "").replace(/[\r\n]+/g, " ").slice(0, 160);
      const date = dayOf(message.internalDate);
      const result = await read({
        worker: "danielle", instruction: INSTRUCTION, maxOutputTokens: 2048, json: SCHEMA,
        source: JSON.stringify({ from: message.headers?.from ?? "", subject, date, body: message.body }),
        accept: (text) => parseAhrefsEmail(text) !== null,
      }, env);
      if (result.status === "allowance-exhausted") throw new Error("NAMED STOP [FREE_ALLOWANCE_EXHAUSTED] the free allowance ran out mid-week; no digest is written and the next run reads the whole week again");
      if (result.status === "unavailable" || result.status === "refused") throw new Error(`NAMED STOP [FREE_READER_UNAVAILABLE] the free reader gave no answer (${result.status}); no digest is written and the next run retries`);
      const row = result.status === "ok" ? parseAhrefsEmail(result.text) : null;
      if (!row || row.kind === "uncertain") { unread.push({ subject, date, link: messageLink("me", id) }); continue; }
      if (row.kind === "site_audit") audits.push({ ...row, subject, date });
    }
  }
  return renderDigest({ since: dayOf(now - WINDOW_DAYS * DAY), until: dayOf(now), perQuery, messages, audits, unread });
}

async function main() {
  const i = process.argv.indexOf("--out");
  const out = i === -1 ? null : process.argv[i + 1];
  if (!out) { console.error("NAMED STOP [AHREFS_DIGEST_ARGS] --out <path> is required"); process.exit(2); }
  if (!personalGrantPresent()) {
    console.error("NAMED STOP [HER_ACCOUNT] personal Gmail has no read-only grant in the vault (TONI_GMAIL_CLIENT_ID, TONI_GMAIL_CLIENT_SECRET, TONI_GMAIL_REFRESH_TOKEN); the connector step reads the Ahrefs mail until it exists.");
    process.exit(10);
  }
  let digest;
  try { digest = await buildAhrefsDigest(); } catch (error) {
    const text = String(error?.message ?? error).slice(0, 300);
    console.error(/NAMED STOP/.test(text) ? text : `NAMED STOP [AHREFS_MAIL_UNREAD] ${text}`);
    process.exit(3);
  }
  const temporary = `${out}.${process.pid}.tmp`;
  try { writeFileSync(temporary, digest, { mode: 0o600 }); renameSync(temporary, out); } finally { rmSync(temporary, { force: true }); }
  console.log(`AHREFS-DIGEST-COMPLETE: ${digest.split("\n")[0]}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
