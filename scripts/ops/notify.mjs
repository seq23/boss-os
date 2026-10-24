/**
 * A WAY TO REACH HER THAT A GOOGLE PASSWORD CHANGE CANNOT KILL.
 *
 * ─── The defect this closes ────────────────────────────────────────────────
 *
 * THE NOTIFICATION SHARED ITS FAILURE MODE WITH THE WORK. `kdp-watch-prompt.md` told Simone to email
 * the owner whenever something needed her, and that email went through the SAME claude.ai Gmail
 * connector she reads the mailbox with. She changed her Google password, Google revoked the grant
 * instantly, and the one condition that most needed to reach her — "I cannot read your mail at all"
 * — was the exact condition that could not send.
 *
 * Resend is an entirely separate transport with its own key, already in the vault. Nothing Google
 * does can revoke it, which is the property that was missing.
 *
 * ─── It is still the SECOND channel ────────────────────────────────────────
 *
 * The Boss OS Inbox and Today remain the channel of record: they are read on a screen she opens
 * every morning, they hold the history, and they do not depend on a message arriving. This is the
 * push — the thing that tells her to go and look on a day she otherwise would not. A caller must
 * never treat a sent email as having told her anything, and every caller here posts to Boss OS
 * first and sends second.
 *
 * ─── Rule 0 ────────────────────────────────────────────────────────────────
 *
 * It may not exit 0 having sent nothing. A missing key, a missing sender address or a refused send
 * is a non-zero exit with a named reason — because a notifier that fails quietly is worse than none,
 * since its silence is indistinguishable from there being nothing to say.
 *
 *   npm run notify -- --from Simone --subject "KDP: needs you" --body "One or two sentences."
 *
 * `--from` is the employee who owns the work. Omitted, it sends as Boss OS itself, which is correct
 * only for system mail that no employee owns.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { outboundFilesPlan } from "../../src/shared/boss/service/files.mjs";
import { layoutEmail, fromLegacy, plainProblems } from "../../src/shared/boss/mail/plain.mjs";

const ARGS = process.argv.slice(2);
/** Every value of a repeatable flag (`--file a.csv --file b.png`). */
const args = (name) => ARGS.flatMap((a, i) => (a === `--${name}` && ARGS[i + 1] ? [ARGS[i + 1]] : []));
const arg = (name) => {
  const i = ARGS.indexOf(`--${name}`);
  return i === -1 ? null : (ARGS[i + 1] ?? null);
};

const TO = process.env.BOSS_NOTIFY_TO ?? "seq.taylor@gmail.com";

/*
 * THE SENDER MUST BE A DOMAIN VERIFIED IN RESEND, AND THE KEY MUST MATCH THE ACCOUNT THAT OWNS IT.
 *
 * `boss@sequoiataylor.com` was the configured sender for weeks and had never once been accepted:
 * the domain was not verified on the account whose key this used, so every send 403'd. That is the
 * defect a notifier can least afford — it fails silently in exactly the situation where something
 * needed to reach her.
 *
 * There are two Resend accounts, deliberately. The original holds the West Peek domains and had hit
 * its plan's domain limit; a second, under her personal address, holds sequoiataylor.com. A key from
 * one cannot send from the other's domains, and the refusal reads like a verification problem rather
 * than a wrong-key problem — so sender and key are paired here rather than left to a single ambient
 * key.
 *
 * BOSS OS IS PERSONAL, SO ITS EMPLOYEES WRITE FROM sequoiataylor.com. West Peek is a separate
 * business with its own OS, and Boss OS's own mail never goes through a West Peek account or domain
 * (owner, 12 Oct 2026). When the Boss OS sender is refused, the last resort is The Industry Guides
 * team (cryptoclearr's Resend: theindustryguides.com) as `Boss OS <hello@theindustryguides.com>`,
 * keyed by BOSS_OS_FALLBACK_MAIL_KEY, and the run raises WRONG_SENDING_IDENTITY so the fallback
 * never passes unnoticed. Every script uses this pair, the fund-side chassis copies included
 * (22 Oct 2026: they used to fall back to the fund's team); tests/bossMailFallback.test.ts pins it.
 *
 * The env name is prefixed (BOSS_OS_FALLBACK_MAIL_KEY, not a bare RESEND_API_KEY) because
 * RESEND_API_KEY is the West Peek fund's team, which `vault:run` now strips before any Boss OS
 * process starts (scripts/lib/vault-env.mjs bossOsProcessEnv).
 */
