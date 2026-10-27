/**
 * SIMONE DOES IT BY EMAIL — THE WORKER HALF.
 *
 * Owner, 25 Oct 2026: whatever a Claude session could do with her tools, an email from her to Simone
 * (or boss@) does too, with no employee named. This is the existing intake extended, not a second
 * one: `handleBossInboundMail` calls `commandFromMail` after the secret door and the block answers,
 * before the lanes and triage; when it returns null (nothing here is a command) the email goes on to
 * the ordinary triage exactly as before.
 *
 *   invite   → clash check, then the event with a Meet link on her Workspace calendar, confirmed in
 *              one plain line; her personal Gmail calendar gets a one-tap "Add to my calendar" link.
 *              A bounce (seen by the Mac) asks for the right address; the reply updates THE SAME event.
 *   lookup   → her own Drive and Gmail, searched on her Mac seat (scripts/ops/simone-commands.mjs);
 *              candidates come back with evidence, and she picks when more than one is plausible.
 *   email    → drafted in her voice on the Mac, shown to her word for word with Send / Change / Try
 *              again. NOTHING GOES TO A THIRD PARTY UNTIL SHE TAPS SEND OR REPLIES "send" — the only
 *              path to `sendOne` is `sendApprovedEmail`, which reads the row's `approved` state.
 *   repo     → Danielle's existing repo-change lane (admitTask on emp_repo, by GitHub address). Never inline.
 *   cant_yet → one line, and a Danielle job to add the ability. Never silence, never a bare "can't".
 */
import type { Env } from "../env";
import { todoEditsIn, matchTodo } from "../../../shared/boss/waiting/register.mjs";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { admitTask } from "../tasks/admit";
import {
  commandsIn, commandReplyIn, ownWords, readErrandReply, errandAnswerIn, errandFollowUpText, errandCancelText, followUpProblems, partyIn, errandDateIn, bookingAt, bookingWhen, reminderDueAt, ERRAND_TZ, errandReplyNotice, confirmLine, renderUrl, slotText, zoneLabel, OWNER_TZ, DEFAULT_MAILBOX, codeLines, ACCESS_CODE_SHAPE,
} from "../../../shared/boss/commands/parse.mjs";
import { clashes, createInvite, replaceGuest, deleteInvite, sendOne } from "./google";

export const ORIGIN = "https://boss.sequoiataylor.com";

export interface CommandRow {
  id: string; mail_id: string | null; kind: string; state: string; spec: string; result: string;
  waits_on: string | null; task_id: string | null; change_id: string | null; tap_token: string | null;
  notice: string | null; notice_state: string; created_at: number; updated_at: number;
}
type Json = Record<string, any>;
const j = (s: string | null | undefined): Json => { try { return JSON.parse(s || "{}") ?? {}; } catch { return {}; } };

export async function getCommand(env: Env, id: string): Promise<CommandRow | null> {
  return (await env.DB.prepare(`SELECT * FROM boss_commands WHERE id = ?`).bind(id).first<CommandRow>()) ?? null;
}
async function save(env: Env, id: string, patch: { state?: string; spec?: Json; result?: Json; waits_on?: string | null; task_id?: string | null; change_id?: string | null; tap_token?: string | null }, now = Date.now()) {
  const sets: string[] = []; const vals: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?`); vals.push(k === "spec" || k === "result" ? JSON.stringify(v) : v);
  }
  sets.push("updated_at = ?"); vals.push(now);
  await env.DB.prepare(`UPDATE boss_commands SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id).run();
}

/** A plain email the Mac owes her (the Worker can only answer HER mail; anything later goes from the Mac). */
export interface Notice {
  subject: string; happened: string; details?: string[]; decide?: Json[];
  /** What the Mac also writes into her morning email (an errand's answer): a line, or a Decide item. */
  morning?: { line?: string; decide?: Json };
}
async function owe(env: Env, id: string, notice: Notice) {
  await env.DB.prepare(`UPDATE boss_commands SET notice = ?, notice_state = 'due', updated_at = ? WHERE id = ?`).bind(JSON.stringify(notice), Date.now(), id).run();
}

function tapToken(): string {
  const a = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const r = crypto.getRandomValues(new Uint8Array(28));
  return "cmd" + [...r].map((b) => a[b % a.length]).join("");
}
export const tapUrl = (token: string, action: string) => `${ORIGIN}/tap/${token}?do=${action}`;

const who = (spec: Json) => spec.guest_name ? `${spec.guest_name} (${spec.guest_email})` : spec.guest_email;

// ─── Invite ────────────────────────────────────────────────────────────────

/** Run an invite as far as it can go now. Returns the one line she is told. */
async function runInvite(env: Env, row: CommandRow, now: number): Promise<string> {
  const spec = j(row.spec);
  if (spec.when_error || !spec.start) {
    await save(env, row.id, { state: "needs_time" }, now);
    return `The invite${spec.guest_name ? ` to ${spec.guest_name}` : ""}: I couldn't tell the time (${spec.when_error ?? "no time"}). Reply with the day and time, e.g. "Tuesday 10am ET".`;
  }
  if (!spec.guest_email) {
    if (row.waits_on) { await save(env, row.id, { state: "waiting" }, now); return `The invite to ${spec.guest_name}: I'm finding their address first, then I'll send it.`; }
    await save(env, row.id, { state: "needs_address" }, now);
    return `The invite${spec.guest_name ? ` to ${spec.guest_name}` : ""}: what's their email address? Reply with it and I'll send the invite.`;
  }
  const minutes = Number(spec.minutes) || 30;
  if (spec.calendar === "personal") {
    const url = renderUrl({ title: spec.title, start: spec.start, minutes, guests: [spec.guest_email], details: "Add a Google Meet link before you save." });
    await save(env, row.id, { state: "add_link", result: { url } }, now);
    return `Your personal Gmail calendar can't be written by anyone but you, so here is a one-tap link with ${who(spec)} already on it as a guest, for ${slotText(spec.start, minutes, OWNER_TZ)} Central: ${url}`;
  }
  const mailbox = spec.calendar || DEFAULT_MAILBOX;
  const end = spec.start + minutes * 60_000;
  if (!spec.anyway) {
    const c = await clashes(env, mailbox, spec.start, end);
    if (!c.ok) {
      await save(env, row.id, { state: "failed", result: { why: c.why } }, now);
      return await cantYetLine(env, row, `create invites on ${mailbox} (${c.why})`, now);
    }
    if (c.busy.length) {
      await save(env, row.id, { state: "clash", result: { busy: c.busy } }, now);
      const b = c.busy[0]!;
      return `The invite to ${who(spec)}: ${slotText(spec.start, minutes, OWNER_TZ)} Central clashes with "${b.title}" (${slotText(b.start, Math.round((b.end - b.start) / 60_000), OWNER_TZ)}). Nothing was sent. Reply "book it anyway", or a new day and time.`;
    }
  }
  const made = await createInvite(env, { mailbox, title: spec.title, start: spec.start, minutes, guests: [spec.guest_email], requestId: row.id });
  if (!made.ok) {
    await save(env, row.id, { state: "failed", result: { why: made.why } }, now);
    return await cantYetLine(env, row, `create invites on ${mailbox} (${made.why})`, now);
  }
  await save(env, row.id, { state: "created", result: { event_id: made.eventId, meet: made.meet, link: made.htmlLink, mailbox, sent_at: now, guest: spec.guest_email } }, now);
  await audit(env.DB, { actor: "boss", lane: "ops", entityType: "boss_command", entityId: row.id, action: "invite_created", detail: { mailbox, event_id: made.eventId } });
  return confirmLine({ guestName: spec.guest_name, guestEmail: spec.guest_email, start: spec.start, minutes, tz: spec.tz, meet: made.meet, calendar: mailbox });
}

// ─── Email to a person ─────────────────────────────────────────────────────

/** The draft card: the email word for word and the three taps. */
function draftCard(row: CommandRow, spec: Json, result: Json): Json {
  const token = row.tap_token!;
  return {
    title: `Email to ${spec.recipient_name ? `${spec.recipient_name} (${spec.to})` : spec.to}`,
    body: `From ${spec.from_mailbox}. Subject: ${result.draft_subject}. It goes only when you tap Send.`,
    details: (result.evidence ?? []).slice(0, 3).map((e: string) => `How I know the address: ${e}`),
    draft: { heading: "The email, word for word (Send sends exactly this)", text: result.draft_text },
    buttons: [
      { label: "Send", url: tapUrl(token, "send") },
      { label: "Change", url: tapUrl(token, "change") },
      { label: "Try again", url: tapUrl(token, "retry") },
    ],
  };
}

