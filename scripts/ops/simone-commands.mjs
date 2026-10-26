#!/usr/bin/env node
/**
 * SIMONE'S HANDS ON HER MAC — the half of "Simone does it by email" a Worker cannot do.
 *
 * Owner, 25 Oct 2026: anything a Claude session could do with her tools, an email to Simone does.
 * The Worker (src/worker/boss/commands/run.ts) reads the email, makes invites on her Workspace
 * calendars and holds every draft for her Send. This tick does the rest, every ten minutes
 * (launchd com.seq.boss-simone-commands, scripts/ops/install-simone-commands.sh):
 *
 *   1. LOOKUPS through HER OWN Drive and Gmail (the Claude connectors on her seat are bound to her
 *      personal account; no delegation can read it). Drive file names first, then each file's
 *      sharing list, then Gmail. Every candidate comes back WITH its evidence; a run whose own event
 *      stream shows no successful Drive or Gmail call is refused as a guess (`requireTool`).
 *   2. DRAFTS in her voice, from her words and — for one of her products — facts read from that
 *      product's own repo on this Mac. The draft goes to the Worker, which shows it to her word for
 *      word with Send / Change / Try again. A DRAFT IS NEVER SENT TO A THIRD PARTY FROM HERE.
 *   2b. ERRANDS (owner, 26 Oct 2026), the one exception: a booking or request to a business whose
 *      address she wrote in her own email (`errandIn`). Her email is the approval, so the request
 *      goes now, as "Simone, Assistant to Sequoia Taylor", from simone@ with Reply-To simone@ and no
 *      copy to her (`postErrandMail` in notify.mjs). The words are one fixed letter around one phrase
 *      (`errandText`), checked by `errandProblems` before anything goes. Their answer comes back to
 *      the Worker, which tells her what they said; a card or deposit request is always hers.
 *   3. BOUNCE CHECKS in the mailbox an invite or email went from (gmail.readonly, delegated).
 *   4. NOTICES: the plain emails the Worker laid out for her (a lookup's answer, a draft to approve,
 *      a bounce), sent as Simone with the command's code so her reply lands on it.
 *
 * Exit 7 with NAMED STOP [NOTHING_WAITING] when there was nothing to do (Rule 0: never a silent 0).
 *   npm run -s vault:run -- node scripts/ops/simone-commands.mjs
 */
import { bossApi, askClaudeJson, googleToken, gmailHeaders, OWNER_TO } from "./lib/duty-kit.mjs";
import { sendersFor, employeeMail, postEmployeeMail, errandMail, postErrandMail } from "./notify.mjs";
import { addMorningLines } from "../../src/shared/boss/mail/morning.mjs";
import { PRODUCT_REPOS, ACCESS_CODE_SHAPE, errandText, errandProblems, followUpProblems, OWNER_TZ } from "../../src/shared/boss/commands/parse.mjs";

/*
 * TIME-2-READ'S CODE TABLE (seq23/dailystory, supabase/migrations/20261025120000_access_codes.sql).
 * A code is a row, so a new one needs no rebuild. The service-role key comes from the vault by NAME
 * through vault:run and is never printed. The name carries the vendor (reserved names are never used).
 */
const SUPABASE_URL = process.env.DAILYSTORY_SUPABASE_URL ?? "https://cpzeuogomaixamrtnnmj.supabase.co";
export const SUPABASE_KEY_NAME = "DAILYSTORY_SUPABASE_SERVICE_ROLE_KEY";

/**
 * The PostgREST calls for one code command, in order. Pure, so the test checks them against the
 * table's own migration. `op`: create (insert, a conflict means it already exists), off (active =
 * false), count (read the signups view). Every op ends by reading the view, so she always gets the counts.
 */
export function codeCalls(spec, base = SUPABASE_URL) {
  const rest = `${base}/rest/v1`;
  const view = { method: "GET", url: `${rest}/${ACCESS_CODE_SHAPE.view}?select=${ACCESS_CODE_SHAPE.view_columns.join(",")}&order=code` };
  if (spec.op === "create") {
    return [{ method: "POST", url: `${rest}/${ACCESS_CODE_SHAPE.table}`, prefer: "return=representation",
      body: { code: spec.code, trial_days: spec.trial_days, label: spec.label ?? null, active: true } }, view];
  }
  if (spec.op === "off") {
    return [{ method: "PATCH", url: `${rest}/${ACCESS_CODE_SHAPE.table}?code=eq.${encodeURIComponent(spec.code)}`, prefer: "return=representation", body: { active: false } }, view];
  }
  return [view];
}