/**
 * THE FUND-SIDE CHASSIS SENDERS, NAMED ONCE.
 *
 * Boss OS carries West Peek chassis code by copy (capital, buyer-hunt, people, LP). What these
 * scripts report on is fund-shaped work, so their rows are kept OFF the Boss OS email map
 * (tests/outboundEmailMap.test.ts reads this list for that exemption; it lives here, in the
 * module every one of them imports, so it is reached code and not a list beside it).
 *
 * THEY SEND THROUGH BOSS OS'S OWN TEAM. Until 22 Oct 2026 they fell back to the fund's Resend team
 * (RESEND_API_KEY, westpeek.ventures) whenever the Boss OS sender was refused, because `vault:run`
 * injected every key in the shared Mac vault. The owner's rule: Boss OS only ever gets its own
 * team's key. They now use `sendersFor`'s default — BOSS_OS_MAIL_KEY, then The Industry Guides
 * fallback — `vault:run` strips the fund's key before any Boss OS process starts
 * (scripts/lib/vault-env.mjs bossOsProcessEnv), and tests/bossKeySeparation.test.ts fails if any
 * file here reads a West Peek key or names a West Peek From again.
 */
// Combined boss fix (23 Oct 2026): buyer-hunt, interest-match and ledger-hunt send no email now (their
// findings feed Simone's morning email through morning/monique_found.json), and lp-positive's
// hand-run note is gone (the morning email's LP section replaced it). They left this list with it.
export const FUND_SIDE_CHASSIS_SENDERS = [
  "scripts/ops/lp-outcomes.mjs",
  "scripts/ops/people-worth-a-call.mjs",
];

export const FALLBACK_FROM = "Boss OS <hello@theindustryguides.com>";
export const FALLBACK_STOP =
  "NAMED STOP [WRONG_SENDING_IDENTITY] sent as The Industry Guides because the Boss OS sender was refused. " +
  "Check BOSS_OS_MAIL_KEY and that sequoiataylor.com is verified on the Boss OS Resend team.";

/** Boss OS's own last resort: The Industry Guides team, reply-to unchanged, marked as a fallback. */
function industryGuidesFallback({ local, tag }) {
  return { from: FALLBACK_FROM, key: process.env.BOSS_OS_FALLBACK_MAIL_KEY, reply_to: `${local}@sequoiataylor.com`, tag, fallback: true };
}
/**
 * EVERY EMPLOYEE SIGNS HER OWN MAIL.
 *
 * The first version sent everything as a single `Boss OS <boss@...>` address, which is how a
 * notification stops meaning anything: eight employees own different work, and a message that could
 * have come from any of them tells her nothing before she opens it. She names an owner for a reason,
 * and the owner should be on the envelope.
 *
 * The roster is closed on purpose. `--from Simone` becomes simone@sequoiataylor.com; a name that is
 * not on the roster is REFUSED rather than turned into an address, because DKIM signs any local part
 * on a verified domain — so a typo would send successfully, from an address belonging to nobody, and
 * nothing would ever say so. `Boss OS` itself is the fallback for system mail that no employee owns.
 *
 * Roster as of 2026-09-09, from /api/boss/employees/roster.
 */
const ROSTER = {
  // Explicit only, for system mail no employee owns. Never a default.
  "boss os": "boss",
  imani: "imani", danielle: "danielle", simone: "simone", zora: "zora",
  monique: "monique", camille: "camille", toni: "toni", kendra: "kendra",
};

