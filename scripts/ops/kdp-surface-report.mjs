/**
 * THE TRIAGE, POSTED — AND EVERYTHING SEEING IT PRODUCES. The one poster, the one sender.
 *
 * ─── What failed on 12–21 Sep 2026, plainly ────────────────────────────────
 *
 * Simone's daily scan SAW Amazon's title flag on The Gift Letter three times. The 12 Sep row set
 * needs_owner and no email went (the prompt told the model to send through a vault it does not
 * have); the 15 and 16 Sep rows said "assigned to Zora" and no assignment existed; the 17–20 Sep
 * runs found nothing NEW and never re-raised what was still OPEN. Amazon's five days lapsed. The
 * scan happened daily; what failed is that seeing it produced nothing.
 *
 * ─── So this file, run by the wrapper through the vault, does all of it ───
 *
 *   1. Reads `~/.boss-os/kdp/surface.json` — the model's ONLY output — and refuses anything that
 *      contradicts `scripts/ops/kdp-register.json` (a settled matter re-raised, an unknown title).
 *   2. Posts to /api/boss/kdp/mail, which creates the work_assignments row for every `assigned`
 *      item in the same request and refuses `assigned` without one.
 *   3. Sends the ONE email a needs_owner item earns, from Simone, subject `#simone [kml_…] …`, and
 *      writes the Resend id on the row. A needs_owner row that got no id is a NAMED STOP.
 *   4. Chases every OPEN problem that is within two days of its deadline or past it, under Simone's
 *      name, at most once a day, until the row is resolved. An open problem is never "already
 *      reported".
 *   5. Prints the sentinel the wrapper records, DERIVED FROM THE FILE: quiet | noted | acted |
 *      needs-her | blocked. Never from the model's closing sentence.
 *
 * ─── Rule 0 ────────────────────────────────────────────────────────────────
 *
 * A missing file, a stale one, a refusal, or a needs_owner row that woke nobody is a non-zero exit
 * with a named reason. Re-posting yesterday's file would put a triage on the screen that never
 * happened.
 */

import { readFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sendersFor, employeeMail } from "./notify.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const DIR = process.env.BOSS_OS_KDP_DIR ?? `${process.env.HOME}/.boss-os/kdp`;
const FILE = join(DIR, "surface.json");
const REGISTER = process.env.BOSS_OS_KDP_REGISTER ?? join(ROOT, "scripts/ops/kdp-register.json");
const MAX_AGE_MS = Number(process.env.BOSS_OS_KDP_MAX_AGE_MS ?? 2 * 60 * 60 * 1000);
const SOURCE = process.argv.includes("--manual") ? "manual" : "launchd";
const TO = process.env.BOSS_NOTIFY_TO ?? "seq.taylor@gmail.com";
const DAY_MS = 24 * 60 * 60 * 1000;
const NAG_WINDOW_MS = 2 * DAY_MS;
const NAG_EVERY_MS = 20 * 60 * 60 * 1000;

const OUTCOMES = new Set(["acted", "assigned", "noted"]);
const MATTERS = new Set(["title", "subtitle", "cover", "content", "rights", "case", "account", "other"]);

