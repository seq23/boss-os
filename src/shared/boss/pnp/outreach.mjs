/** Campaign decisions shared by the Mac runner and its authenticated D1 desk. No contact data. */
export const DAILY_FIRST_CAP = 12;
export const DAILY_FOLLOWUP_CAP = 15;
export const chicagoDay = (now) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
export const weekday = (now) => !["Sat", "Sun"].includes(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short" }).format(new Date(now)));
export function dayStart(now) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" }).formatToParts(new Date(now));
  const get = (key) => Number(parts.find((p) => p.type === key).value);
  return now - (get("hour") * 3600 + get("minute") * 60 + get("second")) * 1000 - now % 1000;
}
const lower = (s) => String(s ?? "").trim().toLowerCase();
export const emailDomain = (email) => lower(email).split("@")[1] ?? "";
const domainMatches = (a, b) => a === b || a.endsWith(`.${b}`);

export function stopReason(status, now) {
  if (Number(status.corporate_booked) >= 4) return "All 4 business bookings are filled.";
  if (chicagoDay(now) > "2026-12-05") return "The Christmas outreach season has finished.";
  return status.stopped || null;
}

/** Missing exclusions are unreadable, never an empty list. The sender remains the final guard. */
export function contactRules(status) {
  const list = status.do_not_contact ?? status.outreach_do_not_contact;
  if (!Array.isArray(list) || !list.every((s) => typeof s === "string" && s.trim())) throw new Error("Do-not-contact settings could not be read.");
  return list.map(lower);
}

export function blocked(row, status) {
  const domain = lower(row.domain);
  if (contactRules(status).some((s) => lower(row.company) === s || domainMatches(domain, s))) return "skipped";
  // A reply from ANY address at a company ends its sequence, including a forwarded colleague.
  const matches = (s) => lower(s) === lower(row.contact_email) || domainMatches(domain, emailDomain(s) || lower(s));
  if ((status.suppressed ?? []).some(matches)) return "suppressed";
  if ((status.taken_over ?? []).some(matches)) return "taken_over";
  if ((status.replies ?? []).some((r) => matches(r.email) && !/^(auto_reply|auto-reply|out_of_office|ooo|bounce|dsn|opt_out|unsubscribe)$/i.test(r.kind))) return "replied";
  return null;
}

export function validProspect(row) {
  if (!["company", "domain", "contact_first", "contact_email", "role", "line", "source_url", "line_source_url"].every((k) => typeof row[k] === "string" && row[k].trim() && !/[\r\n]/.test(row[k]))) return false;
  if (!/^[^@\s<>]+@[^@\s<>]+\.[a-z]{2,}$/i.test(row.contact_email) || emailDomain(row.contact_email) !== lower(row.domain)) return false;
  if (!["lobby", "party"].includes(row.kind)) return false;
  return [row.source_url, row.line_source_url].every((s) => { try { const u = new URL(s); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; } });
}

/** Unwrap only the artifact's physical line wrapping; preserve its explicit paragraph breaks. */
export function parseContract(source) {
  const unwrap = (s) => s.trim().replace(/\s*\n\s*/g, " ").replace(/\\n/g, "\n");
  const subject = /Subject: (Christmas decor for \{Company\}\?)/.exec(source)?.[1];
  const body = /\n\s*(Hi \{First\},[\s\S]*?)\n\s*Building-manager variant:/.exec(source)?.[1];
  const lobby = /Building-manager variant:[\s\S]*?becomes "([\s\S]*?)"/.exec(source)?.[1];
  // The follow-up is the indented block after its heading; the next unindented section (FOOTER, the
  // sender's own concern) must never be read into the approved words.
  const follow = /Follow-up \([\s\S]*?\):[ \t]*\n[ \t]+(Hi \{First\},.*(?:\n[ \t]+\S.*)*)/.exec(source)?.[1];
  if (!subject || !body || !lobby || !follow) throw new Error("The approved outreach contract is missing or unreadable.");
  const first = unwrap(body);
  const middle = first.split("\n\n")[2];
  if (!middle?.startsWith("Each December")) throw new Error("The approved contract has no December paragraph.");
  return { subject, party: first, lobby: first.replace(middle, unwrap(lobby)), followup: unwrap(follow) };
}

export function renderEmail(template, row, followup = false) {
  const fill = (s) => s.replace(/\{(Company|First|line)\}/g, (_, k) => ({ Company: row.company, First: row.contact_first, line: row.line })[k]);
  return { subject: `${followup ? "Re: " : ""}${fill(template.subject)}`, text: fill(followup ? template.followup : template[row.kind]) };
}

export function planSends(rows, status, now) {
  if (stopReason(status, now) || !weekday(now)) return [];
  contactRules(status);
  const eligible = rows.filter((r) => validProspect(r) && !blocked(r, status) && r.nb_verdict === "valid");
  const usedFirst = rows.filter((r) => r.first_attempt_at && chicagoDay(r.first_attempt_at) === chicagoDay(now)).length;
  const usedFollow = rows.filter((r) => r.followup_attempt_at && chicagoDay(r.followup_attempt_at) === chicagoDay(now)).length;
  const first = eligible.filter((r) => r.state === "verified" && !r.first_attempt_at)
    .sort((a, b) => Number(b.kind === "lobby") - Number(a.kind === "lobby"))
    .slice(0, Math.max(0, DAILY_FIRST_CAP - Math.max(status.sent_today, usedFirst)));
  const follow = eligible.filter((r) => r.state === "sent1" && r.first_message_id && r.first_sent_at && !r.followup_attempt_at && !r.followup_sent_at && now - r.first_sent_at >= 5 * 86400000)
    .slice(0, Math.max(0, DAILY_FOLLOWUP_CAP - Math.max(status.followups_today, usedFollow)));
  return [...first.map((row) => ({ row, touch: 1 })), ...follow.map((row) => ({ row, touch: 2 }))];
}

export function assertStatus(s) {
  if (!s || ![s.sent_today, s.followups_today, s.corporate_booked].every((n) => Number.isInteger(n) && n >= 0)
      || ![s.suppressed, s.taken_over, s.replies].every(Array.isArray) || !(s.stopped === null || typeof s.stopped === "string")) throw new Error("Outreach status could not be read safely.");
  return s;
}