export function sendersFor(who, { fallback = industryGuidesFallback } = {}) {
  /*
   * `--from` IS REQUIRED. There is no anonymous sender.
   *
   * "why only monique! that is stupid. either everyone has their name or everyone has boss@"
   *
   * She is right that the half-measure was the worst of the three options, and named-everyone is the
   * better of the two she offered: eight employees own different work, and a message that could have
   * come from any of them tells her nothing before she opens it.
   *
   * A DEFAULT WOULD HAVE QUIETLY RECREATED THE PROBLEM. If omitting the flag fell back to a generic
   * address, every caller that was never updated would keep sending anonymously and look fine doing
   * it — the same silent-wrong-default that made this inconsistent in the first place. So a caller
   * that names nobody is refused, loudly, and the fix is one flag.
   */
  if (!who) {
    console.error("NAMED STOP [NO_SENDER_NAMED] --from is required: every email is signed by the");
    console.error("  employee who owns the work.");
    console.error(`  One of: ${Object.keys(ROSTER).join(", ")}.`);
    console.error('  e.g. npm run notify -- --from Simone --subject "..." --body "..."');
    process.exit(7);
  }
  const key = String(who).trim().toLowerCase();
  const local = ROSTER[key];
  if (!local) {
    console.error(`NAMED STOP [UNKNOWN_SENDER] "${who}" is not on the Boss OS roster.`);
    console.error(`  Known: ${Object.keys(ROSTER).join(", ")}.`);
    console.error("  Refused rather than guessed: a verified domain signs any local part, so an");
    console.error("  invented address would send perfectly and belong to nobody.");
    process.exit(6);
  }
  const label = local === "boss" ? "Boss OS" : `${who.trim()} · Boss OS`;
  /*
   * REPLY-TO IS THE EMPLOYEE'S OWN ADDRESS, AND THE TAG RIDES THE SUBJECT (21 Sep 2026). Her
   * "approved" to danielle@ bounced 550 three times: the mail said "REPLY WITH ONE WORD" from an
   * address no Email Routing rule delivered. The rules exist now (`validate:employee-addresses-receive`
   * proves one per local part), and belt-and-braces: every employee message carries `reply_to` =
   * its own sequoiataylor.com address and a subject that starts with the employee's `#tag`, so a
   * reply routes by tag even if a client drops the address. `employeeMail()` below is the one place
   * that builds the payload; every sender uses it.
   */
  const tag = local === "boss" ? null : `#${local}`;
  // The name she sees under the email (plain.mjs signs it once); "Boss OS" for system mail.
  const name = local === "boss" ? "Boss OS" : local.charAt(0).toUpperCase() + local.slice(1);
  return [
    { from: `${label} <${local}@sequoiataylor.com>`, key: process.env.BOSS_OS_MAIL_KEY, reply_to: `${local}@sequoiataylor.com`, tag, name },
    { ...fallback({ label, local, tag }), name },
  ].filter((s) => Boolean(s.key));
}

/**
 * The Resend payload for an employee's message, IN THE ONE PLAIN LAYOUT (owner, 22 Oct 2026).
 *
 * Every Mac email she gets is built here, so every one passes through `src/shared/boss/mail/plain.mjs`:
 * a plain subject (no `#tag`, no brackets, no ids, no capitals, no repeated names), the first line
 * saying what happened, "Decide (N)" with one-tap buttons (or "Nothing to decide"), the sections, her
 * employee's name once. A caller that has the parts passes `layout: { happened, decide, sections,
 * footer }` or a `prelaid` email (`layoutEmail` / `layoutProblem`); a caller that
 * still writes one block of text is fitted to the layout by `fromLegacy`.
 *
 * THE TAG LEFT THE SUBJECT, AND REPLIES STILL ROUTE. Reply-To is the employee's own address, which
 * Email Routing delivers to the Worker and `routeToSeat` reads (the `to` it is given), so the tag in
 * the subject was the belt and the address is the braces. The job token (`[rc_…]`, `[tsk_…]` …) goes
 * in the `X-Boss-Ref` header and, after the send, against the Message-ID her client will quote back
 * (`postEmployeeMail` → `/api/boss/mail-refs`).
 */