function stop(code, ...lines) {
  console.error(`NAMED STOP [${code}] ${lines[0] ?? ""}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
}

/**
 * Pure: every reason a file must not reach Boss OS, against the register. Exported for the
 * validator's self-test and `--self-test` here.
 */
export function refusals(payload, register) {
  const out = [];
  const items = Array.isArray(payload?.items) ? payload.items : null;
  if (!items) return ["NO_ITEMS_ARRAY: the file has no items array. An empty one is valid; a missing one is malformed."];
  const titles = new Map((register?.titles ?? []).map((t) => [t.title_ref, t]));
  const settled = register?.settled ?? {};
  for (const it of items) {
    if (!OUTCOMES.has(it?.outcome_kind)) { out.push(`NO_OUTCOME: an item ends in "${it?.outcome_kind ?? "nothing"}". Every message ends in acted, assigned, or noted with a reason.`); continue; }
    if (!it?.action_taken || !String(it.action_taken).trim()) out.push(`NO_ACTION_TAKEN: an item is "${it.outcome_kind}" and says nothing about itself. Even 'nothing to do' needs its reason.`);
    if (it.disposition === "problem" && it.outcome_kind === "noted") out.push("PROBLEM_NOTED: a problem with a title cannot end in 'nothing to do'. Act on it, or assign it.");
    for (const field of ["note", "action_taken", "owner_ask"]) {
      if (typeof it?.[field] === "string" && it[field].includes("@")) out.push(`ADDRESS_IN_${field.toUpperCase()}: a triage field carries an '@'.`);
    }
    if (it.outcome_kind === "assigned" && !(it.assign && typeof it.assign === "object" && it.assign.helper_employee_id && it.assign.what && it.assign.why)) {
      out.push("ASSIGNMENT_IS_A_SENTENCE: an 'assigned' item has no assign block {helper_employee_id, what, why}. On 15–16 Sep 'Assigned to Zora' was written and no assignment existed.");
    }
    if (it.disposition === "problem") {
      if (!MATTERS.has(it.matter)) out.push(`NO_MATTER: a problem says what it is about — one of ${[...MATTERS].join(", ")}.`);
      if (it.needs_owner === true && !(typeof it.owner_ask === "string" && it.owner_ask.trim())) out.push("NO_OWNER_ASK: needs_owner without the one decision she is asked for (with a recommended default).");
      if (it.title_ref && !titles.has(it.title_ref)) out.push(`UNKNOWN_TITLE: "${it.title_ref}" is not in the register. Every title is one of the seven by its Amazon reference.`);
      // A settled matter is not re-raised unless the email changes the facts — and says how.
      if (it.matter === "cover" && settled.covers?.do_not_re_raise && it.needs_owner === true && !it.facts_changed) out.push("SETTLED_MATTER_RE_RAISED: the covers were approved 9 Sep and are on the books; a cover item may not wake her unless facts_changed says what Amazon changed.");
      if (it.matter === "case" && settled.case_51496198?.do_not_re_raise && it.needs_owner === true && !it.facts_changed) out.push("SETTLED_MATTER_RE_RAISED: case #51496198 closed 14 Sep; mail on that thread is ordinary mail and may not reopen it.");
      // The register's target is the truth about what she wants: a title not Live is a problem, never a preference.
      const t = it.title_ref ? titles.get(it.title_ref) : null;
      if (t && t.target === "LIVE" && /draft by (her )?choice|deliberately (left )?unpublished|by her decision/i.test(`${it.note} ${it.action_taken}`)) {
        out.push(`REGISTER_CONTRADICTED: "${t.title}" has target LIVE in the register (her words, 21 Sep: every book published and working); nothing about it is 'draft by choice'.`);
      }
    }
    if (it.due_at != null && (!Number.isFinite(Number(it.due_at)) || Number(it.due_at) < 1_600_000_000_000)) out.push("BAD_DUE_AT: due_at is a millisecond timestamp.");
    if (it.resolves != null && !/^kml_[a-z0-9]+$/i.test(String(it.resolves))) out.push(`BAD_RESOLVES: "${it.resolves}" is not a kdp_mail_log id.`);
    if (it.disposition === "problem" && it.needs_owner !== true && it.outcome_kind === "acted" && !it.resolves && it.due_at == null) out.push("NO_DUE_AT: an open problem acted on without a deadline is never chased; give it due_at (the sender's, or seven days).");
  }
  return out;
}

/** The sentinel, from the file and nothing else. */
export function sentinelFor(payload) {
  if (payload?.blocked) return "blocked";
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (items.length === 0) return "quiet";
  if (items.some((i) => i.disposition === "problem" && i.needs_owner === true)) return "needs-her";
  if (items.some((i) => i.disposition === "problem")) return "acted";
  if (items.some((i) => i.disposition === "update")) return "noted";
  return "quiet";
}

/** Which open problems are chased today: within two days of due, or past it, and not chased in the last 20 hours. */
export function dueForChase(open, now) {
  return (open ?? []).filter((p) => p.due_at != null && p.due_at - now <= NAG_WINDOW_MS && (!p.nagged_at || now - p.nagged_at >= NAG_EVERY_MS) && !p.answered_at);
}

async function api(path, cookie, body) {
  const res = await fetch(`${ORIGIN}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} failed (${res.status}): ${text.slice(0, 300)}`);
  return JSON.parse(text).data;
}

async function sendAsSimone({ subject, text }) {
  const senders = sendersFor("Simone");
  if (senders.length === 0) return { id: null, error: "NO_RESEND_KEY" };
  let lastErr = "";
  for (const sender of senders) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${sender.key}` },
      body: JSON.stringify(employeeMail(sender, { to: TO, subject, text })),
    });
    if (res.ok) { const j = await res.json().catch(() => ({})); return { id: j.id ?? null, from: sender.from }; }
    lastErr = `${res.status} ${(await res.text()).slice(0, 200)}`;
  }
  return { id: null, error: lastErr };
}

