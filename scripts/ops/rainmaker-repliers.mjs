#!/usr/bin/env node
/** Local, read-only Gmail scan; writes private repliers to D1 via the existing authenticated API.
 * Run through vault:run. RRLIST_ADDRESS/LP_MAILBOX override the existing mailbox defaults.
 * Optional --query '<Gmail query>' selects RR sent messages; in:sent is always enforced.
 * No names, addresses or message contents are printed or written to disk.
 */
import { pathToFileURL } from "node:url";
import { contentToken } from "./lp-positive.mjs";
import { bossSession, RRLIST } from "./interest-grid.mjs";

const addressOf = (s) => /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.exec(String(s ?? ""))?.[0].toLowerCase();
const header = (m, key) => (m.payload?.headers ?? []).find((h) => h.name.toLowerCase() === key)?.value ?? "";

/** Require an explicit reference to an RR send, not merely any later mail in its thread. */
export function repliersInThread(messages, sentIds) {
  const refs = new Set(messages.filter((m) => sentIds.has(m.id) && m.labelIds?.includes("SENT")).map((m) => header(m, "message-id")).filter(Boolean));
  const out = [];
  for (const m of messages) {
    if (m.labelIds?.includes("SENT")) continue;
    const references = `${header(m, "in-reply-to")} ${header(m, "references")}`.match(/<[^>]+>/g) ?? [];
    const address = addressOf(header(m, "from"));
    if (address && references.some((r) => refs.has(r))) out.push({ address, name: header(m, "from").replace(/<[^>]+>/g, "").replace(/^"|"$/g, "").trim() || null });
  }
  return out;
}

export async function main(args = process.argv.slice(2)) {
  const index = args.indexOf("--query");
  if (index >= 0 && !args[index + 1]) throw new Error("NAMED STOP [RR_QUERY_REQUIRED] --query needs a Gmail query");
  const query = `in:sent (${index >= 0 ? args[index + 1] : `to:${RRLIST}`})`;
  const token = await contentToken(); // existing gmail.readonly service-account tooling
  const get = async (p) => {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${p}`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`NAMED STOP [RR_MAILBOX_READ] Gmail HTTP ${res.status}`);
    return res.json();
  };
  const sends = [];
  let page;
  do {
    const result = await get(`messages?maxResults=500&q=${encodeURIComponent(query)}${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`);
    sends.push(...(result.messages ?? [])); page = result.nextPageToken;
  } while (page);
  if (!sends.length) throw new Error("NAMED STOP [RR_NO_SENDS] no RR-list sends matched; set --query or RRLIST_ADDRESS");
  const sentIds = new Set(sends.map((m) => m.id));
  const people = new Map();
  for (const threadId of new Set(sends.map((m) => m.threadId))) {
    const thread = await get(`threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From&metadataHeaders=Message-ID&metadataHeaders=In-Reply-To&metadataHeaders=References`);
    for (const person of repliersInThread(thread.messages ?? [], sentIds)) people.set(person.address, person);
  }
  if (!people.size) throw new Error("NAMED STOP [RR_NO_REPLIERS] sends found, no directly referenced replies found");
  const session = await bossSession();
  if (!session) throw new Error("NAMED STOP [RR_NO_SESSION] D1 not reached");
  const rows = [...people.values()];
  for (let i = 0; i < rows.length; i += 500) {
    const res = await session.post("/capital/rainmaker-repliers", { rows: rows.slice(i, i + 500) });
    if (!res?.ok) throw new Error(`NAMED STOP [RR_UPSERT_FAILED] HTTP ${res?.status ?? "unreachable"}`);
  }
  console.log(`Rainmaker repliers upserted: ${rows.length}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => {
  const stop = /^NAMED STOP \[[A-Z_]+\]/.exec(String(error?.message))?.[0] ?? "NAMED STOP [RR_IMPORT_FAILED]";
  console.error(`${stop} mailbox or D1 import stopped; no private data logged`); process.exitCode = 1;
});