export function employeeMail(sender, { to, subject, text, html: _html, files, layout = null, refs = [], prelaid = null }) {
  /*
   * R18 (docs/SERVICE_RULES.md) — FILES FOR HER RIDE ON THE EMAIL. Every Mac lane sends through this
   * one function, so every lane can hand her a file: listed by name always, attached up to 10 MB in
   * total, and a file too large to attach says where it is on her Mac. `outboundFilesPlan` decides.
   */
  const plan = outboundFilesPlan(files ?? []);
  const attachments = plan.attach.map((i) => ({ filename: files[i].name, content: readFileSync(files[i].path).toString("base64") }));
  const who = sender.name ?? "Simone";
  const fileLines = plan.lines.length ? [{ heading: "Files" }, ...plan.lines] : [];
  // `prelaid` is an email a caller already built with `layoutEmail` (Simone's daily): used as it is.
  const laid = prelaid ?? (layout
    ? layoutEmail({ who, subject, ...layout, details: [...(layout.details ?? []), ...fileLines], refs })
    : fromLegacy({ who, subject, text: String(text ?? "").slice(0, 60_000) + (plan.lines.length ? `\n\nFiles:\n${plan.lines.map((l) => `- ${l}`).join("\n")}` : ""), refs }));
  return {
    from: sender.from,
    to: Array.isArray(to) ? to : [to],
    reply_to: sender.reply_to,
    subject: laid.subject.slice(0, 200),
    text: laid.text,
    html: laid.html,
    ...(laid.refs.length || laid.kind === "problem" || laid.kind === "morning"
      ? { headers: { ...(laid.refs.length ? { "X-Boss-Ref": laid.refs.join(" ") } : {}), ...(laid.kind === "problem" || laid.kind === "morning" ? { "X-Boss-Kind": laid.kind } : {}) } }
      : {}),
    ...(attachments.length ? { attachments } : {}),
  };
}

const RESEND = "https://api.resend.com/emails";
const BOSS_ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";

/**
 * THE ONE POST TO RESEND. Every Mac sender calls this with an `employeeMail` payload, so no email
 * can skip the layout (`tests/plainEmail.test.ts` fails if any other file posts to Resend).
 *
 * Returns Resend's own Response, unread, so callers keep their existing `res.ok` / `res.json()`.
 * When the payload carries job refs, the sent message's Message-ID is read back from Resend and
 * recorded in Boss OS, so her reply — which quotes that Message-ID in `References` — lands on the
 * job without any code in the subject. A refs record that fails is said on stderr by name; the
 * email itself has gone and is not retried.
 */