function askEmail(row, item, register) {
  const t = (register.titles ?? []).find((x) => x.title_ref === item.title_ref);
  const due = row.due_at ? ` Amazon's deadline: ${new Date(row.due_at).toISOString().slice(0, 10)}.` : "";
  return {
    subject: `#simone [${row.id}] ${t ? t.title : "a Kindle title"} — one decision, reply approved`,
    text:
      `${item.note}\n\n` +
      `What I did: ${item.action_taken}\n\n` +
      `What I need from you: ${item.owner_ask}${due}\n\n` +
      `Reply with one word — approved — and I execute it on my next run and report Live-or-not from the bookshelf. ` +
      `Reply with different wording and I use yours. Reply "hold" and I leave it.\n\n— Simone`,
  };
}

function chaseEmail(p, register) {
  const t = (register.titles ?? []).find((x) => x.title_ref === p.title_ref);
  const days = Math.ceil((p.due_at - Date.now()) / DAY_MS);
  const when = days < 0 ? `${-days} day(s) PAST Amazon's deadline` : days === 0 ? "due TODAY" : `due in ${days} day(s)`;
  return {
    subject: `#simone [${p.id}] still open — ${t ? t.title : "a Kindle title"} (${when})`,
    text:
      `${p.note}\n\nThis is ${when} and I have no answer from you on it.\n\n` +
      (p.owner_ask ? `What I need: ${p.owner_ask}\n\nReply with one word — approved.` : `What is happening: ${p.action_taken}`) +
      `\n\nI chase this every day until it is resolved.\n\n— Simone`,
  };
}

