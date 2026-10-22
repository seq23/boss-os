#!/usr/bin/env node
/**
 * The tail's report email: the file as written, from Simone <simone@sequoiataylor.com> through the
 * Boss OS Resend team (sendAs → sendersFor: BOSS_OS_MAIL_KEY, then the Industry Guides fallback), to
 * BOSS_NOTIFY_TO. Run only under `npm run vault:run`, which strips every West Peek key.
 *   node scripts/ops/boss-mail-tail-report.mjs <report.txt> <subject>
 */
import { readFileSync } from "node:fs";
import { sendAs } from "./lib/duty-kit.mjs";

const [file, subject] = process.argv.slice(2);
if (!file || !subject) { console.error("usage: boss-mail-tail-report.mjs <report.txt> <subject>"); process.exit(2); }
const text = readFileSync(file, "utf8").trim();
if (!text) { console.error("NAMED STOP [EMPTY_REPORT] the report file is empty; nothing was sent."); process.exit(3); }
const ok = await sendAs("Simone", { subject: subject.slice(0, 180), text: `${text}\n\n— Simone, Chief of Staff (the tail on your Boss OS mail)` });
if (!ok) { console.error("NAMED STOP [NO_MAIL_SENT] every Boss OS sender refused the tail report."); process.exit(8); }
