#!/usr/bin/env node
/**
 * Monique's comment watch — the Mac half. Runs through the vault (BOSS_PASSCODE, BOSS_OS_MAIL_KEY).
 *
 *   npm run --silent vault:run -- node scripts/ops/youtube-comment-watch.mjs [--sweep] [--dry-run]
 *
 * Two halves, every run, in this order:
 *
 *   ACT   ask Boss OS for rows that carry HER instruction and no result (`/pending-instructions`
 *         — the only feed this script will hand to `act`), write them in how-we-know's
 *         instruction shape (who / when / via on every line), run `loop/comments.py act`, report
 *         each result back, and email her one line per action from monique@.
 *   SWEEP only when the duty is due (`/duties/due`), or with --sweep: run `loop/comments.py
 *         sweep`, post the digest. Non-empty → email her the numbered digest with the reply forms
 *         and a `[cw_…]` token. Empty → no email; NOTHING_TO_REPORT is recorded by name.
 *
 * Exit codes: 0 did its work (including a named NOTHING_TO_REPORT / NOTHING_PENDING); everything
 * else is a NAMED STOP printed on its last line, which duty-run.sh files as the failure reason.
 *
 * The channel's repo is ~/GitHub/how-we-know. Its credentials never leave that repo's .secrets/;
 * this script only invokes its CLI and reads the JSON it writes.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sendersFor, employeeMail } from "./notify.mjs";
import {
  LOCAL_JOB, shouldEmail, digestEmail, confirmationEmail,
} from "../../src/shared/boss/commentWatch/lane.mjs";

const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const HWK = process.env.HOW_WE_KNOW_REPO ?? join(process.env.HOME ?? "", "GitHub", "how-we-know");
const PY = join(HWK, ".venv", "bin", "python");
const TO = process.env.BOSS_NOTIFY_TO ?? "seq.taylor@gmail.com";
const DRY = process.argv.includes("--dry-run");
const FORCE_SWEEP = process.argv.includes("--sweep");

let cookie = "";
const say = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const stop = (code, tag, why) => { console.error(`NAMED STOP [${tag}] ${why}`); process.exit(code); };

// ─── Boss OS ──────────────────────────────────────────────────────────────────

async function unlock() {
  if (!process.env.BOSS_PASSCODE) stop(4, "NO_PASSCODE", "this runs through the vault: npm run vault:run -- node scripts/ops/youtube-comment-watch.mjs");
  const res = await fetch(`${ORIGIN}/api/boss/auth/unlock`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }),
  });
  if (!res.ok) stop(5, "UNLOCK_FAILED", `Boss OS refused the passcode (${res.status}).`);
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
}

async function api(path, body) {
  const res = await fetch(`${ORIGIN}/api/boss${path}`, {
    method: body ? "POST" : "GET",
    headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data: json?.data ?? null, error: json?.error ?? null };
}

// ─── Email, as Monique ────────────────────────────────────────────────────────

async function email(subject, text) {
  if (DRY) { say(`DRY RUN — would email "${subject}"`); return "dry_run"; }
  const senders = sendersFor("Monique");
  if (senders.length === 0) stop(6, "NO_RESEND_KEY", "neither BOSS_OS_MAIL_KEY nor RESEND_API_KEY is set; run through the vault.");
  let last = "";
  for (const sender of senders) {
    const { from, key } = sender;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(employeeMail(sender, { to: TO, subject, text })),
    });
    if (res.ok) {
      const id = (await res.json().catch(() => ({})))?.id ?? "sent";
      say(`emailed ${TO} from ${from}: ${subject} (${id})`);
      if (from.includes("westpeek.ventures")) say("NAMED STOP [WRONG_SENDING_IDENTITY] Monique just emailed from a West Peek domain; check BOSS_OS_MAIL_KEY.");
      return id;
    }
    last = `${res.status} ${await res.text().catch(() => "")}`;
  }
  stop(8, "EMAIL_FAILED", `Resend refused the message: ${last}`);
}

// ─── how-we-know ──────────────────────────────────────────────────────────────

function hwk(args) {
  if (!existsSync(PY)) stop(2, "NO_HOW_WE_KNOW", `${PY} is missing; the channel's repo must be at ${HWK} with its .venv.`);
  if (!existsSync(join(HWK, "loop", "comments.py"))) stop(2, "NO_COMMENTS_LANE", `${HWK}/loop/comments.py is missing; pull main in that repo.`);
  const r = spawnSync(PY, ["loop/comments.py", ...args], { cwd: HWK, encoding: "utf8", env: { ...process.env, LOOP_DRY_RUN: DRY ? "1" : "" } });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  for (const line of out.trim().split("\n").slice(-25)) say(`  hwk│ ${line}`);
  return { rc: r.status ?? 1, out };
}

function pushState() {
  // The ledger is the record of who instructed what; it is tracked in that repo and pushed the way
  // the Mac's other lanes push their state. A push that fails is said, not hidden, and does not
  // fail the duty: the ledger is still on disk and the next run pushes it.
  const wk = isoWeek();
  const r = spawnSync(PY, ["loop/mac_sync.py", "push", "--lane", "comments",
    "loop/state/comments/ledger.json", "loop/state/quota.json", "loop/state/stops/_streaks.json",
    `loop/state/stops/${wk}-comment-watch.json`, `loop/state/stops/${wk}-comment-act.json`], { cwd: HWK, encoding: "utf8" });
  say(`  hwk│ push: ${(r.stdout ?? r.stderr ?? "").trim().split("\n").pop()}`);
}

function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const w = Math.ceil(((t - y0) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(w).padStart(2, "0")}`;
}

// ─── ACT ──────────────────────────────────────────────────────────────────────

async function actHalf() {
  const pending = await api("/comment-watch-items/pending-instructions");
  if (!pending.ok) stop(9, "PENDING_UNREADABLE", `GET /pending-instructions → ${pending.status} ${pending.error ?? ""}`);
  const rows = pending.data?.instructions ?? [];
  if (!rows.length) { say("NOTHING_PENDING: no instruction of hers awaits act."); return 0; }

  // how-we-know's shape: every line names who / when / via, or its `act` refuses the whole file.
  const instructions = {};
  for (const r of rows) {
    if (!r.instructed_by || !r.instructed_at || !r.source) stop(12, "INSTRUCTION_UNBACKED", `${r.comment_id} arrived without who/when/via; refusing to act.`);
    instructions[r.comment_id] = {
      action: r.action, reply_text: r.reply_text ?? undefined,
      instructed_by: r.instructed_by, instructed_at: r.instructed_at, source: r.source,
      note: r.answer_mode === "your_call" ? `pre-approved: "${r.answer_phrase}"` : undefined,
    };
  }
  const dir = mkdtempSync(join(tmpdir(), "comment-act-"));
  const file = join(dir, "instructions.json");
  writeFileSync(file, JSON.stringify(instructions, null, 2));
  say(`act: ${rows.length} instruction(s) from ${[...new Set(rows.map((r) => r.instructed_by))].join(", ")}`);

  const { rc, out } = hwk(["act", "--instructions", file]);
  const lastAct = join(HWK, "loop", "state", "comments", "last_act.json");
  const results = existsSync(lastAct) && !DRY ? JSON.parse(readFileSync(lastAct, "utf8")).results ?? [] : [];
  if (rc !== 0 && !/INSTRUCTIONS_ALREADY_APPLIED/.test(out)) {
    // Whatever was applied before the stop is reported so no row is re-applied next run.
    if (results.length) await api("/comment-watch-items/applied", { results });
    stop(rc, "ACT_FAILED", `loop/comments.py act exited ${rc}; ${(out.match(/NAMED STOP\s+\[[A-Z_]+\][^\n]*/) ?? ["see the log"])[0]}`);
  }
  if (DRY) { say(`DRY RUN — would report ${rows.length} result(s) and email one line each`); return rows.length; }
  const byId = new Map(rows.map((r) => [r.comment_id, r]));
  const reported = results.length ? results : rows.map((r) => ({ comment_id: r.comment_id, result: "already applied on an earlier run" }));
  const posted = await api("/comment-watch-items/applied", { results: reported });
  if (!posted.ok) stop(10, "RESULTS_NOT_RECORDED", `POST /applied → ${posted.status} ${posted.error ?? ""}`);
  pushState();
  const token = rows[0].digest_id;
  const lines = reported.map((r) => ({ n: byId.get(r.comment_id)?.n, author: byId.get(r.comment_id)?.author, result: r.result }));
  const mail = confirmationEmail(lines, token);
  await email(mail.subject, mail.text);
  return reported.length;
}

// ─── SWEEP ────────────────────────────────────────────────────────────────────

async function due() {
  if (FORCE_SWEEP) return true;
  const res = await fetch(`${ORIGIN}/api/boss/duties/due/${encodeURIComponent(LOCAL_JOB)}`, { headers: { cookie } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) stop(7, "DUE_UNKNOWN", `GET /duties/due/${LOCAL_JOB} → ${res.status} ${json?.error ?? ""}`);
  if (json.data?.suspended) { say(`sweep: duty suspended (${json.data.reason ?? ""}); act half only.`); return false; }
  if (!json.data?.due) { say(`sweep: not due until ${new Date(json.data?.next_due_at ?? 0).toISOString()}; act half only.`); return false; }
  return true;
}

async function sweepHalf() {
  const dir = mkdtempSync(join(tmpdir(), "comment-sweep-"));
  const out = join(dir, "digest.json");
  const { rc, out: log } = hwk(["sweep", "--out", out]);
  if (rc !== 0) stop(rc, "SWEEP_FAILED", `loop/comments.py sweep exited ${rc}; ${(log.match(/NAMED STOP\s+\[[A-Z_]+\][^\n]*/) ?? ["see the log"])[0]}`);
  if (!existsSync(out)) stop(11, "NO_DIGEST", "sweep exited 0 and wrote no digest — that is a defect in loop/comments.py, not an empty week.");
  const digest = JSON.parse(readFileSync(out, "utf8"));
  say(`sweep: ${digest.new_comments} new comment(s) ${JSON.stringify(digest.by_class ?? {})}; ${digest.items?.length ?? 0} to report`);
  if (!DRY) pushState();

  if (DRY) { say(shouldEmail(digest) ? `DRY RUN — would post ${digest.items.length} item(s) and email the digest` : "DRY RUN — NOTHING_TO_REPORT, no email"); return; }
  const posted = await api("/comment-watch-items", { new_comments: digest.new_comments, by_class: digest.by_class, items: digest.items ?? [] });
  if (!posted.ok) stop(10, "DIGEST_NOT_RECORDED", `POST /comment-watch-items → ${posted.status} ${posted.error ?? ""}`);
  if (posted.data.outcome === "NOTHING_TO_REPORT" || !shouldEmail(digest)) {
    say(`NOTHING_TO_REPORT: recorded on ${posted.data.id}; no email sent.`);
    return;
  }
  // Number the items as Boss OS numbered its rows, so her "2 delete" means the same row here and there.
  const numbered = { ...digest, items: posted.data.items.map((row) => ({ ...digest.items.find((it) => it.comment_id === row.comment_id), n: row.n })) };
  const mail = digestEmail(numbered, posted.data.id);
  const mailId = await email(mail.subject, mail.text);
  await api(`/comment-watch-items/${posted.data.id}/mailed`, { mail_id: String(mailId) });
  say(`digest ${posted.data.id}: ${numbered.items.length} item(s) emailed; task ${posted.data.task_id}`);
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  await unlock();
  const acted = await actHalf();
  if (await due()) await sweepHalf();
  else if (!acted) say("NOTHING_PENDING and sweep not due: this run had nothing to do, and said so.");
  console.log("COMMENT-WATCH-COMPLETE");
}

main().catch((e) => stop(1, "CRASHED", e?.stack ?? String(e)));