export async function postEmployeeMail(sender, payload, fetchImpl = fetch, { context = null } = {}) {
  const held = mailGate(payload);
  if (held.length) return holdMail(sender, payload, held, fetchImpl);
  const res = await fetchImpl(RESEND, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${sender.key}` },
    body: JSON.stringify(payload),
  });
  const refs = String(payload?.headers?.["X-Boss-Ref"] ?? "").split(/\s+/).filter(Boolean);
  if (res.ok && refs.length) {
    let why;
    try {
      if (!process.env.BOSS_PASSCODE) why = "no BOSS_PASSCODE in the environment (run through the vault)";
      else {
        const id = typeof res.clone === "function" ? ((await res.clone().json().catch(() => ({})))?.id ?? null) : null;
        why = await recordMailRefs({ key: sender.key, id, refs, payload, context }, fetchImpl);
      }
    } catch (e) { why = String(e?.message ?? e); }
    if (why) console.error(`NAMED STOP [REFS_NOT_RECORDED] ${why} — a reply to "${payload.subject}" will not find its job by its thread.`);
  }
  return res;
}

/**
 * THE SEND-TIME GATE (rule 13, owner 23 Oct 2026). Every Mac email reaches Resend only through
 * `postEmployeeMail`, so every sender — Simone's morning email, Monique's, the LP drafts, a task
 * notice — is checked here against `plainProblems` (src/shared/boss/mail/plain.mjs) on exactly what
 * would be sent. `[]` means it may go.
 */
export function mailGate(payload) {
  const kind = payload?.headers?.["X-Boss-Kind"] ?? null;
  return plainProblems({ subject: payload?.subject, text: payload?.text, html: payload?.html, kind });
}

export const heldDir = () => process.env.BOSS_OS_HELD_MAIL_DIR ?? join(homedir(), ".boss-os", "held-mail");

/**
 * A FAILING EMAIL IS HELD, NEVER SENT: written to ~/.boss-os/held-mail (what it said and why it was
 * held), and handed to Danielle as a fix job — once per distinct email, so the fallback sender or a
 * retry does not open a second job. Returns a refused Response (422) so every caller's existing
 * "refused" path runs: nothing is reported as sent.
 */
export async function holdMail(sender, payload, problems, fetchImpl = fetch) {
  const key = createHash("sha256").update(`${payload?.subject}\n${payload?.text}`).digest("hex").slice(0, 16);
  const HELD_DIR = heldDir();
  const file = join(HELD_DIR, `${key}.json`);
  const first = !existsSync(file);
  try {
    mkdirSync(HELD_DIR, { recursive: true });
    if (first) writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), from: sender?.from ?? null, subject: payload?.subject, problems, text: payload?.text }, null, 2));
  } catch (e) { console.error(`  could not write the held email to ${HELD_DIR}: ${e?.message ?? e}`); }
  console.error(`HELD "${payload?.subject}" — not sent; it failed the plain-email check: ${problems.join("; ")}`);
  if (first) {
    let why = null;
    try {
      if (!process.env.BOSS_PASSCODE) why = "no BOSS_PASSCODE in the environment";
      else {
        const cookie = await bossCookieFor(fetchImpl);
        const r = await fetchImpl(`${BOSS_ORIGIN}/api/boss/tasks`, {
          method: "POST", headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({
            title: `Fix a held email: ${String(payload?.subject ?? "").slice(0, 120)}`,
            lane: "ops", employee_id: "emp_repo",
            input: { prompt: `seq23/boss-os — an email to the owner was held by the plain-email gate (scripts/ops/notify.mjs mailGate) and not sent. Problems: ${problems.join("; ")}. The held copy is ${file} on her Mac. Fix the sender at source so it writes plainly (src/shared/boss/mail/plain.mjs layoutEmail / layoutProblem), keep tests/plainEmail.test.ts green, and let the next run send it.` },
          }),
        });
        if (!r.ok) why = `Boss OS refused the fix job (${r.status})`;
      }
    } catch (e) { why = String(e?.message ?? e); }
    if (why) console.error(`  the fix job for the held email was not opened: ${why}`);
  }
  return new Response(JSON.stringify({ held: true, problems }), { status: 422, headers: { "content-type": "application/json" } });
}

let bossCookie = null;
async function bossCookieFor(fetchImpl) {
  if (bossCookie) return bossCookie;
  if (!process.env.BOSS_PASSCODE) throw new Error("no BOSS_PASSCODE in the environment (run through the vault)");
  const r = await fetchImpl(`${BOSS_ORIGIN}/api/boss/auth/unlock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }) });
  if (!r.ok) throw new Error(`Boss OS refused the passcode (${r.status})`);
  bossCookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  return bossCookie;
}

/** Message-ID from Resend (it is filled once the message is accepted), then the record in Boss OS. */
export async function recordMailRefs({ key, id, refs, payload, context = null }, fetchImpl = fetch, { tries = 4, waitMs = 1500 } = {}) {
  if (!id) return "Resend returned no email id";
  let messageId = null;
  for (let i = 0; i < tries && !messageId; i += 1) {
    if (i) await new Promise((r) => setTimeout(r, waitMs));
    const g = await fetchImpl(`${RESEND}/${id}`, { headers: { authorization: `Bearer ${key}` } }).catch(() => null);
    messageId = g?.ok ? ((await g.json().catch(() => ({})))?.message_id ?? null) : null;
  }
  if (!messageId) return `Resend gave no Message-ID for ${id}`;
  const cookie = await bossCookieFor(fetchImpl);
  const r = await fetchImpl(`${BOSS_ORIGIN}/api/boss/mail-refs`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ message_id: messageId, refs, subject: payload.subject, sender: payload.reply_to, context: String(context ?? payload.text ?? "").slice(0, 6000) }),
  });
  return r.ok ? null : `Boss OS refused the refs record (${r.status})`;
}

/**
 * Send as an employee, every sender on the roster's list in turn. `{ ok, id, from, fallback }` or
 * `{ ok: false, error }`. The shape new callers use; older callers keep their own loop around
 * `postEmployeeMail`.
 */