/** Run a code command against Supabase. `{ ok, done, already, missing, codes }` or `{ ok: false, why }`. */
export async function runCode(spec, { key = process.env[SUPABASE_KEY_NAME], fetchImpl = fetch } = {}) {
  if (!key) return { ok: false, why: `time-2-read's Supabase service key (${SUPABASE_KEY_NAME}) is not in the vault` };
  const out = { ok: true, done: true, already: false, missing: false, codes: [] };
  for (const call of codeCalls(spec)) {
    const res = await fetchImpl(call.url, {
      method: call.method,
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", ...(call.prefer ? { prefer: call.prefer } : {}) },
      ...(call.body ? { body: JSON.stringify(call.body) } : {}),
    });
    if (call.method === "POST" && res.status === 409) { out.already = true; continue; }
    if (!res.ok) return { ok: false, why: `Supabase refused the ${call.method} (${res.status})` };
    const rows = await res.json().catch(() => []);
    if (call.method === "PATCH" && Array.isArray(rows) && rows.length === 0) out.missing = true;
    if (call.method === "GET") out.codes = Array.isArray(rows) ? rows : [];
  }
  return out;
}

const READONLY = "https://www.googleapis.com/auth/gmail.readonly";
const LOOKUP_TOOLS = "select:mcp__claude_ai_Google_Drive__search_files,mcp__claude_ai_Google_Drive__get_file_permissions,mcp__claude_ai_Google_Drive__get_file_metadata,mcp__claude_ai_Gmail__search_threads,mcp__claude_ai_Gmail__get_thread";