/** Is everything this email waits on done? The repo job gates the SEND, never the draft. */
async function repoReady(env: Env, row: CommandRow): Promise<{ ready: boolean; what: string | null }> {
  for (const id of (row.waits_on ?? "").split(",").filter(Boolean)) {
    const dep = await getCommand(env, id);
    if (dep?.kind === "access_code") {
      if (dep.state !== "done") return { ready: false, what: `the ${j(dep.spec).code} code being made` };
      continue;
    }
    if (!dep || dep.kind !== "repo") continue;
    const rc = dep.change_id ? await env.DB.prepare(`SELECT phase FROM repo_changes WHERE id = ?`).bind(dep.change_id).first<{ phase: string }>() : null;
    if (rc?.phase !== "done") return { ready: false, what: j(dep.spec).instruction ?? "the repo change" };
  }
  return { ready: true, what: null };
}

/**
 * THE ONLY PATH TO A SEND. The row must be `approved` — set only by her Send tap or her "send" reply —
 * and carry the exact words she was shown. Anything else refuses and says why.
 */
export async function sendApprovedEmail(env: Env, id: string, now = Date.now()): Promise<{ sent: boolean; line: string }> {
  const row = await getCommand(env, id);
  if (!row || row.kind !== "email") return { sent: false, line: "Nothing to send here." };
  if (row.state === "sent") return { sent: false, line: "Already sent." };
  if (row.state !== "approved") return { sent: false, line: "Not sent: it was never approved." };
  const spec = j(row.spec); const result = j(row.result);
  if (!spec.to || !result.draft_text || !result.draft_subject) return { sent: false, line: "Not sent: the email has no recipient or no words yet." };
  const gate = await repoReady(env, row);
  if (!gate.ready) {
    await save(env, id, { state: "held" }, now);
    return { sent: false, line: `Held until Danielle's change is live (${gate.what}). It goes on its own the moment it lands, exactly as you saw it.` };
  }
  const out = await sendOne(env, { from: spec.from_mailbox, to: spec.to, subject: result.draft_subject, text: result.draft_text, command_id: row.id });
  if (!out.ok) {
    await save(env, id, { state: "approved", result: { ...result, send_error: out.why } }, now);
    return { sent: false, line: `Not sent yet: ${out.why}. Danielle has it, and it goes once that is fixed.` };
  }
  await save(env, id, { state: "sent", result: { ...result, message_id: out.messageId, sent_at: now } }, now);
  await audit(env.DB, { actor: "owner", lane: "ops", entityType: "boss_command", entityId: id, action: "email_sent_on_her_word", detail: { from: spec.from_mailbox, message_id: out.messageId } });
  return { sent: true, line: `Sent to ${spec.recipient_name ? `${spec.recipient_name} (${spec.to})` : spec.to} from ${spec.from_mailbox}.` };
}

/** Her Send (tap or reply). Approves exactly what she was shown, then sends or holds. */
export async function approveAndSend(env: Env, row: CommandRow, now = Date.now()): Promise<string> {
  if (row.state !== "shown") return row.state === "sent" ? "That email has already gone." : "There is no draft waiting for your Send on this one yet.";
  await save(env, row.id, { state: "approved" }, now);
  return (await sendApprovedEmail(env, row.id, now)).line;
}

export async function redraft(env: Env, row: CommandRow, note: string | null, now = Date.now()): Promise<string> {
  if (!["shown", "drafting", "approved", "held"].includes(row.state)) return "There is no draft on this one to change.";
  const result = j(row.result);
  await save(env, row.id, { state: "drafting", result: { ...result, change_note: note, previous: note ? result.draft_text ?? null : null } }, now);
  return note ? `Changing it: "${note}". The new version comes to you word for word, and nothing goes until you tap Send.` : "Writing a fresh version. It comes to you word for word, and nothing goes until you tap Send.";
}

// ─── Lookups ───────────────────────────────────────────────────────────────

/** A person's address is settled: everything waiting on it moves. Returns lines for her. */
async function addressFound(env: Env, lookup: CommandRow, email: string, evidence: string[], now: number): Promise<string[]> {
  await save(env, lookup.id, { state: "found", result: { ...j(lookup.result), chosen: email, evidence } }, now);
  const { results } = await env.DB.prepare(`SELECT * FROM boss_commands WHERE instr(waits_on, ?) > 0 AND state IN ('waiting','needs_address')`).bind(lookup.id).all<CommandRow>();
  const lines: string[] = [];
  for (const dep of results ?? []) {
    const spec = j(dep.spec);
    if (dep.kind === "invite") {
      await save(env, dep.id, { spec: { ...spec, guest_email: email } }, now);
      lines.push(await runInvite(env, (await getCommand(env, dep.id))!, now));
    } else if (dep.kind === "email") {
      await save(env, dep.id, { state: "drafting", spec: { ...spec, to: email }, result: { ...j(dep.result), evidence } }, now);
      lines.push(`Drafting the email to ${spec.recipient_name ?? email} now. You'll see it word for word before anything goes.`);
    }
  }
  return lines;
}

/** The Mac's answer to a lookup: candidates with evidence. One → carry on; several → she picks; none → ask. */
export async function lookupAnswered(env: Env, id: string, candidates: Array<{ email: string; name?: string; evidence?: string[] }>, now = Date.now()): Promise<void> {
  const row = await getCommand(env, id);
  if (!row || row.kind !== "lookup") return;
  const spec = j(row.spec);
  const clean = candidates
    .filter((c) => c && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(String(c.email ?? "")) && Array.isArray(c.evidence) && c.evidence.length > 0)
    .map((c) => ({ email: c.email.toLowerCase(), name: c.name ?? null, evidence: c.evidence!.map((e) => String(e).slice(0, 240)).slice(0, 4) }));
  const seen = new Set<string>();
  const list = clean.filter((c) => (seen.has(c.email) ? false : (seen.add(c.email), true))).slice(0, 5);
  const subject = `${spec.name}'s email`;
  if (list.length === 0) {
    await save(env, id, { state: "none", result: { candidates: [] } }, now);
    await owe(env, id, { subject, happened: `I couldn't find ${spec.name}'s email in your Drive or your Gmail${spec.hints?.length ? ` (I looked for "${spec.hints.join('", "')}")` : ""}.`, details: ["Reply with the address and I'll carry on from there. Nothing has been sent."] });
    return;
  }
  if (list.length === 1) {
    const c = list[0]!;
    const lines = await addressFound(env, row, c.email, c.evidence, now);
    await owe(env, id, { subject, happened: `Found ${spec.name}'s email: ${c.email}.`, details: [...c.evidence.map((e) => `Evidence: ${e}`), ...lines, "If that's the wrong person, reply with the right address."] });
    return;
  }
  await save(env, id, { state: "picking", result: { candidates: list } }, now);
  await owe(env, id, {
    subject, happened: `I found ${list.length} addresses that could be ${spec.name}'s. Which one? Reply with the number (or the address). Nothing has been sent.`,
    details: list.map((c, i) => `${i + 1}. ${c.email}${c.name ? ` (${c.name})` : ""}: ${c.evidence.join("; ")}`),
  });
}

/** The Mac's draft, in her voice: shown to her word for word with Send / Change / Try again. */
export async function draftReady(env: Env, id: string, draft: { subject: string; text: string }, now = Date.now()): Promise<void> {
  const row = await getCommand(env, id);
  if (!row || row.kind !== "email" || row.state !== "drafting") return;
  const spec = j(row.spec);
  const result = { ...j(row.result), draft_subject: String(draft.subject).slice(0, 200), draft_text: String(draft.text).slice(0, 8000), shown_at: now };
  const token = row.tap_token ?? tapToken();
  await save(env, id, { state: "shown", result, tap_token: token }, now);
  const fresh = (await getCommand(env, id))!;
  const gate = await repoReady(env, fresh);
  await owe(env, id, {
    subject: `Email to ${spec.recipient_name ?? spec.to}: ready for your Send`,
    happened: `Here is the email to ${spec.recipient_name ?? spec.to}, word for word. It goes only when you tap Send (or reply "send").`,
    details: gate.ready ? [] : [`If you tap Send before Danielle's change is live (${gate.what}), it waits and goes the moment that lands.`],
    decide: [draftCard(fresh, spec, result)],
  });
}

