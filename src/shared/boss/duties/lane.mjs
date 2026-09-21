/**
 * THE DUTY LANE — "is there a lane for me to ask for a new duty to my Boss OS agents?"
 *
 * Owner, 21 September 2026: "i still dont know how to create a job for them — if it's not
 * user-friendly then make it so."
 *
 * ─── What existed, and why it never ran ────────────────────────────────────
 *
 * `duties/author.ts` has derived a proper duty from her phrase since the roster screen was written,
 * and `POST /employees/duties/draft` filed it in the Inbox as a judgement call whose Approve creates
 * it. NOTHING INVOKED EITHER. No screen called the route, and the mailbox classified a
 * `recurring_duty` message without ever drafting one. "Exists but nothing invokes it" — the defect
 * class this repository names first.
 *
 * ─── The lane, in her words ────────────────────────────────────────────────
 *
 *   To:      boss@sequoiataylor.com
 *   Subject: #monique new duty
 *   Body:    every friday, check the lp replies sheet and tell me who went quiet
 *
 * or `#simone new duty monique …` to let the Chief of Staff route it. The employee (or Simone)
 * replies with the full draft — name, owner, cadence with the concrete slot, executor and why,
 * model tier, delivery, every refusal verbatim — and the line "Reply `approved` to create it,
 * `changes: …` to redraft." Her `approved` on the thread creates it through the same approval loop
 * the Inbox button uses; `changes: …` redrafts with her text as overrides; `your call` in the
 * ORIGINAL request creates it without waiting and says so (recorded as pre-approved with the phrase).
 *
 * The Team → Duties screen is the second door and files exactly what the mail door files.
 *
 * ─── THIS FILE IS THE ONE RECORD ───────────────────────────────────────────
 *
 * The grammar, the token, the reply reader, the slot rule and the list of scripts her Mac can run
 * live here, imported by the Worker, the tests and `validate:duty-birth`. A rule restated in a
 * second place is a rule that drifts; the validator runs THESE functions over fixtures so a change
 * here is a change everywhere at once.
 */

import { seatTag } from "../intake/mail.mjs";
import { readReply, APPROVAL_WORDS, PRE_APPROVAL_PHRASES, preApprovalIn } from "../repoChange/lane.mjs";

/**
 * PRE-APPROVAL IN THE REQUEST. "your call" in her ORIGINAL message creates the duty without waiting
 * for a reply, and the row records the phrase. Read from the request only, never from a later
 * message. The repo lane's six phrases and its reader, imported — one list, two lanes.
 */
export { APPROVAL_WORDS, PRE_APPROVAL_PHRASES, preApprovalIn };

/** The verb. `#<seat> new duty` — the tag she already knows, plus two words. */
export const NEW_DUTY_RE = /#([a-z0-9]+)[\s:,-]+new\s+duty\b/i;

/** The role that may route a duty to a colleague: `#simone new duty monique …`. */
export const ROUTING_ROLE = "Chief of Staff";

/**
 * `[dd_…]` — the token every email about a draft carries, so her reply can name it without headers
 * surviving a forward or a phone client that trims the subject. Same shape as the repo lane's `[rc_…]`.
 */
export function draftToken(id) {
  return `[${String(id).trim()}]`;
}

export function draftTokenIn(text) {
  const m = /\[(dd_[a-z0-9]+)\]/i.exec(String(text ?? ""));
  return m ? m[1].toLowerCase() : null;
}

/**
 * Her request, read from the subject and the body together.
 *
 * Returns null when the verb is absent — most mail — so the ordinary path is untouched. When the
 * verb is present the answer is BINDING: a request that names no seat, or a seat that does not
 * exist, is refused with the roster rather than falling through to a model that would invent a
 * duty in her approval queue.
 *
 *   { seat, tag, phrase, routedBy, preApproved }  — a request for `seat`
 *   { error, tag }                                 — the verb with nobody to give it to
 */