/** The lookup prompt. Pure, so the test reads exactly what the seat is told. */
export function lookupPrompt(spec) {
  const hints = (spec.hints ?? []).filter(Boolean);
  return [
    `Find the email address of ${spec.name}${spec.relation ? ` (the owner's ${spec.relation})` : ""}. Search only; never send, share or change anything.`,
    hints.length ? `1. Google Drive: search file NAMES for ${hints.map((h) => `"${h}"`).join(", ")} (try shorter forms too). For every matching file, read its sharing list (get_file_permissions) and note each person's name and address.` : "1. Google Drive: search file names and contents for the name; read each match's sharing list.",
    `2. Gmail: search for "${spec.name}" (from:, to:, and the name in the body) and note the addresses that go with that name.`,
    "3. Keep ONLY addresses you actually saw in a tool result. Never construct or guess an address. A candidate needs evidence: which file shared with it, or which email thread used it, and whether the person's name appears next to it.",
    'Answer with JSON only, in a ```json block: {"candidates":[{"email":"...","name":"the name shown with it or null","evidence":["shared on the file \\"<file name>\\" as <display name>", "emailed you on <date>: \\"<subject>\\""]}]}. Most likely first. An empty list if nothing was found.',
  ].join("\n");
}

/** The draft prompt. Her voice, her facts, nothing invented. */
export function draftPrompt(spec, { changeNote = null, previous = null } = {}) {
  const repo = PRODUCT_REPOS.find((p) => p.product === spec.brand);
  const local = repo ? `~/GitHub/${repo.github_repo.split("/")[1]}` : null;
  return [
    `Write an email from Sequoia Taylor to ${spec.recipient_name ?? "the recipient"} <${spec.to}>. It goes out in HER name, so it is in her voice: warm, direct, short sentences, no corporate filler, no exclamation-mark pile-ups, signed "Sequoia".`,
    `What she asked for, in her words: """${spec.ask}"""`,
    `The part that is this email: """${spec.purpose}"""`,
    spec.code ? `The code to give them, exactly: ${spec.code}` : "",
    local ? `Facts about ${spec.brand} come ONLY from its own repo on this Mac: read ${local}/README.md and the landing page copy under ${local} (Read/Grep/Glob). Never invent a feature, a price or a claim about a competitor that the repo does not support; if a comparison is not supported, describe what it does instead.` : "",
    changeNote ? `She asked for this change to the previous version: """${changeNote}"""\nPrevious version:\n"""${previous ?? ""}"""` : "",
    'Answer with JSON only, in a ```json block: {"subject":"...","text":"the whole email body as plain text"}.',
  ].filter(Boolean).join("\n\n");
}

/** The errand prompt: one phrase for the fixed letter, from her words only. Pure. */
export function errandPrompt(spec, now = Date.now()) {
  const today = new Intl.DateTimeFormat("en-US", { timeZone: OWNER_TZ, weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date(now));
  return [
    `Sequoia Taylor asked her assistant Simone to send a request to a business at <${spec.to}>. Today is ${today} (Central time).`,
    `Her words: """${spec.ask}"""`,
    "Write two things, and nothing else:",
    '1. "request": ONE phrase that completes the sentence "I\'m writing on behalf of Sequoia Taylor to request ...". Use only what her words say: the thing (a table, an appointment ...), the business name if she gave it, how many people ("+1" means two people, "a table for two"), the day as a full date (resolve "Thursday" to the next one from today), and the time window. Invent nothing: no phone number, no occasion, no card, no money, no address, no link, no mention of AI. Example: "a table for two at The Example Club on Thursday, October 29, any time after 8:00 pm".',
    '2. "subject": a short subject such as "Reservation request: Thursday, October 29, party of 2".',
    'Answer with JSON only, in a ```json block: {"subject":"...","request":"..."}.',
  ].join("\n");
}

/** The errand that goes, from the model's phrase: `{ subject, request, text, problems }`. Pure. */
export function buildErrand(json) {
  const subject = String(json?.subject ?? "").trim();
  const request = String(json?.request ?? "").trim().replace(/^to request\s+/i, "");
  return { subject, request, text: errandText(request), problems: errandProblems({ subject, request }) };
}

/** The employeeMail arguments for a notice the Worker laid out. Pure; the gate and the send are postEmployeeMail's. */
export function noticeArgs(id, notice, to = OWNER_TO) {
  return { to, subject: notice.subject, layout: { happened: notice.happened, details: notice.details ?? [], decide: notice.decide ?? [] }, refs: [id] };
}

async function main() {
  const api = await bossApi();
  const work = await api.post("/commands/tick");
  let did = 0;
  const failures = [];

  for (const l of work.lookups ?? []) {
    const r = askClaudeJson(lookupPrompt(l.spec), { model: "sonnet", maxTurns: 40, timeoutMs: 600_000, requireTool: /Google_Drive|Gmail/i, toolSearch: LOOKUP_TOOLS });
    if (r.ok && Array.isArray(r.json?.candidates)) { await api.post(`/commands/${l.id}/lookup`, { candidates: r.json.candidates }); did++; }
    else { await api.post(`/commands/${l.id}/failed`, { why: r.why ?? "the lookup returned no candidate list" }); failures.push(l.id); }
  }

  for (const d of work.drafts ?? []) {
    const r = askClaudeJson(draftPrompt(d.spec, { changeNote: d.change_note, previous: d.previous }), { model: "sonnet", maxTurns: 20, timeoutMs: 600_000 });
    if (r.ok && r.json?.subject && r.json?.text) { await api.post(`/commands/${d.id}/draft`, { subject: r.json.subject, text: r.json.text }); did++; }
    else { await api.post(`/commands/${d.id}/failed`, { why: r.why ?? "the draft came back without a subject or body" }); failures.push(d.id); }
  }

  for (const c of work.codes ?? []) {
    const r = await runCode(c.spec);
    if (r.ok) { await api.post(`/commands/${c.id}/code`, { done: r.done, already: r.already, missing: r.missing, codes: r.codes }); did++; }
    else {
      if (/not in the vault/.test(r.why)) console.error(`NAMED STOP [NO_SUPABASE_KEY] ${r.why}; the code goes through Danielle instead.`);
      await api.post(`/commands/${c.id}/failed`, { why: r.why }); failures.push(c.id);
    }
  }

  for (const e of work.errands ?? []) {
    const r = askClaudeJson(errandPrompt(e.spec), { model: "sonnet", maxTurns: 3, timeoutMs: 180_000 });
    const built = r.ok ? buildErrand(r.json) : null;
    if (!built || built.problems.length) {
      await api.post(`/commands/${e.id}/failed`, { why: built ? `the request was not fit to send (${built.problems.join("; ")})` : (r.why ?? "no request came back") });
      failures.push(e.id); continue;
    }
    const sent = await postErrandMail(errandMail({ to: e.spec.to, subject: built.subject, text: built.text }));
    if (sent.ok) { await api.post(`/commands/${e.id}/errand-sent`, { message_id: sent.id, subject: built.subject, text: built.text, request: built.request }); did++; }
    else { await api.post(`/commands/${e.id}/failed`, { why: `the send was refused (${sent.error})` }); failures.push(e.id); }
  }

  // Her answer or her cancellation, in THEIR thread (her reply was the approval). Never a card: the
  // Worker refused those words before they were queued, and followUpProblems checks again here.
  for (const f of work.errand_follow_ups ?? []) {
    const problems = followUpProblems(f.text);
    if (problems.length) { await api.post(`/commands/${f.id}/failed`, { why: `the follow-up was not fit to send (${problems.join("; ")})` }); failures.push(f.id); continue; }
    const sent = await postErrandMail(errandMail({ to: f.to, subject: f.subject, text: f.text, inReplyTo: f.in_reply_to }));
    if (sent.ok) { await api.post(`/commands/${f.id}/errand-followed-up`, { message_id: sent.id }); did++; }
    else { console.error(`NAMED STOP [ERRAND_FOLLOW_UP_NOT_SENT] ${f.id}: ${sent.error}`); failures.push(f.id); }
  }

  const byMailbox = new Map();
  for (const b of work.bounce_checks ?? []) if (b.mailbox && b.address) byMailbox.set(b.mailbox, [...(byMailbox.get(b.mailbox) ?? []), b]);
  for (const [mailbox, checks] of byMailbox) {
    let token;
    try { token = await googleToken(READONLY, mailbox); } catch (e) { console.error(`NAMED STOP [BOUNCE_UNREADABLE] ${mailbox}: ${e.message}`); continue; }
    for (const b of checks) {
      const hits = await gmailHeaders(token, `from:(mailer-daemon OR postmaster) newer_than:3d "${b.address}"`, 5).catch(() => []);
      const after = hits.filter((h) => Date.parse(h.date) >= new Date(b.since).setUTCHours(0, 0, 0, 0));
      if (after.length) { await api.post(`/commands/${b.id}/bounced`, { address: b.address }); did++; }
    }
  }

  // Notices last, so a lookup or draft made this tick goes out this tick.
  const again = (work.lookups?.length || work.drafts?.length || work.codes?.length || work.errands?.length || work.errand_follow_ups?.length || did) ? await api.post("/commands/tick") : work;
  const [simone] = sendersFor("Simone");
  for (const n of again.notices ?? []) {
    const res = await postEmployeeMail(simone, employeeMail(simone, noticeArgs(n.id, n.notice)));
    if (res.ok) {
      // An errand's answer also goes into her morning email: a line, or a Decide item for a card ask.
      const m = n.notice?.morning;
      if (m?.line || m?.decide) {
        try { addMorningLines("notices", { lines: m.line ? [m.line] : [], decide: m.decide ? [m.decide] : [] }); }
        catch (e) { console.error(`NAMED STOP [MORNING_LINE_NOT_WRITTEN] ${n.id}: ${e.message}`); }
      }
      await api.post(`/commands/${n.id}/noticed`); did++;
    }
    else console.error(`NAMED STOP [NOTICE_NOT_SENT] ${n.id}: ${res.status}`);
  }

  if (failures.length) console.error(`${failures.length} command(s) failed and went to Danielle as jobs: ${failures.join(", ")}`);
  if (!did && !failures.length) { console.log("NAMED STOP [NOTHING_WAITING] no lookup, draft, errand, bounce or notice was waiting."); process.exit(7); }
  console.log(`simone-commands: ${did} thing(s) done.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
}
