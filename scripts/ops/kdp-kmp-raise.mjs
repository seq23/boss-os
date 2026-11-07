#!/usr/bin/env node
/**
 * PUTS A KEEPMYPROOF KINDLE DRAFT IN HER INBOX — the existing KDP approval path (a `kdp_new_title`
 * judgement call with the cover on it), so nothing reaches Amazon without her yes.
 *
 *   npm run kdp:kmp-raise -- --folder divorce
 *       raises the card (cover attached, listing in the question); she approves or sends it back.
 *   npm run kdp:kmp-raise -- --folder divorce --approved-in-chat "approve the book" --on 2026-11-07
 *       she has ALREADY said yes in words (7 Nov 2026, in chat, after reading the preview page): the
 *       card is raised and decided at once as hers (decided_by boss), her words quoted in the note,
 *       so she is never asked to tap a second time and the record still says who decided and how.
 *
 * Rule 0: prints `OUTPUT <n> kmp-kindle-approvals <folder>`; no draft on this Mac, or a card without
 * its cover, is a NAMED STOP (a card asking her to approve an empty frame is the defect the asset
 * rows exist to prevent). Exit 0 raised · 2 no draft / not recorded · 3 no passcode.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const DRAFTS = process.env.KMP_KDP_DIR ?? join(process.env.HOME ?? ".", ".boss-os/kdp/keepmyproof");
const stop = (code, msg, exit) => Object.assign(new Error(`NAMED STOP [${code}] ${msg}`), { code: exit });

/** Pure: the card's question, in her words — what the book is, what approve does, what it costs her. */
export function question(meta, { preview } = {}) {
  return [
    `A KeepMyProof Kindle book, drafted: "${meta.title}: ${meta.subtitle}" by ${meta.author}, published by ${meta.publisher}, $${Number(meta.price_usd).toFixed(2)}.`,
    `Inside: a short guide, a checklist, fill-in logs and ${meta.facts} sourced facts for ${meta.where}. AI disclosure on.`,
    `Keywords: ${meta.keywords.join(", ")}. Categories: ${meta.categories.join("; ")}.`,
    preview ? `Read the whole book: ${preview}` : `The whole book is on this Mac: ~/.boss-os/kdp/keepmyproof/${meta.folder}/preview.html`,
    "Approve and it goes on Kindle in one visible run with the AI disclosure checked before Publish (you sign in to Amazon in that window). Send it back with a sentence and it is redrafted.",
  ].join("\n");
}

export async function raise({ folder, approvedInChat = null, on = null, preview = null, env = process.env, fetchImpl = fetch }) {
  const dir = join(DRAFTS, folder);
  if (!existsSync(join(dir, "listing.json")) || !existsSync(join(dir, "cover.jpg"))) throw stop("NO_DRAFT", `no draft for ${folder} on this Mac; run kdp-kmp-draft.mjs --folder ${folder} first.`, 2);
  const meta = JSON.parse(await readFile(join(dir, "listing.json"), "utf8"));
  if (!env.BOSS_PASSCODE) throw stop("NO_PASSCODE", "run through the vault: npm run kdp:kmp-raise", 3);
  const u = await fetchImpl(`${ORIGIN}/api/boss/auth/unlock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: env.BOSS_PASSCODE }) });
  if (!u.ok) throw stop("UNLOCK_REFUSED", `Boss OS refused the passcode (${u.status}).`, 3);
  const cookie = (u.headers.get("set-cookie") ?? "").split(";")[0];
  const r = await fetchImpl(`${ORIGIN}/api/boss/judgement`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      employee_id: "emp_chief", lane: "ops", risk: "medium",
      title: meta.title, question: question(meta, { preview }), resume_kind: "kdp_new_title",
      assets: [{ label: `Cover: ${meta.title}`, media_type: "image/jpeg" }],
    }),
  });
  if (!r.ok) throw stop("NOT_RECORDED", `Boss OS did not raise the card (${r.status}): ${(await r.text()).slice(0, 200)}`, 2);
  const { data } = await r.json();
  const put = await fetchImpl(`${ORIGIN}/api/boss/judgement/${data.id}/asset/0`, { method: "PUT", headers: { cookie, "content-type": "image/jpeg" }, body: await readFile(join(dir, "cover.jpg")) });
  if (!put.ok) throw stop("NO_COVER_ON_CARD", `the card ${data.id} was raised but its cover did not upload (${put.status}); it reads as missing on the card.`, 2);
  if (!approvedInChat) return { id: data.id, approval_id: data.approval_id, decided: false };
  const note = `Approved by her in chat on ${on ?? new Date().toISOString().slice(0, 10)}, after reading the preview${preview ? ` (${preview})` : ""}. Her words: "${approvedInChat}"`;
  const d = await fetchImpl(`${ORIGIN}/api/boss/approvals/${data.approval_id}/decide`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ decision: "approved", note }) });
  if (!d.ok) throw stop("NOT_RECORDED", `the card ${data.id} is raised but her yes was not recorded (${d.status}): ${(await d.text()).slice(0, 200)}`, 2);
  const body = await d.json();
  if (body?.data?.execution?.status && body.data.execution.status !== "executed") throw stop("NOT_RECORDED", `her yes was recorded but the handler did not run: ${JSON.stringify(body.data.execution).slice(0, 200)}`, 2);
  return { id: data.id, approval_id: data.approval_id, decided: true, note };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const a = process.argv.slice(2);
  const val = (n) => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : null; };
  const folder = val("folder");
  raise({ folder, approvedInChat: val("approved-in-chat"), on: val("on"), preview: val("preview") })
    .then((r) => { console.log(`${r.decided ? "approved (her words recorded)" : "raised in her Inbox"}: ${r.id} / ${r.approval_id}`); console.log(`OUTPUT 1 kmp-kindle-approvals ${folder}`); })
    .catch((e) => { console.error(String(e?.message ?? e)); console.log(`OUTPUT 0 kmp-kindle-approvals ${folder ?? "-"}`); process.exit(e?.code ?? 1); });
}