/** The Mac saw a bounce for an address Simone used. Ask for the right one; her reply fixes the same event. */
export async function bounced(env: Env, id: string, address: string, now = Date.now()): Promise<void> {
  const row = await getCommand(env, id);
  if (!row || !["created", "sent"].includes(row.state)) return;
  const spec = j(row.spec);
  await save(env, id, { state: "bounced", result: { ...j(row.result), bounced: address, bounced_at: now } }, now);
  const what = row.kind === "invite" ? `The invite to ${spec.guest_name ?? address}` : `The email to ${spec.recipient_name ?? address}`;
  const body = row.kind === "invite" ? "Reply with it and I'll put them on the same invite (no new event)." : "Reply with it and I'll send the same email there.";
  await owe(env, id, {
    subject: `${what} bounced`,
    happened: `${what} bounced: ${address} doesn't take mail. What's the right address?`,
    details: [body],
    decide: [{ title: "What's the right address?", body }],
  });
}

// ─── time-2-read access codes (a row in its Supabase table; no rebuild) ──

async function queueCode(env: Env, row: CommandRow, spec: Json, now: number): Promise<string> {
  if (spec.error) {
    await save(env, row.id, { state: "needs_info" }, now);
    return `The ${spec.code} code: tell me ${spec.error} and I'll make it.`;
  }
  await save(env, row.id, { state: "queued" }, now);
  if (spec.op === "create") return `Making the time-2-read code ${spec.code}: a ${spec.trial_days}-day trial${spec.label ? ` for ${spec.label}` : ""}. No rebuild needed; I'll confirm it with how many people have used each code so far.`;
  if (spec.op === "off") return `Turning off the time-2-read code ${spec.code}. I'll confirm when it no longer works.`;
  return spec.code ? `Counting who has used ${spec.code}. The number comes in my next email.` : "Counting who has used each time-2-read code. The numbers come in my next email.";
}

/** The Mac's answer from the access-code table: the counts for her, and anything waiting on the code moves. */
export async function codeAnswered(env: Env, id: string, out: { done: boolean; already?: boolean; missing?: boolean; codes: Array<Record<string, any>> }, now = Date.now()): Promise<void> {
  const row = await getCommand(env, id);
  if (!row || row.kind !== "access_code") return;
  const spec = j(row.spec);
  const mine = out.codes.filter((c) => !spec.code || c.code === spec.code);
  const all = codeLines(out.codes as never);
  await save(env, id, { state: out.missing ? "failed" : "done", result: { codes: out.codes, already: Boolean(out.already) } }, now);
  let happened: string;
  if (out.missing) happened = `There is no time-2-read code called ${spec.code}, so nothing changed.`;
  else if (spec.op === "create") happened = out.already
    ? `${spec.code} already existed, so I left it as it is: ${codeLines(mine as never)[0] ?? ""}`
    : `Made the time-2-read code ${spec.code}: a ${spec.trial_days}-day trial${spec.label ? ` for ${spec.label}` : ""}. It works now; nothing was rebuilt.`;
  else if (spec.op === "off") happened = `Turned off ${spec.code}. Anyone who types it now is told it isn't valid.`;
  else happened = spec.code ? (codeLines(mine as never)[0] ?? `No code called ${spec.code}.`) : `Here's how each time-2-read code has done.`;
  const waiting = (await env.DB.prepare(`SELECT id FROM boss_commands WHERE instr(waits_on, ?) > 0 AND kind = 'email' AND state = 'held'`).bind(id).all<{ id: string }>()).results ?? [];
  for (const w of waiting) {
    const r = await getCommand(env, w.id);
    if (r && (await repoReady(env, r)).ready) { await save(env, w.id, { state: "approved" }, now); await sendApprovedEmail(env, w.id, now); }
  }
  await owe(env, id, { subject: `time-2-read code ${spec.code ?? "counts"}`, happened, details: ["Every code so far:", ...all] });
}

// ─── Danielle ──────────────────────────────────────────────────────────────

async function danielle(env: Env, input: { title: string; body: string; mailId: string; sender: string }): Promise<{ taskId: string | null; changeId: string | null; why: string | null }> {
  try {
    const seat = await env.DB.prepare(`SELECT lane FROM employees WHERE id = 'emp_repo'`).first<{ lane: string }>();
    const admitted = await admitTask(env, {
      title: input.title.slice(0, 160), lane: seat?.lane ?? "ops", employee_id: "emp_repo",
      input: { source: "boss_inbound_mail", mail_id: input.mailId, from: input.sender, routing: "Simone handed it to Danielle's repo lane.", build_ask: true, body: input.body },
    } as never);
    if (!admitted.created || !admitted.task_id) return { taskId: null, changeId: null, why: admitted.reason ?? "intake refused it" };
    const rc = await env.DB.prepare(`SELECT id FROM repo_changes WHERE task_id = ?`).bind(admitted.task_id).first<{ id: string }>().catch(() => null);
    return { taskId: admitted.task_id, changeId: rc?.id ?? null, why: null };
  } catch (err) {
    return { taskId: null, changeId: null, why: err instanceof Error ? err.message : String(err) };
  }
}

/** "I can't do X yet" — one line, and a Danielle job in seq23/boss-os to add it. */
async function cantYetLine(env: Env, row: CommandRow, what: string, now: number): Promise<string> {
  const d = await danielle(env, {
    title: `Give Simone the ability to ${what.split(" (")[0]} by email`,
    body: `seq23/boss-os — Simone could not ${what} for an email from the owner. Add it so the same email works next time (src/worker/boss/commands/, src/shared/boss/commands/parse.mjs). Her words: ${j(row.spec).ask ?? j(row.spec).title ?? ""}`.slice(0, 4000),
    mailId: row.mail_id ?? "", sender: "simone",
  });
  await save(env, row.id, { task_id: d.taskId }, now);
  return `I can't ${what} yet. Danielle has a job to add it${d.taskId ? "" : ` (it could not be opened: ${d.why})`}, and I'll tell you when it works.`;
}

// ─── From her email ────────────────────────────────────────────────────────

export interface CommandMailResult {
  reply: string; outcome: "COMMAND" | "COMMAND_REPLY"; commandIds: string[]; taskId: string | null;
  /** One row per command for the handoff screen: what it is and who has it (Simone, or Danielle for repo work). */
  jobs?: Array<{ title: string; employeeId: string; employee: string; taskId: string | null; duty: false; failure: null }>;
}

/** A command's short title for the handoff list. */
function commandTitle(kind: string, spec: Json): string {
  if (kind === "lookup") return `Find ${spec.name ?? "their"}'s email`;
  if (kind === "invite") return `Invite ${spec.guest_name ?? spec.guest_email ?? "a guest"}`;
  if (kind === "repo") return `${spec.product}: ${String(spec.instruction ?? "").slice(0, 50)}`;
  if (kind === "access_code") return `Access code${spec.code ? ` ${spec.code}` : ""}`;
  if (kind === "email") return `Email to ${spec.recipient_name ?? spec.to ?? "them"}`;
  if (kind === "errand") return `Request to ${spec.to}`;
  if (kind === "meeting_prep") return `Meeting prep: ${spec.who ?? "a meeting"}`;
  return String(spec.what ?? kind).slice(0, 60);
}

/**
 * The intake's door into this file. A reply on a command's thread answers that command; a new email
 * with commands in it creates them. Null means "not a command" and the ordinary triage takes it.
 */