export async function sendAsEmployee(who, msg, fetchImpl = fetch) {
  const senders = sendersFor(who);
  if (senders.length === 0) return { ok: false, error: "no Resend key in the environment (BOSS_OS_MAIL_KEY / BOSS_OS_FALLBACK_MAIL_KEY)" };
  let last = "";
  for (const sender of senders) {
    const res = await postEmployeeMail(sender, employeeMail(sender, msg), fetchImpl, { context: msg.context ?? null });
    if (res.ok) {
      const id = (await res.json().catch(() => ({})))?.id ?? null;
      if (sender.fallback) console.log(FALLBACK_STOP);
      return { ok: true, id, from: sender.from, fallback: Boolean(sender.fallback) };
    }
    last = `${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`;
    console.error(`  ${sender.from} refused: ${last}`);
  }
  return { ok: false, error: last || "every sender was refused" };
}

/** "OpenAI (4) and Blue Origin": each name once, with how many times it came up (owner, 22 Oct 2026). */
export function namesOnce(names) {
  const counts = new Map();
  for (const n of names ?? []) { const k = String(n).trim(); if (k) counts.set(k, (counts.get(k) ?? 0) + 1); }
  const parts = [...counts].map(([n, c]) => (c > 1 ? `${n} (${c})` : n));
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** `{ name, bytes, path }` for each readable file path; an unreadable one is listed as such. */
export function filesAt(paths) {
  return (paths ?? []).map((p) => {
    try { return { name: basename(p), bytes: statSync(p).size, path: p }; } catch { return { name: basename(String(p)), bytes: 0, path: null }; }
  });
}

/** The roster's local parts — what `validate:employee-addresses-receive` checks routing rules for. */
export const EMPLOYEE_LOCAL_PARTS = Object.values(ROSTER).filter((l) => l !== "boss");

async function main() {
  const subject = (arg("subject") ?? "").trim();
  const body = (arg("body") ?? "").trim();

  if (!subject || !body) {
    console.error("NAMED STOP [NOTHING_TO_SAY] --subject and --body are both required.");
    console.error("  A notification with no content is a push that teaches her to ignore the next one.");
    process.exit(2);
  }

  const SENDERS = sendersFor(arg("from") ?? process.env.BOSS_NOTIFY_AS ?? null);

  if (SENDERS.length === 0) {
    console.error("NAMED STOP [NO_RESEND_KEY] neither BOSS_OS_MAIL_KEY nor BOSS_OS_FALLBACK_MAIL_KEY is set.");
    console.error("  Run this through the vault: npm run notify -- --subject ... --body ...");
    process.exit(4);
  }

  let lastErr = "";
  for (const sender of SENDERS) {
    const { from, key } = sender;
    const res = await postEmployeeMail(sender, employeeMail(sender, { to: TO, subject, text: body.slice(0, 4000), files: filesAt(args("file")) }));
    if (res.ok) {
      const id = (await res.json().catch(() => ({})))?.id ?? "";
      console.log(`Notified from ${from}: ${subject}${id ? ` (${id})` : ""}`);
      if (sender.fallback) console.log(`  ${FALLBACK_STOP} The message went; the identity on it is the fallback.`);
      return;
    }
    lastErr = `${res.status} ${(await res.text()).slice(0, 200)}`;
    console.error(`  ${from} refused: ${lastErr}`);
  }

  console.error(`NAMED STOP [SEND_REFUSED] every sender was refused. Last: ${lastErr}`);
  console.error("  A 403 here is the sender domain not being verified on the account whose key was used.");
  console.error("  The Boss OS report is the channel of record and is unaffected — she will still see this on Today.");
  process.exit(5);
}

/**
 * Only run when invoked directly. `lp-outcomes.mjs` imports `sendersFor` from here so the roster
 * exists in exactly one place; without this guard that import would also fire the notifier and exit
 * the process on a missing --from.
 */
if (import.meta.url === `file://${process.argv[1]}`) {
main().catch((err) => {
  console.error(`notify failed: ${err?.message ?? err}`);
  process.exitCode = 1;
});
}
