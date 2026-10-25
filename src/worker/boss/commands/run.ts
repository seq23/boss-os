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
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { admitTask } from "../tasks/admit";
import {
  commandsIn, commandReplyIn, confirmLine, renderUrl, slotText, zoneLabel, OWNER_TZ, DEFAULT_MAILBOX, codeLines, ACCESS_CODE_SHAPE,
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
export interface Notice { subject: string; happened: string; details?: string[]; decide?: Json[] }
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
  const out = await sendOne(env, { from: spec.from_mailbox, to: spec.to, subject: result.draft_subject, text: result.draft_text });
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
  await owe(env, id, {
    subject: `${what} bounced`,
    happened: `${what} bounced: ${address} doesn't take mail. What's the right address?`,
    details: [row.kind === "invite" ? "Reply with it and I'll put them on the same invite (no new event)." : "Reply with it and I'll send the same email there."],
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

export interface CommandMailResult { reply: string; outcome: "COMMAND" | "COMMAND_REPLY"; commandIds: string[]; taskId: string | null }

/**
 * The intake's door into this file. A reply on a command's thread answers that command; a new email
 * with commands in it creates them. Null means "not a command" and the ordinary triage takes it.
 */
export async function commandFromMail(env: Env, input: { subject: string; text: string; mailId: string; sender: string; refs: string[]; now: number; to?: string }): Promise<CommandMailResult | null> {
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
  if (input.refs.some((r) => !r.startsWith("cmd_"))) return null;
  const found = commandsIn({ subject: input.subject, text: input.text, now: input.now });
  if (found.length === 0) return null;

  const ids = found.map(() => newId("cmd"));
  const now = input.now;
  for (const [i, c] of found.entries()) {
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
    } else if (c.kind === "cant_yet") {
      lines.push(await cantYetLine(env, row, spec.what, now));
      await save(env, row.id, { state: "handed" }, now);
    }
  }
  await audit(env.DB, { actor: "boss", lane: "ops", entityType: "inbound_mail", entityId: input.mailId, action: "commands", detail: { commands: found.map((c, i) => ({ id: ids[i], kind: c.kind })) } });
  const refs = ids.map((id) => `[${id}]`).join(" ");
  const reply = lines.length === 1 ? `${lines[0]} ${refs}` : `On it. Here's each part:\n${lines.map((l) => `- ${l}`).join("\n")}\n${refs}`;
  return { reply, outcome: "COMMAND", commandIds: ids, taskId };
}

/** Her reply on a command's thread. The newest open command it can apply to takes it. */
async function answerCommands(env: Env, rows: CommandRow[], text: string, now: number): Promise<string | null> {
  const said = commandReplyIn(text, now);
  if (!said) return null;
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
  return {
    lookups: lookups.map((r) => ({ id: r.id, spec: j(r.spec) })),
    drafts: drafts.map((r) => ({ id: r.id, spec: j(r.spec), change_note: j(r.result).change_note ?? null, previous: j(r.result).previous ?? null })),
    bounce_checks: watch.map((r) => ({ id: r.id, mailbox: r.kind === "invite" ? j(r.result).mailbox : j(r.spec).from_mailbox, address: r.kind === "invite" ? j(r.result).guest : j(r.spec).to, since: j(r.result).sent_at ?? r.updated_at })),
    notices: notices.map((r) => ({ id: r.id, notice: j(r.notice) })),
    codes: codes.map((r) => ({ id: r.id, spec: j(r.spec) })),
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