export async function commandFromMail(env: Env, input: { subject: string; text: string; mailId: string; sender: string; refs: string[]; now: number; to?: string; ownerName?: string }): Promise<CommandMailResult | null> {
  const cmdRefs = input.refs.filter((r) => r.startsWith("cmd_"));
  if (cmdRefs.length) {
    const rows: CommandRow[] = [];
    for (const id of cmdRefs) { const r = await getCommand(env, id); if (r) rows.push(r); }
    if (rows.length) {
      const reply = await answerCommands(env, rows, input.text, input.now);
      if (reply) return { reply, outcome: "COMMAND_REPLY", commandIds: rows.map((r) => r.id), taskId: null };
    }
  }
  /*
   * HER CHOICE OF DESK WINS. Mail to another employee's own address, a #tag for anyone but Simone,
   * or a reply on another lane's thread is that desk's, exactly as before; only mail to Simone or
   * boss@ with no other desk named is read for commands.
   */
  const local = String(input.to ?? "boss@").split("@")[0]!.toLowerCase();
  if (!["boss", "simone"].includes(local)) return null;
  const tags = (`${input.subject}\n${input.text}`.match(/(?:^|\s)#([a-z][a-z0-9_-]*)/gi) ?? []).map((t) => t.trim().slice(1).toLowerCase());
  if (tags.some((t) => t !== "simone")) return null;
  // HER OWN LIST, EDITED BY REPLY (owner, 26 Oct 2026): "add: X" / "done: X" to Simone, including a
  // reply to the morning email, changes "Yours this week" (waiting_on rows she owns) and nothing else.
  const edits = todoEditsIn(input.text);
  const open = edits.add.length || edits.done.length
    ? (await env.DB.prepare(`SELECT id, kind, what, state FROM waiting_on WHERE kind = 'her_todo' AND state = 'open'`).all<any>()).results ?? []
    : [];
  edits.done = edits.done.filter((w) => matchTodo(open, w));
  if (edits.add.length || edits.done.length) {
    const said: string[] = [];
    for (const what of edits.add) {
      await env.DB.prepare(`INSERT INTO waiting_on (id, kind, what, owner, surfaces_in, created_at, updated_at) VALUES (?, 'her_todo', ?, 'sequoia', 'Simone''s morning email: Yours this week', ?, ?)`)
        .bind(newId("wo"), what.slice(0, 300), input.now, input.now).run();
      said.push(`Added to your list: ${what}.`);
    }
    for (const words of edits.done) {
      const hit = matchTodo(open, words);
      if (hit) { await env.DB.prepare(`UPDATE waiting_on SET state = 'done', updated_at = ? WHERE id = ?`).bind(input.now, hit.id).run(); said.push(`Done and off your list: ${hit.what}.`); }
    }
    return { reply: said.join("\n"), outcome: "COMMAND_REPLY", commandIds: [], taskId: null };
  }
  if (input.refs.some((r) => !r.startsWith("cmd_"))) return null;
  const found = commandsIn({ subject: input.subject, text: input.text, now: input.now, sender: input.sender });
  if (found.length === 0) return null;

  const ids = found.map(() => newId("cmd"));
  const now = input.now;
  for (const [i, c] of found.entries()) {
    if (c.kind === "errand") { c.spec.owner_email = input.sender; if (input.ownerName) c.spec.owner_name = input.ownerName; }
    await env.DB.prepare(`INSERT INTO boss_commands (id, mail_id, kind, state, spec, waits_on, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .bind(ids[i], input.mailId, c.kind, "new", JSON.stringify(c.spec), c.waits_on.map((r: number) => ids[r]).join(",") || null, now, now).run();
  }
  const lines: string[] = [];
  let taskId: string | null = null;
  for (const [i, c] of found.entries()) {
    const row = (await getCommand(env, ids[i]!))!;
    const spec = c.spec as Json;
    if (c.kind === "lookup") {
      await save(env, row.id, { state: "queued" }, now);
      lines.push(`Finding ${spec.name}'s email in your ${spec.drive ? "Drive files' sharing lists and your " : ""}Gmail${spec.hints?.length ? ` (starting with "${spec.hints[0]}")` : ""}. I'll show you what I find and how I know, and I never use a guessed address.`);
    } else if (c.kind === "invite") {
      lines.push(await runInvite(env, row, now));
    } else if (c.kind === "repo") {
      const d = await danielle(env, { title: `${spec.product}: ${spec.instruction}`, body: `${spec.github_repo} (${spec.product}): ${spec.instruction}`, mailId: input.mailId, sender: input.sender });
      await save(env, row.id, { state: d.taskId ? "handed" : "failed", task_id: d.taskId, change_id: d.changeId, result: d.why ? { why: d.why } : {} }, now);
      taskId ??= d.taskId;
      lines.push(d.taskId ? `Danielle has the ${spec.product} change (${spec.instruction}). Her plan comes to you by email, and I'll tell you when it's live.` : `Danielle's job for the ${spec.product} change could not be opened (${d.why}). It's logged and I'm on it.`);
    } else if (c.kind === "access_code") {
      lines.push(await queueCode(env, row, spec, now));
    } else if (c.kind === "email") {
      const ready = Boolean(spec.to);
      await save(env, row.id, { state: ready ? "drafting" : "waiting" }, now);
      lines.push(`The email to ${spec.recipient_name ?? spec.to ?? "them"}: I'll draft it in your voice ${ready ? "now" : "once I have the address"} and show it to you word for word with Send / Change / Try again. Nothing goes until you tap Send.`);
    } else if (c.kind === "errand") {
      // Her email is the approval (owner, 26 Oct 2026): it goes on the Mac's next tick, no Send tap.
      await save(env, row.id, { state: "queued" }, now);
      await audit(env.DB, { actor: "owner", lane: "ops", entityType: "boss_command", entityId: row.id, action: "errand_approved_by_her_email", detail: { to: spec.to, mail_id: input.mailId } });
      lines.push(`I'm sending your request to ${spec.to} now, as your assistant, from my own address. I'll watch for their answer and tell you what they said. Reply "cancel" in the next few minutes to stop it.`);
    } else if (c.kind === "cant_yet") {
      lines.push(await cantYetLine(env, row, spec.what, now));
      await save(env, row.id, { state: "handed" }, now);
    }
  }
  await audit(env.DB, { actor: "boss", lane: "ops", entityType: "inbound_mail", entityId: input.mailId, action: "commands", detail: { commands: found.map((c, i) => ({ id: ids[i], kind: c.kind })) } });
  const refs = ids.map((id) => `[${id}]`).join(" ");
  const reply = lines.length === 1 ? `${lines[0]} ${refs}` : `On it. Here's each part:\n${lines.map((l) => `- ${l}`).join("\n")}\n${refs}`;
  const jobs = found.map((c) => ({
    title: commandTitle(c.kind, c.spec as Json),
    employeeId: c.kind === "repo" ? "emp_repo" : "emp_chief", employee: c.kind === "repo" ? "Danielle" : "Simone",
    taskId: null, duty: false as const, failure: null,
  }));
  return { reply, outcome: "COMMAND", commandIds: ids, taskId, jobs };
}

/** Her reply on a command's thread. The newest open command it can apply to takes it. */
async function answerCommands(env: Env, rows: CommandRow[], text: string, now: number): Promise<string | null> {
  const verb = commandReplyIn(text, now);
  if (!verb) return null;
  const said = { ...verb, raw: ownWords(text) };
  const order = [...rows].sort((a, b) => b.updated_at - a.updated_at);
  for (const row of order) {
    const line = await answerOne(env, row, said, now);
    if (line) return `${line} [${row.id}]`;
  }
  const open = order.find((r) => !["sent", "created", "cancelled", "found", "handed", "add_link"].includes(r.state)) ?? order[0]!;
  return `Got it. On this one I'm waiting for: ${waitingFor(open)}. [${open.id}]`;
}

function waitingFor(row: CommandRow): string {
  const s = row.state;
  if (s === "shown") return 'your Send (or "change: …" / "try again")';
  if (s === "picking") return "which address is right (reply with its number)";
  if (s === "clash") return '"book it anyway", or a new day and time';
  if (s === "needs_time") return "the day and time";
  if (s === "needs_address" || s === "bounced" || s === "none") return "the right email address";
  if (s === "queued" || s === "drafting") return "my own work, which comes to you as soon as it's done";
  return "nothing from you";
}

async function answerOne(env: Env, row: CommandRow, said: Json, now: number): Promise<string | null> {
  const spec = j(row.spec); const result = j(row.result);
  if (row.kind === "meeting_prep") return answerMeetingPrep(env, row, said, now);
  if (row.kind === "errand") return answerErrand(env, row, said, String(said.raw ?? ""), now);
  if (row.kind === "email") {
    if (said.verb === "send") return approveAndSend(env, row, now);
    if (said.verb === "retry") return redraft(env, row, null, now);
    if (said.verb === "change" || (said.verb === "note" && row.state === "shown")) return redraft(env, row, said.note, now);
    if (said.verb === "cancel" && !["sent"].includes(row.state)) { await save(env, row.id, { state: "cancelled" }, now); return "Cancelled. Nothing was sent."; }
    if (said.verb === "address" && ["waiting", "bounced"].includes(row.state)) {
      if (row.state === "bounced") {
        await save(env, row.id, { state: "approved", spec: { ...spec, to: said.email } }, now);
        return (await sendApprovedEmail(env, row.id, now)).line;
      }
      await save(env, row.id, { state: "drafting", spec: { ...spec, to: said.email } }, now);
      return `Drafting it to ${said.email}. You'll see it word for word before anything goes.`;
    }
    return null;
  }
  if (row.kind === "access_code" && row.state === "needs_info") {
    const days = /\b(\d{1,3})\b/.exec(String(said.note ?? said.n ?? ""))?.[1] ?? (said.verb === "pick" ? String(said.n) : null);
    const n = Number(days);
    if (n >= 1 && n <= ACCESS_CODE_SHAPE.max_days) {
      await save(env, row.id, { spec: { ...spec, trial_days: n, error: null } }, now);
      return queueCode(env, (await getCommand(env, row.id))!, { ...spec, trial_days: n, error: null }, now);
    }
    return null;
  }
  if (row.kind === "lookup") {
    if (said.verb === "pick" && row.state === "picking") {
      const c = (result.candidates ?? [])[said.n - 1];
      if (!c) return `There's no number ${said.n}; reply with 1 to ${(result.candidates ?? []).length}.`;
      const lines = await addressFound(env, row, c.email, c.evidence ?? [], now);
      return [`Using ${c.email} for ${spec.name}.`, ...lines].join(" ");
    }
    if (said.verb === "address" && ["picking", "none", "queued", "found"].includes(row.state)) {
      const lines = await addressFound(env, row, said.email, ["you gave it to me"], now);
      return [`Using ${said.email} for ${spec.name}.`, ...lines].join(" ");
    }
    return null;
  }
  if (row.kind === "invite") {
    if (said.verb === "cancel") {
      if (row.state === "created" && result.event_id) {
        const d = await deleteInvite(env, { mailbox: result.mailbox, eventId: result.event_id });
        if (!d.ok) return `I couldn't remove it: ${d.why}.`;
      }
      await save(env, row.id, { state: "cancelled" }, now);
      return `Cancelled the invite to ${who(spec) ?? spec.guest_name}. It's off your calendar.`;
    }
    if (said.verb === "anyway" && row.state === "clash") {
      await save(env, row.id, { spec: { ...spec, anyway: true } }, now);
      return runInvite(env, (await getCommand(env, row.id))!, now);
    }
    if (said.verb === "time" && ["clash", "needs_time"].includes(row.state)) {
      await save(env, row.id, { spec: { ...spec, start: said.when.start, tz: said.when.tz, minutes: said.when.minutes === 30 ? spec.minutes ?? 30 : said.when.minutes, when_error: null } }, now);
      return runInvite(env, (await getCommand(env, row.id))!, now);
    }
    if (said.verb === "address") {
      if (row.state === "bounced" && result.event_id) {
        const r = await replaceGuest(env, { mailbox: result.mailbox, eventId: result.event_id, from: result.bounced ?? spec.guest_email, to: said.email });
        if (!r.ok) return `I couldn't update the invite: ${r.why}.`;
        await save(env, row.id, { state: "created", spec: { ...spec, guest_email: said.email }, result: { ...result, guest: said.email, sent_at: now, bounced: null } }, now);
        return `Updated the same invite: ${said.email} is on it now and has been sent it, ${slotText(spec.start, spec.minutes ?? 30, OWNER_TZ)} Central${spec.tz && spec.tz !== OWNER_TZ ? ` (${slotText(spec.start, spec.minutes ?? 30, spec.tz)} ${zoneLabel(spec.tz)} for them)` : ""}${result.meet ? `. Meet: ${result.meet}` : ""}.`;
      }
      if (["needs_address", "waiting"].includes(row.state)) {
        await save(env, row.id, { spec: { ...spec, guest_email: said.email } }, now);
        return runInvite(env, (await getCommand(env, row.id))!, now);
      }
    }
    return null;
  }
  return null;
}

/** Cancel one command from her session (the screen, or the live proof cleaning up after itself). */
export async function cancelCommand(env: Env, id: string, now = Date.now()): Promise<string> {
  const row = await getCommand(env, id);
  if (!row) return "No such command.";
  return (await answerOne(env, row, { verb: "cancel" }, now)) ?? "Nothing to cancel on this one.";
}

// ─── The Mac's tick ────────────────────────────────────────────────────────

/** What the Mac has to do now, and any held email whose repo job has landed is sent first. */
export async function macWork(env: Env, now = Date.now()) {
  const held = await env.DB.prepare(`SELECT id FROM boss_commands WHERE kind = 'email' AND state = 'held'`).all<{ id: string }>();
  for (const h of held.results ?? []) {
    const row = (await getCommand(env, h.id))!;
    if (!(await repoReady(env, row)).ready) continue;
    await save(env, h.id, { state: "approved" }, now);
    const r = await sendApprovedEmail(env, h.id, now);
    await owe(env, h.id, { subject: "Your email went", happened: r.line });
  }
  const rows = async (sql: string, ...b: unknown[]) => ((await env.DB.prepare(sql).bind(...b).all<CommandRow>()).results ?? []);
  const lookups = await rows(`SELECT * FROM boss_commands WHERE kind = 'lookup' AND state = 'queued' ORDER BY created_at LIMIT 5`);
  const drafts = await rows(`SELECT * FROM boss_commands WHERE kind = 'email' AND state = 'drafting' ORDER BY created_at LIMIT 5`);
  const watch = await rows(`SELECT * FROM boss_commands WHERE state IN ('created','sent') AND kind IN ('invite','email') AND updated_at > ? LIMIT 50`, now - 3 * 86_400_000);
  const notices = await rows(`SELECT * FROM boss_commands WHERE notice_state = 'due' ORDER BY updated_at LIMIT 20`);
  const codes = await rows(`SELECT * FROM boss_commands WHERE kind = 'access_code' AND state = 'queued' ORDER BY created_at LIMIT 10`);
  const errands = await rows(`SELECT * FROM boss_commands WHERE kind = 'errand' AND state = 'queued' ORDER BY created_at LIMIT 10`);
  // Her answer or her cancellation, to go to the business in THEIR thread (In-Reply-To their message).
  const followUps = await rows(`SELECT * FROM boss_commands WHERE kind = 'errand' AND state = 'follow_up' ORDER BY updated_at LIMIT 10`);
  return {
    lookups: lookups.map((r) => ({ id: r.id, spec: j(r.spec) })),
    drafts: drafts.map((r) => ({ id: r.id, spec: j(r.spec), change_note: j(r.result).change_note ?? null, previous: j(r.result).previous ?? null })),
    bounce_checks: watch.map((r) => ({ id: r.id, mailbox: r.kind === "invite" ? j(r.result).mailbox : j(r.spec).from_mailbox, address: r.kind === "invite" ? j(r.result).guest : j(r.spec).to, since: j(r.result).sent_at ?? r.updated_at })),
    notices: notices.map((r) => ({ id: r.id, notice: j(r.notice) })),
    codes: codes.map((r) => ({ id: r.id, spec: j(r.spec) })),
    errands: errands.map((r) => ({ id: r.id, spec: j(r.spec), asked_at: r.created_at })),
    preps: await prepsDue(env),
    errand_follow_ups: followUps.filter((r) => j(r.result).pending?.text).map((r) => {
      const res = j(r.result);
      return { id: r.id, to: j(r.spec).to, subject: res.pending.subject, text: res.pending.text, purpose: res.pending.purpose, in_reply_to: res.thread?.message_id ?? null };
    }),
  };
}

export async function noticeSent(env: Env, id: string): Promise<void> {
  await env.DB.prepare(`UPDATE boss_commands SET notice_state = 'sent' WHERE id = ?`).bind(id).run();
}
export async function commandFailed(env: Env, id: string, why: string, now = Date.now()): Promise<void> {
  const row = await getCommand(env, id);
  if (!row) return;
  const cs = j(row.spec);
  if (row.kind === "access_code" && cs.op !== "count") {
    // No key on the Mac (or Supabase refused): the code still gets made, by Danielle, as a migration
    // on main (seq23/dailystory applies migration files on merge). Never a dead end.
    const sql = cs.op === "create"
      ? `insert into public.${ACCESS_CODE_SHAPE.table} (code, trial_days, label) values ('${cs.code}', ${Number(cs.trial_days)}, ${cs.label ? `'${String(cs.label).replace(/'/g, "''")}'` : "null"}) on conflict (code) do nothing;`
      : `update public.${ACCESS_CODE_SHAPE.table} set active = false where code = '${cs.code}';`;
    const d = await danielle(env, { title: `time-2-read: ${cs.op === "create" ? "add" : "turn off"} code ${cs.code}`, body: `seq23/dailystory (time-2-read): add one migration file under supabase/migrations with exactly: ${sql} Simone could not do it directly (${why}).`, mailId: row.mail_id ?? "", sender: "simone" });
    await save(env, id, { state: "handed", task_id: d.taskId, change_id: d.changeId, result: { ...j(row.result), why } }, now);
    await owe(env, id, { subject: `time-2-read code ${cs.code}`, happened: `I couldn't reach time-2-read's code table myself (${why}), so Danielle is ${cs.op === "create" ? "adding" : "turning off"} ${cs.code} as a one-line change instead. I'll tell you when it's live.` });
    return;
  }
  const what = row.kind === "lookup" ? `look up ${j(row.spec).name}'s email (${why})` : row.kind === "email" ? `draft that email (${why})` : `finish this (${why})`;
  const line = await cantYetLine(env, row, what, now);
  await save(env, id, { state: "failed", result: { ...j(row.result), why } }, now);
  await owe(env, id, { subject: "Simone hit a wall", happened: line });
}

