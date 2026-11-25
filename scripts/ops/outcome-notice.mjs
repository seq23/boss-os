#!/usr/bin/env node
/**
 * ONE OUTCOME LINE IN THE MORNING EMAIL'S NOTICES (her order 24 Nov 2026, after Noelle landed green and acted
 * on 0 of 11 decisions: "u said nothing yesterday"). seq-bin's post-land-check runs each PR's live outcome check
 * the night after it lands and calls this with its verdict:
 *
 *   npm run --silent vault:run -- node scripts/ops/outcome-notice.mjs --key <key> --text "<line>"
 *
 *   key   outcome:<owner/repo>#<pr>:working | :not-working | :not-checked:<YYYY-MM-DD>
 *   text  "<repo> #<pr> <outcome>: working — <what it saw>" (or NOT WORKING / NOT CHECKED), one sentence
 *
 * The line goes into the "notices" section through the one existing writer (`addMorningLines`, which keeps the
 * Mac file and posts to Boss OS), carrying its key, so your-day shows it in "Done for you" (NOT WORKING and NOT
 * CHECKED first) and tells it once. A key Boss OS already holds in today's notices is not written twice. Rule 0: the line counts only once Boss OS holds it — read back after the write.
 *
 * Exit 0 written (or already there) · 1 not kept in Boss OS · 2 bad arguments · 3 no passcode (run it through
 * the vault) · 4 refused: the text names an email address (Notices never carry owner or client emails).
 */
import { fileURLToPath } from "node:url";
import { addMorningLines, morningDir } from "../../src/shared/boss/mail/morning.mjs";
import { bossApi } from "./lib/duty-kit.mjs";

export const KEY_RE = /^outcome:[\w.-]+\/[\w.-]+#\d+:(?:working|not-working|not-checked:\d{4}-\d{2}-\d{2})$/;
const EMAIL_RE = /[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/;
export const MAX_TEXT = 300;
/** The word each key's line must say, before any sentence ends (Done for you keeps the first sentence only). */
export const VERDICT_WORDS = Object.freeze({ working: ": working — ", "not-working": ": NOT WORKING — ", "not-checked": ": NOT CHECKED — " });
const verdictOf = (key) => key.split(":")[2];

const hasKey = (obj, key) => (obj?.lines ?? []).some((l) => l && typeof l === "object" && l.key === key);

/** Validate the arguments: { key, text } or { error, code }. Pure. */
export function noticeArgs(argv) {
  const at = (flag) => { const i = argv.indexOf(flag); return i === -1 ? null : argv[i + 1] ?? null; };
  const key = at("--key");
  // One sentence: a stop inside the text would let Done for you cut the line before its verdict.
  const text = String(at("--text") ?? "").replace(/\s+/g, " ").trim().replace(/[.!?]+\s+(?=\S)/g, "; ");
  if (!key || !KEY_RE.test(key)) return { error: `--key must read outcome:<owner/repo>#<pr>:working|not-working|not-checked:<YYYY-MM-DD> (got ${JSON.stringify(key)})`, code: 2 };
  if (!text || text.length > MAX_TEXT) return { error: `--text is one line of 1 to ${MAX_TEXT} characters`, code: 2 };
  if (!text.includes(VERDICT_WORDS[verdictOf(key)])) return { error: `--text must say "${VERDICT_WORDS[verdictOf(key)].trim()}" (the key's verdict): "<repo> #<pr> <outcome>${VERDICT_WORDS[verdictOf(key)]}<what was seen>"`, code: 2 };
  if (EMAIL_RE.test(text)) return { error: "NAMED STOP [NOTICE_PRIVATE] the line names an email address; Notices never carry one", code: 4 };
  return { key, text };
}

/**
 * Write one outcome line, once. The options are for tests: { api, dir, add }.
 * Returns { written: boolean, why } or throws an Error with `.code`.
 */
export async function writeOutcomeNotice({ key, text }, { api = null, dir = morningDir(), add = addMorningLines } = {}) {
  // Only Boss OS decides "already written": the Mac file can hold a line whose post failed (it skips quietly
  // on the Mac), and the email is sent from the cloud. A line already told is not shown again (told once, by key).
  const boss = api ?? await bossApi().catch((e) => { throw Object.assign(new Error(String(e.message)), { code: /NO_PASSCODE/.test(e.message) ? 3 : 1 }); });
  const stored = async () => {
    const rows = await boss.get("/morning/sections").then((d) => d?.rows ?? []);
    return rows.some((r) => r.section === "notices" && r.status !== "told" && hasKey(r.body, key));
  };
  let before;
  try { before = await stored(); } catch (e) { throw Object.assign(new Error(`NAMED STOP [NOTICE_UNREAD] Boss OS notices not read: ${e.message}`), { code: 1 }); }
  if (before) return { written: false, why: "already in today's notices (Boss OS)" };
  add("notices", { lines: [{ text, key, links: [] }] }, { dir });
  let after = false;
  try { after = await stored(); } catch (e) { throw Object.assign(new Error(`NAMED STOP [NOTICE_NOT_STORED] the write was not read back: ${e.message}`), { code: 1 }); }
  if (!after) throw Object.assign(new Error("NAMED STOP [NOTICE_NOT_STORED] Boss OS does not hold the line after the write; the Mac file alone never reaches a cloud-sent email"), { code: 1 });
  return { written: true, why: "kept in Boss OS" };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const a = noticeArgs(process.argv.slice(2));
  if (a.error) { console.error(`outcome-notice: ${a.error}`); process.exit(a.code); }
  try {
    const r = await writeOutcomeNotice(a);
    console.log(`outcome-notice: ${a.key} ${r.written ? "written" : "not written again"} (${r.why})`);
  } catch (e) {
    console.error(`outcome-notice: ${String(e.message).slice(0, 240)}`);
    process.exit(e.code ?? 1);
  }
}
