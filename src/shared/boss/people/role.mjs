/**
 * A ROLE MAILBOX IS A TEAM, NEVER A PERSON (26 Oct 2026: "Operations, Rainmaker" showed in Monique's
 * deal grid as if Operations were somebody's name). One rule for every screen and email that names
 * who sent something: the deal grid's "from", Monique found, the catch-ups.
 */
const ROLE_LOCALS = /^(ops|operations|info|team|desk|trading|admin|support|hello|contact|sales|deals|office|enquiries|inquiries|marketing|press|media|hr|careers|jobs|billing|accounts|finance|compliance|legal|investors?|ir|rrlist|list|group|noreply|no-reply|donotreply|notifications?|alerts?|mailer-daemon|postmaster)$/i;
const ROLE_NAMES = /^(operations|ops|team|desk|trading|support|sales|info|admin|office|compliance|investor relations|the team)$/i;

/** True when the address's local part, or the display name alone, is a role and not a person. */
export function isRoleMailbox(addr, name = null) {
  const local = String(addr ?? "").toLowerCase().split("@")[0].replace(/[._-]?\d+$/, "");
  if (local && ROLE_LOCALS.test(local)) return true;
  return Boolean(name) && ROLE_NAMES.test(String(name).trim());
}

/** "Rainmaker operations team": how a role mailbox is named. */
export function roleWords(addr, name, firm) {
  const role = (String(name ?? "").trim() || String(addr ?? "").split("@")[0]).toLowerCase().replace(/[._-]+/g, " ");
  return `${firm ? `${firm} ` : ""}${role}${/team|desk$/.test(role) ? "" : " team"}`.trim();
}