// ─── Errands: sent on her word, watched for the answer ─────────────────────

/** How long a sent errand is watched for the business's answer. */
export const ERRAND_WATCH_MS = 21 * 86_400_000;
/** Free-mail domains: an errand to one of these is answered only from that exact address. */
const FREE_MAIL_RE = /@(?:gmail|googlemail|yahoo|outlook|hotmail|icloud|me|mac|aol|proton|protonmail|live|msn|gmx)\.[a-z.]+$/i;

/** Every state in which an errand still has a live thread with the business. */
const ERRAND_LIVE = ["sent", "replied", "follow_up", "booked", "needs_card", "cancel_sent"];

/**
 * The sent errand a stranger's email answers: from the address Simone wrote to, or — for a business
 * domain — anyone at that domain (the club's host answers for reservations@). Null when it answers none.
 */
export async function openErrandFor(env: Env, sender: string, now = Date.now(), message: { subject?: string; text?: string } = {}): Promise<CommandRow | null> {
  const from = String(sender ?? "").trim().toLowerCase();
  if (!from.includes("@")) return null;
  const { results } = await env.DB.prepare(
    `SELECT c.*, m.from_addr AS owner_email FROM boss_commands c LEFT JOIN boss_inbound_mail m ON m.id = c.mail_id WHERE c.kind = 'errand' AND c.state IN (${ERRAND_LIVE.map(() => "?").join(",")}) AND c.updated_at > ? ORDER BY c.updated_at DESC LIMIT 50`,
  ).bind(...ERRAND_LIVE, now - ERRAND_WATCH_MS).all<CommandRow & { owner_email: string | null }>();
  const matches: CommandRow[] = [];
  const venues: CommandRow[] = []; const owners: CommandRow[] = [];
  for (const r of results ?? []) {
    const to = String(j(r.spec).to ?? "").toLowerCase();
    if (!to) continue;
    if (to === from || (!FREE_MAIL_RE.test(to) && from.endsWith(`@${to.split("@")[1]}`))) matches.push(r);
    else if (isBookingPlatform(from)) {
      const spec = j(r.spec); const result = j(r.result);
      const venue = String(result.request ?? spec.ask ?? "").match(/\bat\s+(.+?)\s+on\b/i)?.[1];
      const domainName = to.split("@")[1]?.split(".")[0];
      const ownerName = String(result.text ?? "").match(/assistant to\s+([^\r\n]+)/i)?.[1];
      const venueNames = [venue, domainName, spec.venue];
      const ownerNames = [spec.owner_name, spec.owner_email, ownerName, r.owner_email, String(spec.owner_name ?? ownerName ?? "").trim().split(/\s+/)[0]];
      const content = `${message.subject ?? ""}\n${message.text ?? ""}`.toLowerCase();
      const normal = (v: string) => v.toLowerCase().replace(/[^a-z0-9@]+/g, " ").trim();
      const names = (values: unknown[]) => values.some((v) => v && String(v).length >= 4 && ` ${normal(content)} `.includes(` ${normal(String(v))} `));
      if (names(venueNames)) venues.push(r);
      else if (names(ownerNames)) owners.push(r);
    }
  }
  // A named venue resolves two live errands for the same owner; her name alone never guesses.
  const best = matches.length ? matches : venues.length ? venues : owners;
  return best.length === 1 ? best[0]! : null;
}