function selfTest() {
  const reg = JSON.parse(require_fs().readFileSync(REGISTER, "utf8"));
  const ok = { items: [{ disposition: "problem", matter: "title", title_ref: "A1EYXUFGFV7CN6", note: "Title flagged.", outcome_kind: "acted", action_taken: "Proposed a subtitle.", needs_owner: true, owner_ask: "Approve the subtitle." }] };
  const cases = [
    ["a valid needs_owner problem passes", refusals(ok, reg).length === 0],
    ["assigned without an assign block is refused", refusals({ items: [{ ...ok.items[0], outcome_kind: "assigned", needs_owner: false }] }, reg).some((r) => r.startsWith("ASSIGNMENT_IS_A_SENTENCE"))],
    ["assigned with an assign block passes", refusals({ items: [{ ...ok.items[0], outcome_kind: "assigned", needs_owner: false, assign: { helper_employee_id: "emp_knowledge", what: "x", why: "y" } }] }, reg).length === 0],
    ["a problem with no matter is refused", refusals({ items: [{ ...ok.items[0], matter: undefined }] }, reg).some((r) => r.startsWith("NO_MATTER"))],
    ["needs_owner with no owner_ask is refused", refusals({ items: [{ ...ok.items[0], owner_ask: "" }] }, reg).some((r) => r.startsWith("NO_OWNER_ASK"))],
    ["an unknown title is refused", refusals({ items: [{ ...ok.items[0], title_ref: "ZZZZZZZZZZ" }] }, reg).some((r) => r.startsWith("UNKNOWN_TITLE"))],
    ["'draft by choice' contradicts the register", refusals({ items: [{ ...ok.items[0], action_taken: "No action; the title is draft by her choice." }] }, reg).some((r) => r.startsWith("REGISTER_CONTRADICTED"))],
    ["the covers cannot wake her again", refusals({ items: [{ ...ok.items[0], matter: "cover" }] }, reg).some((r) => r.startsWith("SETTLED_MATTER_RE_RAISED"))],
    ["a problem cannot be noted", refusals({ items: [{ ...ok.items[0], outcome_kind: "noted", needs_owner: false }] }, reg).some((r) => r.startsWith("PROBLEM_NOTED"))],
    ["sentinel: empty is quiet", sentinelFor({ items: [] }) === "quiet"],
    ["sentinel: needs_owner is needs-her", sentinelFor(ok) === "needs-her"],
    ["sentinel: a problem acted is acted", sentinelFor({ items: [{ ...ok.items[0], needs_owner: false }] }) === "acted"],
    ["sentinel: blocked comes from the file", sentinelFor({ blocked: "mailbox unreadable", items: [] }) === "blocked"],
    ["chase: within two days and never chased", dueForChase([{ due_at: Date.now() + DAY_MS }], Date.now()).length === 1],
    ["chase: past due is chased", dueForChase([{ due_at: Date.now() - 3 * DAY_MS }], Date.now()).length === 1],
    ["chase: chased an hour ago is not chased again", dueForChase([{ due_at: Date.now(), nagged_at: Date.now() - 3_600_000 }], Date.now()).length === 0],
    ["chase: five days out is not chased", dueForChase([{ due_at: Date.now() + 5 * DAY_MS }], Date.now()).length === 0],
    ["chase: answered is not chased", dueForChase([{ due_at: Date.now(), answered_at: Date.now() }], Date.now()).length === 0],
  ];
  const failed = cases.filter(([, c]) => !c);
  for (const [n] of failed) console.error(`  ✗ ${n}`);
  if (failed.length) { console.error(`kdp-surface-report self-test: ${failed.length} case(s) wrong`); process.exit(1); }
  console.log(`kdp-surface-report self-test: ${cases.length}/${cases.length} cases.`);
}
function require_fs() { return { readFileSync: (p, e) => readFileSyncNode(p, e) }; }
import { readFileSync as readFileSyncNode } from "node:fs";

