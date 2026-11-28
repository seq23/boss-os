/** Reply-all addressing for the latest message. Reply meaning is read by the worker router. */

/** Our own mail domains: never a recipient of a reply-all, never "the other side". */
export const OUR_MAIL_DOMAINS = Object.freeze([
  "westpeek.ventures", "joinwestpeek.com", "westpeek.live", "sequoiataylor.com", "spry.vc", "time-2-read.com",
]);

/** Every address in a header value, as `{ address, display }`, in order. */
export function addressesIn(value) {
  const out = [];
  const s = String(value ?? "");
  // Split on commas that are not inside a quoted display name.
  const parts = s.match(/(?:"[^"]*"|[^,])+/g) ?? [];
  for (const raw of parts) {
    const m = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(raw);
    if (!m) continue;
    out.push({ address: m[0].toLowerCase(), display: raw.trim().replace(/\s+/g, " ") });
  }
  return out;
}

/** One of ours: our domains (and their subdomains), or an extra address or domain the caller names. */
export function isOurs(address, extra = []) {
  const a = String(address ?? "").toLowerCase().trim();
  const domain = a.split("@")[1] ?? "";
  const list = [...OUR_MAIL_DOMAINS, ...(extra ?? []).map((x) => String(x).toLowerCase().trim()).filter(Boolean)];
  return list.some((d) => (d.includes("@") ? a === d : domain === d || domain.endsWith(`.${d}`)));
}

/**
 * Reply-all to their latest message, minus us. `latest` is that message's headers (From, To, Cc,
 * Reply-To; any case). Returns `{ to: string[], cc: string[] }` as "Name <address>" or bare address,
 * deduplicated by address. `to` is empty only when every address on it is ours.
 */
export function replyAllRecipients(latest, { ours = [] } = {}) {
  const h = Object.fromEntries(Object.entries(latest ?? {}).map(([k, v]) => [String(k).toLowerCase(), v]));
  const seen = new Set();
  const take = (list) => list.filter((x) => !isOurs(x.address, ours) && !seen.has(x.address) && seen.add(x.address));
  const writer = addressesIn(h["reply-to"]).length ? addressesIn(h["reply-to"]) : addressesIn(h.from);
  const to = take(writer);
  const cc = take([...addressesIn(h.from), ...addressesIn(h.to), ...addressesIn(h.cc)]);
  if (!to.length && cc.length) to.push(cc.shift());
  return { to: to.map((x) => x.display), cc: cc.map((x) => x.display) };
}

/** The lines her approval email shows: "To: …" and, when anyone is copied, "Cc: …". */
export function recipientLines(r) {
  const to = (r?.to ?? []).filter(Boolean);
  const cc = (r?.cc ?? []).filter(Boolean);
  return [`To: ${to.length ? to.join(", ") : "(nobody: check the thread)"}`, ...(cc.length ? [`Cc: ${cc.join(", ")}`] : [])];
}