export function isBookingPlatform(sender: string): boolean {
  return /@(?:[a-z0-9-]+\.)*(?:sevenrooms\.com|opentable\.com|resy\.com|exploretock\.com|tock\.com|tock\.to)$/i.test(sender);
}

/** The Mac sent it: the provider's id and the exact words go on the row, and the watch starts. */
export async function errandSent(env: Env, id: string, out: { message_id: string; subject: string; text: string; request?: string | null }, now = Date.now()): Promise<boolean> {
  const row = await getCommand(env, id);
  if (!row || row.kind !== "errand" || row.state !== "queued") return false;
  await save(env, id, { state: "sent", result: { ...j(row.result), message_id: out.message_id, subject: out.subject, text: out.text, request: out.request ?? null, sent_at: now } }, now);
  await audit(env.DB, { actor: "owner", lane: "ops", entityType: "boss_command", entityId: id, action: "errand_sent_on_her_word", detail: { to: j(row.spec).to, message_id: out.message_id } });
  return true;
}

/** The words that say what and when the booking is: "Thursday, October 29" from her request or subject. */
function errandWords(spec: Json, result: Json): string {
  return `${result.subject ?? ""}\n${result.request ?? ""}\n${spec.ask ?? ""}`;
}
async function ensureTap(env: Env, row: CommandRow, now: number): Promise<string> {
  if (row.tap_token) return row.tap_token;
  const token = tapToken();
  await save(env, row.id, { tap_token: token }, now);
  return token;
}

/**
 * THEIR ANSWER, TOLD TO HER PLAINLY: What I asked for / What they said (all of it) / What you need
 * to do. "Booked" only for a real confirmation of one time with nothing asked (readErrandReply);
 * a choice, a question or a fee is a Decide item she answers by replying, and a card or deposit is
 * hers, never an agent's. Nothing goes back to them from here: her reply is what sends a follow-up.
 */
export async function errandReplied(env: Env, row: CommandRow, reply: { from: string; subject: string; text: string; dmarc: boolean; messageId?: string | null; mailId?: string }, now = Date.now()): Promise<void> {
  if (row.state === "done") return;
  const spec = j(row.spec); const result = j(row.result);
  const read = readErrandReply(reply.text || reply.subject, spec.to, reply.subject);
  const offer = read.offer;
  const replies = [...(result.replies ?? []), { at: now, from: reply.from, subject: reply.subject.slice(0, 300), text: reply.text, mail_id: reply.mailId ?? null, kind: read.kind, dmarc: reply.dmarc, message_id: reply.messageId ?? null }];
  const thread = { message_id: reply.messageId ?? result.thread?.message_id ?? null, subject: /^re:/i.test(reply.subject) ? reply.subject.slice(0, 200) : `Re: ${String(result.subject ?? reply.subject).slice(0, 196)}`, greet: offer.greet ?? result.thread?.greet ?? null };
  const asked = String(result.request ?? spec.ask ?? "").slice(0, 300);
  const unproven = reply.dmarc ? [] : ["Their email could not be fully proven to come from them, so check it before acting on it."];

  // Their answer to Simone's cancellation.
  if (row.state === "cancel_sent") {
    const done = /\bcancel(?:l?ed|lation)\b/i.test(offer.text) && !/\?/.test(offer.text);
    await save(env, row.id, { state: done ? "cancelled" : "cancel_sent", result: { ...result, replies, thread } }, now);
    await owe(env, row.id, {
      subject: done ? "Cancelled: they confirmed it" : "They answered about the cancellation",
      happened: done ? `${spec.to} confirmed the cancellation.` : `${spec.to} answered Simone's cancellation.`,
      details: [`What they said: ${read.what_they_said}`, ...(done ? [] : [`What you need to do: ${read.what_you_do}`]), ...unproven],
    });
    await audit(env.DB, { actor: "system", lane: "ops", entityType: "boss_command", entityId: row.id, action: "errand_cancel_answered", detail: { done, from: reply.from } });
    return;
  }

  // A confirmation of one time: the booking is real, and its reminder is set 28 hours before.
  const date = errandDateIn(errandWords(spec, result), result.sent_at ?? row.created_at, ERRAND_TZ);
  const one = offer.options.length === 1 ? offer.options[0] : null;
  const pending = result.booking && !result.booking.confirmed ? result.booking : null;
  const confirmsPending = read.kind !== "card" && pending && offer.confirms && !offer.asks && (!one || one.time === pending.time);
  let booking = result.booking ?? null;
  if (read.kind === "confirmed" && one && date) booking = { ...(bookingAt(date, one, ERRAND_TZ) ?? {}), label: one.label, confirmed: true };
  else if (confirmsPending) booking = { ...pending, confirmed: true };
  else if (read.kind !== "card" && offer.confirms && one && date && !offer.asks) booking = { ...(bookingAt(date, one, ERRAND_TZ) ?? {}), label: one.label, confirmed: true };
  if (read.kind === "card" && booking) booking = { ...booking, confirmed: false };
  const confirmed = read.kind !== "card" && Boolean(booking?.confirmed) && (read.kind === "confirmed" || confirmsPending || (offer.confirms && !offer.asks));
  const kind = confirmsPending && read.kind !== "card" && !offer.asks ? "confirmed" : read.kind;
  const rules = { rules: offer.rules.length ? offer.rules : (result.rules ?? []), cancel_rule: offer.cancel_rule.length ? offer.cancel_rule : (result.cancel_rule ?? []) };
  const decideOpen = kind === "decide" && !confirmed;
  await save(env, row.id, {
    state: read.kind === "card" ? "needs_card" : confirmed ? "booked" : "replied",
    result: { ...result, replies, thread, ...rules, booking: confirmed ? booking : (booking ?? null), decide_open: decideOpen, offer: { options: offer.options, needs: offer.needs, rules: offer.rules, cancel_rule: offer.cancel_rule, greet: offer.greet } },
  }, now);
  const fresh = (await getCommand(env, row.id))!;
  const token = kind === "decide" || confirmed ? await ensureTap(env, fresh, now) : null;
  const notice = errandReplyNotice({
    to: spec.to, asked, read, kind, confirmed, booking, decideOpen, unproven,
    commandId: row.id, commandUrl: `${ORIGIN}/?command=${encodeURIComponent(row.id)}`,
    originalUrl: reply.mailId ? `${ORIGIN}/?mail=${encodeURIComponent(reply.mailId)}` : `${ORIGIN}/?command=${encodeURIComponent(row.id)}`,
    answerUrl: decideOpen && token ? tapUrl(token, "answer") : null,
    cancelUrl: decideOpen && token ? tapUrl(token, "cancel") : null,
  });
  await owe(env, row.id, notice);
  await audit(env.DB, { actor: "system", lane: "ops", entityType: "boss_command", entityId: row.id, action: "errand_answered", detail: { kind, confirmed, from: reply.from, dmarc: reply.dmarc } });
}