export function dutyRequestIn(subject, body, roster) {
  const haystack = `${String(subject ?? "")}\n${String(body ?? "")}`;
  const m = NEW_DUTY_RE.exec(haystack);
  if (!m) return null;
  const tag = `#${m[1].toLowerCase()}`;
  const active = (roster ?? []).filter((s) => s && s.id && s.name);
  const byTag = (t) => active.find((s) => seatTag(s.name) === t) ?? null;

  let seat = byTag(tag);
  if (!seat) return { error: `There is no employee with the tag ${tag}.`, tag };

  // Everything after the verb, on the line it sits on, plus every other line: her phrase.
  const after = haystack.slice(m.index + m[0].length);
  const lines = after.split(/\r?\n/);
  const firstLine = (lines.shift() ?? "").replace(/^[\s:,\-–—]+/, "");
  const rest = lines.join("\n");
  // The part of the subject/body BEFORE the verb is not the phrase (a "Re:" or a greeting).
  let phrase = `${firstLine}\n${rest}`.trim();
  let routedBy = null;

  /*
   * `#simone new duty monique every friday …` — the Chief of Staff routes it. Only her role may;
   * `#monique new duty camille …` is Monique's duty about Camille, not a routing.
   */
  if (String(seat.role ?? "").toLowerCase() === ROUTING_ROLE.toLowerCase()) {
    const named = /^\s*#?([a-z][a-z0-9'’]*)\b[\s:,\-–—]*/i.exec(firstLine);
    const target = named ? byTag(seatTag(named[1])) : null;
    if (target && target.id !== seat.id) {
      routedBy = seat;
      seat = target;
      phrase = `${firstLine.slice(named[0].length)}\n${rest}`.trim();
    }
  }

  return { seat, tag, phrase, routedBy, preApproved: preApprovalIn(haystack) };
}

/**
 * Her reply on the thread.
 *
 *   approved — one line, an approval word: create it exactly as drafted
 *   changes  — starts "changes:" / "change:": redraft with her text as overrides
 *   held     — "no" / "stop" / "not approved" / "hold": send the draft back, nothing created
 *   other    — anything else: a note on the draft, nothing created
 *   empty    — no readable text
 *
 * `readReply` is the repo lane's reader, reused rather than copied; this only splits its `held`
 * into the two things she can mean by it.
 */
export function readDutyReply(text) {
  // The token she kept or typed is an address, not part of her answer: "approved [dd_x]" is "approved".
  text = String(text ?? "").replace(/\s*\[dd_[a-z0-9]+\]\s*/gi, " ").trim();
  const r = readReply(text);
  if (r.mode === "approved") return { mode: "approved", text: r.text };
  if (r.mode === "empty") return { mode: "empty", text: "" };
  const first = String(text ?? "").trim().split(/\r?\n/).map((l) => l.trim()).find((l) => l) ?? "";
  const changes = /^changes?\s*:\s*/i.exec(first);
  if (changes) {
    const overrides = `${first.slice(changes[0].length)}\n${String(text ?? "").trim().split(/\r?\n/).slice(1).join("\n")}`.trim();
    return { mode: "changes", text: overrides };
  }
  if (r.mode === "held") return { mode: "held", text: r.text };
  return { mode: "other", text: r.text };
}

// ─── The slot ────────────────────────────────────────────────────────────────

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** The weekday her phrase names, 0 = Sunday, or null. "every friday", "fridays", "on monday". */
export function weekdayIn(text) {
  const t = String(text ?? "").toLowerCase();
  for (let i = 0; i < DAY_NAMES.length; i += 1) {
    const d = DAY_NAMES[i];
    if (new RegExp(`\\b(?:every\\s+|each\\s+|on\\s+)?${d}s?\\b`).test(t)) return i;
  }
  return null;
}

