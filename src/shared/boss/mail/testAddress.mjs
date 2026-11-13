/**
 * A TEST ADDRESS IS NEVER MAIL (13 Nov 2026: a test's "Could not do: a synthetic job" to o@example.com
 * was written into her Mac's real sent-mail folder and uploaded to the live sent log by the next real
 * send). The reserved domains (RFC 2606 / 6761) can never receive mail, so a record addressed only to
 * them is a test's. One rule for the Mac's archive (scripts/ops/notify.mjs) and the Worker's sent log
 * (src/worker/boss/mail/history.ts). Pure.
 */
const RESERVED = /(?:^|[@.])(?:example\.(?:com|org|net)|[a-z0-9-]+\.(?:test|invalid|example)|localhost)$/i;

/** One address ("Name <a@b>" or "a@b") on a reserved test domain. */
export function isTestAddress(address) {
  const a = String(address ?? "").trim().replace(/^.*<|>.*$/g, "").toLowerCase();
  return a.includes("@") && RESERVED.test(a.slice(a.lastIndexOf("@")));
}

/** Every recipient ("a, b" or an array) is a test address; an empty list is not. */
export function onlyTestAddresses(to) {
  const list = (Array.isArray(to) ? to : String(to ?? "").split(",")).map((x) => String(x).trim()).filter(Boolean);
  return list.length > 0 && list.every(isTestAddress);
}