/**
 * HER ANSWER, SENT ON (owner, 26 Oct 2026). Her reply on an errand's thread is the approval for what
 * it says: a time and a phone number go to the business in the SAME thread; "cancel" cancels with
 * them in the same thread; "yes, keep it" changes nothing. A card number or card words never go: she
 * is told to give those herself. The Mac sends it on its next tick (`errand_follow_ups`).
 */
async function answerErrand(env: Env, row: CommandRow, said: Json, raw: string, now: number): Promise<string | null> {
  const spec = j(row.spec); const result = j(row.result);
  const offer = result.offer ?? { options: [], needs: [] };
  const a = errandAnswerIn(raw, offer);
  if (said.verb === "handle_self") return handleErrandSelf(env, row.id, now);
  if (row.state === "done") return "Owner is handling this herself. Simone has stood down.";
  const cancel = said.verb === "cancel" || a.cancel;
  if (cancel && row.state === "queued") { await save(env, row.id, { state: "cancelled" }, now); return "Cancelled. Nothing was sent."; }
  if (cancel && ["cancel_sent", "cancelled"].includes(row.state)) return `Already cancelled with ${spec.to}.`;
  if (cancel) {
    const b = result.booking ?? null;
    const what = b ? `the ${b.time}${b.label ? ` ${b.label}` : ""}` : null;
    const when = b?.at ? new Intl.DateTimeFormat("en-US", { timeZone: b.tz ?? ERRAND_TZ, weekday: "long", month: "long", day: "numeric" }).format(new Date(b.at)) : null;
    const text = errandCancelText({ greet: result.thread?.greet ?? null, what, when, party: partyIn(errandWords(spec, result)) });
    await save(env, row.id, { state: "follow_up", result: { ...result, decide_open: false, pending: { purpose: "cancel", text, subject: result.thread?.subject ?? `Re: ${result.subject ?? "Reservation request"}`, at: now } } }, now);
    await audit(env.DB, { actor: "owner", lane: "ops", entityType: "boss_command", entityId: row.id, action: "errand_cancel_on_her_word", detail: { to: spec.to } });
    return `Cancelling it: I'm writing to ${spec.to} now, in the same thread, to cancel${what ? ` ${what}` : ""}${when ? ` on ${when}` : ""}. I'll tell you when they confirm.`;
  }
  if (a.keep && ["booked", "sent", "follow_up"].includes(row.state)) return "Kept. Nothing changes.";
  if (!result.decide_open) return null;
  if (a.card) return `I never send card details. If you want to give them a card, write to ${spec.to} yourself; nothing was sent.`;
  if (a.missing.length) return `To send it I still need ${a.missing.join(" and ")}. Nothing was sent yet.`;
  const date = errandDateIn(errandWords(spec, result), result.sent_at ?? row.created_at, ERRAND_TZ);
  const booking = a.choice && date ? { ...(bookingAt(date, a.choice, ERRAND_TZ) ?? {}), label: a.choice.label, confirmed: false } : result.booking ?? null;
  const day = booking?.at ? new Intl.DateTimeFormat("en-US", { timeZone: ERRAND_TZ, weekday: "long", month: "long", day: "numeric" }).format(new Date(booking.at)) : null;
  const text = errandFollowUpText({ greet: result.thread?.greet ?? offer.greet ?? null, choice: a.choice, when: day, party: partyIn(errandWords(spec, result)), phone: a.phone, offer });
  const problems = followUpProblems(text);
  if (problems.length) return `I didn't send it: ${problems.join("; ")}.`;
  await save(env, row.id, { state: "follow_up", result: { ...result, decide_open: false, booking, pending: { purpose: "answer", text, subject: result.thread?.subject ?? `Re: ${result.subject ?? "Reservation request"}`, at: now } } }, now);
  await audit(env.DB, { actor: "owner", lane: "ops", entityType: "boss_command", entityId: row.id, action: "errand_answer_on_her_word", detail: { to: spec.to, choice: a.choice?.time ?? null } });
  return `Sending this to ${spec.to} now, in the same thread, and I'll tell you when they confirm:\n\n${text}`;
}

/** The Mac sent a follow-up in their thread: the watch goes on (or the cancellation is awaited). */
export async function errandFollowedUp(env: Env, id: string, out: { message_id: string }, now = Date.now()): Promise<boolean> {
  const row = await getCommand(env, id);
  if (!row || row.kind !== "errand" || row.state !== "follow_up") return false;
  const result = j(row.result); const spec = j(row.spec);
  const p = result.pending ?? {};
  const follow_ups = [...(result.follow_ups ?? []), { message_id: out.message_id, sent_at: now, purpose: p.purpose, text: p.text ?? null, subject: p.subject ?? null, in_reply_to: result.thread?.message_id ?? null }];
  await save(env, id, { state: p.purpose === "cancel" ? "cancel_sent" : "sent", result: { ...result, follow_ups, pending: null, status: p.purpose === "cancel" ? "waiting for them to confirm the cancellation" : "waiting for their confirmation" } }, now);
  await audit(env.DB, { actor: "owner", lane: "ops", entityType: "boss_command", entityId: id, action: p.purpose === "cancel" ? "errand_cancel_sent" : "errand_follow_up_sent", detail: { to: spec.to, message_id: out.message_id } });
  if (p.purpose === "cancel") await owe(env, id, { subject: "Cancelling your booking", happened: `I asked ${spec.to} to cancel, in the same thread. I'll tell you when they confirm.`, details: [`What I sent: ${String(p.text ?? "").replace(/\s+/g, " ").trim()}`] });
  return true;
}

/**
 * "DO YOU STILL WANT TO GO?" (owner, 26 Oct 2026: "Simone needs to send a reminder 28 hrs before to
 * ask if i still want to go"). Every errand with a booking time gets one email 28 hours before it
 * (REMINDER_LEAD_MS, the true instant, so a clock-change weekend lands right): what, where, when, their
 * rules and cancellation terms, and two taps, "Yes, keep it" / "Cancel it". A booking they have not
 * confirmed yet still gets it, and says so.
 */