/** The hour her phrase names, or null. "at 3pm", "at 15:30", "at 9", "9am". A bare number is a count. */
export function hourIn(text) {
  const t = String(text ?? "").toLowerCase();
  const m = /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/.exec(t) || /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(t);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const ampm = m[3];
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/**
 * HOURS THAT ARE ALREADY HERS, America/Chicago.
 *
 * Read from ~/SCHEDULE.md (5 Sep 2026) and the installed launchd jobs: the briefing lands at 06:00
 * for her seven o'clock read, the Mac's other jobs fire at 09:00, 09:23, 10:07, 11:11, 18:07 and
 * 23:00, and the evening is hers. A duty that fires while she is reading the briefing competes for
 * the same attention; one that fires beside the CI sweep competes for the same Mac. The candidates
 * are tried in order of how quiet the hour is on an ordinary day.
 */
export const BUSY_HOURS = {
  6: "the briefing is being written for your 07:00 read",
  7: "you are reading the briefing",
  9: "the how-we-know backfill and the KDP watch fire at 09:00 and 09:23",
  10: "the CI sweep fires at 10:07",
  11: "the shorts arm fires at 11:11",
  18: "the CI sweep fires at 18:07",
  23: "the how-we-know batch fires at 23:00",
};

export const CANDIDATE_HOURS = [8, 13, 14, 15, 16, 12, 17, 19, 20, 21];

/**
 * An empty slot for a duty her phrase gave a day for but not an hour.
 *
 * `taken` is every existing duty's fire time (from D1, which is where every launchd duty's time
 * already lives — `duty-run.sh` is the link). A daily duty blocks its hour on every day; a weekly
 * one only on its day. The first candidate hour that is neither busy nor taken wins, minute 0, and
 * `why` says what was skipped so the draft can say it too.
 */
export function pickSlot(taken, want) {
  const wantDay = want?.cadence === "weekly" ? (want.weekday ?? 1) : null;
  const skipped = [];
  const blockedBy = (hour) => (taken ?? []).find((d) => {
    if (Number(d.local_hour) !== hour) return false;
    if (d.cadence === "daily") return true;
    if (wantDay === null) return true; // a daily want is blocked by anything at that hour
    return d.cadence === "weekly" && Number(d.weekday ?? 1) === wantDay;
  });
  for (const hour of CANDIDATE_HOURS) {
    if (BUSY_HOURS[hour]) { skipped.push(`${pad(hour)}:00 (${BUSY_HOURS[hour]})`); continue; }
    const b = blockedBy(hour);
    if (b) { skipped.push(`${pad(hour)}:00 (${b.name ?? b.id ?? "another duty"} fires then)`); continue; }
    return {
      hour, minute: 0,
      why: skipped.length
        ? `${pad(hour)}:00 is the first quiet hour: skipped ${skipped.join(", ")}.`
        : `${pad(hour)}:00 is a quiet hour — nothing else of yours fires then and you are not reading the briefing.`,
    };
  }
  // Every candidate is taken: say so rather than guess. 08:30 is off the hour and collides with nothing on the tick.
  return { hour: 8, minute: 30, why: `Every whole hour from 08:00 to 21:00 is busy or taken (${skipped.join(", ")}), so 08:30 — the half hour fires at the next tick after.` };
}

const pad = (n) => String(n).padStart(2, "0");

// ─── The scripts her Mac can run ─────────────────────────────────────────────

/**
 * EVERY LOCAL JOB THE INSTALLER WRAPS IN `duty-run.sh`, and therefore every script a `local_job`
 * duty may name. `validate:duty-birth` pins this list equal to `install-agent-launchd.sh`, so a
 * script added to the Mac appears here or the build fails, and a name here that the installer does
 * not know fails the same way. The Worker cannot read the Mac's disk; this is how it knows what
 * exists there.
 *
 * A NEW local job is: write the script in scripts/ops, wrap it in the installer, add it here, run
 * the installer — THEN her `#seat new duty` names it and the duty row is created. Until then the
 * draft is a NAMED STOP that says exactly that.
 */
export const INSTALLED_LOCAL_JOBS = [
  "ahrefs-audit-fix.sh",
  "buyer-hunt.mjs",
  "credential-check.mjs",
  "filing-hunt.mjs",
  "grid-watch.mjs",
  "interest-extract.mjs",
  "interest-match.mjs",
  "kdp-publish.sh",
  "kdp-surface.sh",
  "lp-positive.mjs",
  "lp-replies.sh",
  "lp-tracker-sync.mjs",
  "mailbox-sweep.sh",
  "people-worth-a-call.mjs",
  "youtube-comment-watch.sh",
];

/** A script her phrase names outright — "run buyer-hunt.mjs every friday". */
export function scriptIn(text) {
  const m = /\b([a-z0-9][a-z0-9-]*\.(?:sh|mjs))\b/i.exec(String(text ?? ""));
  return m ? m[1].toLowerCase() : null;
}

/**
 * THE OWNER ↔ EXECUTOR ↔ SCRIPT CHECK, pure, over a draft and the duty rows that exist.
 *
 * Every created duty passes this, at draft time AND at the moment of creation (a handler or a
 * script can disappear in between). It is the rule `validate:duty-delivery` enforces after the
 * fact, run before the fact:
 *
 *   · an owner that exists and is active
 *   · an agent duty delivers into a key a handler exists for
 *   · a local job names a script the installer knows, that no other duty already claims (one
 *     script, one duty — `/duties/ran` refuses a run two rows would vouch for)
 *   · a model is named
 */
export function dutyProblems(draft, existing, deliverableKeys) {
  const problems = [];
  if (!draft || !draft.employee_id) problems.push("No owner: a duty must belong to an employee.");
  if (draft && draft.employee_active === false) problems.push(`${draft.employee_name ?? draft.employee_id} is not an active employee, so she cannot own this.`);
  if (draft && !draft.model) problems.push("No model named: a duty with no model runs the dearest one available.");
  if (draft && draft.executor === "agent") {
    if (!draft.delivers || !(deliverableKeys ?? []).includes(draft.delivers)) {
      problems.push(`An agent duty must deliver into a route that exists (${(deliverableKeys ?? []).join(", ")}); "${draft.delivers ?? "nothing"}" is not one, so its output would land nowhere.`);
    }
  } else if (draft && draft.executor === "local_job") {
    const script = draft.local_job;
    if (!script) {
      problems.push("A local job must name the script it runs.");
    } else if (!INSTALLED_LOCAL_JOBS.includes(script)) {
      problems.push(
        `NAMED STOP [NO_SUCH_SCRIPT]: this has to run on your Mac, and no script called \`${script}\` is installed there. ` +
        "Someone writes it in scripts/ops, wraps it in install-agent-launchd.sh, adds it to INSTALLED_LOCAL_JOBS and runs the installer; " +
        "then send this again and the duty is created. It is not created now, because a duty with nothing behind it would read as running and never run.",
      );
    } else {
      const claimed = (existing ?? []).find((d) => d.local_job === script);
      if (claimed) problems.push(`\`${script}\` already belongs to ${claimed.name ?? claimed.id}. One script, one duty — a second row would make every run vouch for both.`);
    }
  } else if (draft) {
    problems.push(`"${draft.executor}" is not an executor a draft can name (agent or local_job).`);
  }
  return problems;
}

// ─── "changes: …" → overrides ────────────────────────────────────────────────

/**
 * Her change text, read as overrides on the draft. Words the draft can act on become fields; the
 * whole text is also appended to the phrase so the prompt carries it verbatim. Nothing here
 * invents a field she did not name.
 */
export function overridesFrom(text) {
  const t = String(text ?? "");
  const out = {};
  if (/\b(daily|every day|each day|each morning|every morning)\b/i.test(t)) out.cadence = "daily";
  else if (/\b(weekly|every week|each week|once a week)\b/i.test(t)) out.cadence = "weekly";
  const day = weekdayIn(t);
  if (day !== null) { out.weekday = day; if (!out.cadence) out.cadence = "weekly"; }
  const hour = hourIn(t);
  if (hour) { out.local_hour = hour.hour; out.local_minute = hour.minute; }
  if (/\b(sonnet|better model|the good model|stronger model)\b/i.test(t)) out.model = "claude-sonnet-4-5-20250929";
  else if (/\b(haiku|cheap(er|est)? model|small model)\b/i.test(t)) out.model = "claude-haiku-4-5-20251001";
  if (/\b(on my mac|local job|from my mac|launchd)\b/i.test(t)) out.executor = "local_job";
  else if (/\b(as an agent|agent duty|in the cloud)\b/i.test(t)) out.executor = "agent";
  const script = scriptIn(t);
  if (script) { out.local_job = script; out.executor = "local_job"; }
  return out;
}