async function main() {
  if (process.argv.includes("--self-test")) { selfTest(); return; }
  const register = JSON.parse(await readFile(REGISTER, "utf8"));
  if (!Array.isArray(register.titles) || register.titles.length === 0) { stop("EMPTY_REGISTER", `${REGISTER} lists no titles; a scan against nothing proves nothing.`); process.exit(5); }

  let info;
  try { info = await stat(FILE); }
  catch {
    stop("NO_TRIAGE", `${FILE} was not written.`, "A quiet day still writes an empty items array, so an absent file means the run did not finish rather than that nothing arrived.");
    process.exit(6);
  }
  if (Date.now() - info.mtimeMs > MAX_AGE_MS) { stop("STALE_TRIAGE", `${FILE} is ${Math.round((Date.now() - info.mtimeMs) / 60000)} minutes old.`, "Re-posting the last one would put a triage on the screen that never happened."); process.exit(7); }
  let payload;
  try { payload = JSON.parse(await readFile(FILE, "utf8")); }
  catch (err) { stop("UNREADABLE_TRIAGE", err?.message ?? String(err)); process.exit(8); }

  const bad = refusals(payload, register);
  if (bad.length) {
    for (const b of bad) stop(b.split(":")[0], b.slice(b.indexOf(":") + 2));
    console.error("  Nothing was sent. The run's file contradicts the rules or the register; fix the prompt, not the file.");
    process.exit(12);
  }
  const sentinel = sentinelFor(payload);
  if (!process.env.BOSS_PASSCODE) { stop("NO_PASSCODE", "run this through the vault."); process.exit(11); }

  const unlock = await fetch(`${ORIGIN}/api/boss/auth/unlock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }) });
  if (!unlock.ok) throw new Error(`unlock failed (${unlock.status})`);
  const cookie = (unlock.headers.get("set-cookie") ?? "").split(";")[0];

  const items = payload.items;
  if (payload.blocked) {
    // The mailbox could not be read. That is a fact about the run, and the duty's clock must NOT
    // advance on it — so nothing is posted as a triage; the chase below still runs.
    console.error(`NAMED STOP [MAILBOX_UNREAD] ${String(payload.blocked).slice(0, 300)}`);
  } else {
    const data = await api("/api/boss/kdp/mail", cookie, { items, source: SOURCE });
    console.log(
      items.length === 0
        ? "Reported to Boss OS: nothing arrived. The duty's clock advanced, which is what silence needs to mean something."
        : `Reported to Boss OS: ${data.recorded} message(s)${data.problems ? `, ${data.problems} of them a problem with a title` : ", none of them a problem"}.`,
    );
    // ── 3. THE ONE EMAIL A needs_owner ITEM EARNS, PROVEN BY ITS ID ──────
    const recorded = data.items ?? [];
    for (let i = 0; i < recorded.length; i += 1) {
      const row = recorded[i];
      const item = items[i];
      if (!row.needs_owner) continue;
      const sent = await sendAsSimone(askEmail({ ...row, due_at: item.due_at ?? null }, item, register));
      if (!sent.id) {
        stop("OWNER_NOT_WOKEN", `${row.id} needs her and the email did not go (${sent.error}).`, "A needs_owner row with no delivered_message_id is the 12 Sep defect: seen, marked, nobody told.");
        process.exitCode = 15;
        continue;
      }
      await api(`/api/boss/kdp/mail/${row.id}/delivered`, cookie, { kind: "ask", message_id: sent.id });
      console.log(`Asked her, from ${sent.from}: [${row.id}] Resend ${sent.id}.`);
    }
    for (const row of recorded) if (row.assignment_id) console.log(`Assignment recorded: ${row.assignment_id} for ${row.id}.`);
    // ── A PROBLEM ENDS ON THE ROW, BY ID ─────────────────────────────────
    for (const item of items) {
      if (!item.resolves) continue;
      await api(`/api/boss/kdp/mail/${item.resolves}/resolve`, cookie, { resolution: String(item.action_taken).slice(0, 600) });
      console.log(`Resolved ${item.resolves}: ${String(item.action_taken).slice(0, 120)}`);
    }
  }

  // ── 4. AN OPEN PROBLEM IS NEVER "ALREADY REPORTED" ────────────────────
  const { open } = await api("/api/boss/kdp/mail/open", cookie);
  const now = Date.now();
  for (const p of dueForChase(open, now)) {
    const sent = await sendAsSimone(chaseEmail(p, register));
    if (!sent.id) { stop("CHASE_NOT_SENT", `${p.id} is due and the chase did not go (${sent.error}).`); process.exitCode = 16; continue; }
    await api(`/api/boss/kdp/mail/${p.id}/delivered`, cookie, { kind: "nag", message_id: sent.id });
    console.log(`Chased her, from ${sent.from}: [${p.id}] Resend ${sent.id}.`);
  }
  const stillOpen = (open ?? []).length;
  if (stillOpen) console.log(`${stillOpen} problem(s) still open on the Kindle surface.`);

  console.log(`KDP-SURFACE-COMPLETE: ${sentinel}`);
  if (payload.blocked) process.exitCode = 17;
}

main().catch((err) => {
  console.error(`kdp surface report failed: ${err?.message ?? err}`);
  process.exitCode = 1;
});