export async function errandRemindersDue(env: Env, now = Date.now()): Promise<Array<{ id: string; notice: Notice }>> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM boss_commands WHERE kind = 'errand' AND state IN ('sent','replied','follow_up','booked','needs_card') ORDER BY updated_at DESC LIMIT 200`,
  ).all<CommandRow>();
  const due: Array<{ id: string; notice: Notice }> = [];
  for (const row of results ?? []) {
    const result = j(row.result);
    const b = result.booking;
    if (!b?.at || result.reminder_sent_at || now < reminderDueAt(b.at) || now >= b.at) continue;
    const token = await ensureTap(env, row, now);
    due.push({ id: row.id, notice: reminderNotice(j(row.spec), result, token) });
  }
  return due;
}
export function reminderNotice(spec: Json, result: Json, token: string): Notice {
  const b = result.booking;
  const when = bookingWhen(b.at, b.tz ?? ERRAND_TZ);
  const what = `${b.label ? `The ${b.time} ${b.label}` : `Your booking at ${b.time}`}${partyIn(errandWords(spec, result)) ? `, party of ${partyIn(errandWords(spec, result))}` : ""}`;
  const rules: string[] = result.rules ?? [];
  const cancel: string[] = result.cancel_rule ?? [];
  return {
    subject: `Do you still want to go? ${when}`,
    happened: `Your booking is in 28 hours. ${b.confirmed && result.replies?.at(-1)?.kind !== "card" && !result.offer?.needs?.some((n: string) => /card/.test(n)) ? "They have confirmed it." : "They have NOT confirmed it yet: I asked them to, and I'm watching for their answer."}`,
    details: [
      `What: ${what}`,
      `Where: ${String(result.request ?? "").match(/\bat\s+([A-Z][^,]+?)\s+on\b/)?.[1] ?? "the place you asked for"} (${spec.to})`,
      `When: ${when} (New York time)`,
      ...(rules.length ? [`Their rules: ${rules.join(" ")}`] : []),
      ...(cancel.length ? [`Cancelling: ${cancel.join(" ")}`] : []),
      `Do you still want to go? Tap one, or reply "yes" or "cancel". If you cancel, Simone tells them in the same thread.`,
    ],
    decide: [{
      title: "Do you still want to go?",
      body: `${what}, ${when}.`,
      buttons: [{ label: "Yes, keep it", url: tapUrl(token, "keep") }, { label: "Cancel it", url: tapUrl(token, "cancel") }],
    }],
  };
}
export async function errandReminded(env: Env, id: string, now = Date.now()): Promise<boolean> {
  const row = await getCommand(env, id);
  if (!row || row.kind !== "errand") return false;
  await save(env, id, { result: { ...j(row.result), reminder_sent_at: now } }, now);
  await audit(env.DB, { actor: "system", lane: "ops", entityType: "boss_command", entityId: id, action: "errand_reminder_sent", detail: {} });
  return true;
}
/** Stand down without contacting the venue, including any queued notices and follow-ups. */
export async function handleErrandSelf(env: Env, id: string, now = Date.now()): Promise<string> {
  const row = await getCommand(env, id);
  if (!row || row.kind !== "errand") return "No such errand.";
  await save(env, id, { state: "done", result: { ...j(row.result), pending: null, decide_open: false, owner_handling: true, status: "Owner is handling this herself" } }, now);
  await env.DB.prepare(`UPDATE boss_commands SET notice = NULL, notice_state = 'sent' WHERE id = ?`).bind(id).run();
  await audit(env.DB, { actor: "owner", lane: "ops", entityType: "boss_command", entityId: id, action: "errand_owner_handling" });
  return "Owner is handling this herself. Simone has stood down; no email or reminder will be sent.";
}

/** Her tap or her reply on an errand, from the tap page: keep, cancel, or her answer in words. */
export async function errandTap(env: Env, row: CommandRow, action: "keep" | "cancel" | "answer" | "handle_self", words = "", now = Date.now()): Promise<string> {
  if (action === "handle_self") return handleErrandSelf(env, row.id, now);
  if (row.state === "done") return "Owner is handling this herself. Simone has stood down.";
  if (action === "keep") return "Kept. Nothing changes.";
  if (action === "cancel") return (await answerErrand(env, row, { verb: "cancel" }, "cancel", now)) ?? "Nothing to cancel on this one.";
  return (await answerErrand(env, row, { verb: "note" }, words, now)) ?? "Got it, but there was nothing open to answer.";
}

// ─── Simone's meeting prep: the question, her answer, the finished prep in the same thread ─────

/*
 * A PREP THAT CANNOT FIND WHAT THE MEETING IS FOR ASKS (owner, 26 Oct 2026: "she should ask what the
 * meeting is about and offer to help me"). The Mac opens one row per prep (keyed on the event and
 * its day) and sends the prep with the row's code, so her reply in that thread lands here through
 * the ordinary intake (`commandFromMail` → `answerCommands`); no second path. Her words become the
 * meeting's purpose, the row goes to `queued`, and the Mac's next tick (scripts/ops/simone-commands.mjs
 * → meeting-prep.mjs `finishPrep`) writes the finished prep and sends it IN THE SAME THREAD.
 */
export async function openMeetingPrep(env: Env, input: { key: string; spec: Json; asked: boolean }, now = Date.now()): Promise<string> {
  const state = input.asked ? "asked" : "sent";
  const spec = { ...input.spec, key: input.key };
  const hit = await env.DB.prepare(`SELECT id FROM boss_commands WHERE kind = 'meeting_prep' AND json_extract(spec, '$.key') = ? ORDER BY created_at DESC LIMIT 1`)
    .bind(input.key).first<{ id: string }>();
  if (hit) { await save(env, hit.id, { state, spec }, now); return hit.id; }
  const id = newId("cmd");
  await env.DB.prepare(`INSERT INTO boss_commands (id, mail_id, kind, state, spec, created_at, updated_at) VALUES (?, NULL, 'meeting_prep', ?, ?, ?, ?)`)
    .bind(id, state, JSON.stringify(spec), now, now).run();
  return id;
}

async function answerMeetingPrep(env: Env, row: CommandRow, said: Json, now: number): Promise<string | null> {
  const spec = j(row.spec); const result = j(row.result);
  if (said.verb === "cancel") {
    await save(env, row.id, { state: "cancelled" }, now);
    return "OK, I'll leave this meeting's prep as it is.";
  }
  const words = String(said.raw ?? said.note ?? "").trim();
  if (!words) return null;
  await save(env, row.id, { state: "queued", result: { ...result, purpose: words.slice(0, 2000), answered_at: now } }, now);
  await audit(env.DB, { actor: "owner", lane: "ops", entityType: "boss_command", entityId: row.id, action: "meeting_prep_purpose", detail: { key: spec.key ?? null } });
  return `Thanks. I'm writing your prep for ${spec.who ?? "the meeting"} with that now. It comes back to you in this thread before the meeting.`;
}

/** The preps her answer is waiting on, each with the thread to answer in (oldest message first). */
async function prepsDue(env: Env) {
  const rows = (await env.DB.prepare(`SELECT * FROM boss_commands WHERE kind = 'meeting_prep' AND state = 'queued' ORDER BY updated_at LIMIT 5`).all<CommandRow>()).results ?? [];
  const out = [];
  for (const r of rows) {
    const thread = ((await env.DB.prepare(`SELECT message_id FROM boss_mail_refs WHERE instr(' ' || refs || ' ', ?) > 0 ORDER BY created_at ASC LIMIT 20`)
      .bind(` ${r.id} `).all<{ message_id: string }>()).results ?? []).map((m) => m.message_id);
    out.push({ id: r.id, spec: j(r.spec), purpose: j(r.result).purpose ?? null, thread });
  }
  return out;
}

/** The finished prep went, in her thread. */
export async function prepFinished(env: Env, id: string, out: { message_id?: string | null }, now = Date.now()): Promise<boolean> {
  const row = await getCommand(env, id);
  if (!row || row.kind !== "meeting_prep") return false;
  await save(env, id, { state: "sent", result: { ...j(row.result), finished_at: now, finished_id: out.message_id ?? null } }, now);
  return true;
}

/** Boss OS cards (tasks) that mention them: titles and inputs, newest first. Never this prep's own rows. */
export async function prepMentions(env: Env, terms: string[]): Promise<Array<{ title: string; date: string }>> {
  const words = [...new Set(terms.map((t) => String(t ?? "").trim()).filter((t) => t.length >= 4))].slice(0, 4);
  if (!words.length) return [];
  const where = words.map(() => "(instr(lower(title), lower(?)) > 0 OR instr(lower(coalesce(input, '')), lower(?)) > 0)").join(" OR ");
  const rows = (await env.DB.prepare(`SELECT title, created_at FROM tasks WHERE (${where}) AND title NOT LIKE 'Meeting prep%' ORDER BY created_at DESC LIMIT 5`)
    .bind(...words.flatMap((w) => [w, w])).all<{ title: string; created_at: number }>()).results ?? [];
  return rows.map((r) => ({ title: r.title, date: new Date(r.created_at).toISOString().slice(0, 10) }));
}
