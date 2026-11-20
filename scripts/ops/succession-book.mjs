#!/usr/bin/env node
/**
 * THE SUCCESSION BOOK (owner ruling 19 Nov 2026, personal brain, Settled decisions "SUCCESSION PLAN, $0").
 *
 * Builds ONE markdown book for Scooter from:
 *   - her hand-written template, kept on her Mac only (~/Work/succession/book.template.md by default;
 *     SUCCESSION_TEMPLATE overrides). It holds her own words and the "[Sequoia fills]" answers, so it is
 *     never in this public repo;
 *   - her repo categories (the personal brain) and the App Store apps table (the spry brain), both
 *     through the Boss OS brain API; the live `gh repo list seq23`;
 *     and this repo's Repos, Domains, Social and Email maps.
 *   The other brains and ~/HANDOFF.md PINNED are read by hand into the template's own words when it
 *   is revised: pasted raw they carried developer notes, stale dates and brokerage detail a fresh
 *   review failed (20 Nov 2026).
 * Each `<!-- GEN:name --> … <!-- /GEN:name -->` block in the template is replaced with a fresh table;
 * everything else is kept word for word.
 *
 * Where the book goes (never into git): Boss OS stores it behind the passcode (PUT /api/succession,
 * the Worker's existing R2 bucket) and shows it at ☰ More → Succession Book; a text copy goes to
 * her Google Drive (rclone remote `gdrive`, folder Succession: the .md and a Google Doc of the same
 * text, "Succession Book for Scooter", both shared with nobody); a local copy
 * sits beside the template.
 *
 * No model reads or writes any of it: the build is plain code, so no LP or deal text can reach a
 * model route at all (private-data-routing).
 *
 *   npm run vault:run -- npm run succession:build              # build, store, Drive
 *   npm run vault:run -- npm run succession:build -- --dry     # build the local copy only
 *
 * Rule 0: every run prints `OUTPUT <n> books built`; anything less is a NAMED STOP posted to
 * Open Loops (so a stopped monthly rebuild is a row someone sees), exit non-zero.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseRepoCategories } from "../../src/shared/boss/repos/categories.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ORIGIN = process.env.BOSS_ORIGIN ?? "https://boss.sequoiataylor.com";
export const DRIVE_FOLDER = "gdrive:Succession";
export const DRIVE_TARGET = `${DRIVE_FOLDER}/succession-book.md`;
export const DRIVE_DOC_NAME = "Succession Book for Scooter";
export const MAX_BYTES = 900_000;

export class Stop extends Error {
  constructor(code, sentence, exit = 2) { super(`NAMED STOP [${code}] ${sentence}`); this.code = code; this.exit = exit; }
}

// ─── Pure parts (tests/successionBook.test.ts) ───────────────────────────────────────────────

/** A table cell: one line, no pipe. */
const cell = (v) => String(v ?? "").replace(/\s+/g, " ").replace(/\|/g, "/").trim() || "–";

/** The maps speak to her ("your account"); the book speaks to Scooter about her. Quoted text is kept word for word. */
const NOT_VERBS = new Set(["for", "to", "in", "on", "at", "with", "about", "from", "a", "an", "the", "and", "or", "by", "as", "if", "when", "that", "this", "today", "only", "directly", "all", "first", "know", "can", "will", "may", "might", "must", "should", "could", "would", "did", "had"]);
const third = (v) => ({ are: "is", have: "has", were: "was", do: "does", go: "goes" })[v]
  ?? (/(s|sh|ch|x|z)$/.test(v) ? `${v}es` : /[^aeiou]y$/.test(v) ? `${v.slice(0, -1)}ies` : `${v}s`);
function herPlain(t) {
  return t
    .replace(/\b[Yy]ou're\b/g, "Sequoia is").replace(/\b[Yy]ou've\b/g, "Sequoia has").replace(/\b[Yy]ou'll\b/g, "Sequoia will").replace(/\b[Yy]ou'd\b/g, "Sequoia would")
    .replace(/\b(Do|Did|Does|Will|Can|Are|Have) you\b/g, (_m, aux) => `${({ Do: "Does", Are: "Is", Have: "Has" })[aux] ?? aux} Sequoia`)
    .replace(/\b[Yy]ou((?: still| also| already| now| once| first| then)?) ([a-z]+)\b/g, (m, adv, w, off, str) => {
      if (/(Does|Did|Will|Can|Is|Has) Sequoia$/.test(str.slice(0, off).trimEnd())) return m;
      return NOT_VERBS.has(w) || /(ed|s)$/.test(w) ? `Sequoia${adv} ${w}` : `Sequoia${adv} ${third(w)}`;
    })
    .replace(/\bYour\b/g, "Her").replace(/\byour\b/g, "her").replace(/\byours\b/g, "hers").replace(/\bYou\b/g, "Sequoia").replace(/\byou\b/g, "Sequoia");
}
export const herWords = (t) => String(t ?? "").split(/("[^"]*"|“[^”]*”)/).map((part, i) => (i % 2 ? part : herPlain(part))).join("");

export function table(head, rows) {
  if (!rows.length) return "_(none)_";
  return [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");
}

/** Replace each GEN block; a block the template lacks, or one with no filler, is a stop. */
export function fillBlocks(template, blocks) {
  let out = template;
  for (const [name, body] of Object.entries(blocks)) {
    const re = new RegExp(`(<!-- GEN:${name} -->)[\\s\\S]*?(<!-- /GEN:${name} -->)`);
    if (!re.test(out)) throw new Stop("TEMPLATE_BLOCK_MISSING", `The template has no GEN:${name} block, so that part of the book would be stale.`);
    const inline = name === "built";
    out = out.replace(re, (_m, a, b) => (inline ? `${a}${body}${b}` : `${a}\n${body}\n${b}`));
  }
  const left = [...out.matchAll(/<!-- GEN:([a-z-]+) -->/g)].map((m) => m[1]).filter((n) => !(n in blocks));
  if (left.length) throw new Stop("BLOCK_NOT_BUILT", `The template asks for ${left.join(", ")}, which this generator does not build.`);
  return out;
}

/** Where a repo belongs: her categories (the personal brain) first, then the Repos map. */
export function repoCategory(name, cats, mapRow) {
  if (!cats.problem) {
    if ((cats.parked ?? []).includes(name)) return "parked";
    if ((cats.friends ?? []).includes(name)) return "a friend's or client's";
    if ((cats.mine ?? []).includes(name)) return "hers";
    if ((cats.system ?? []).includes(name)) return "support system";
  }
  return mapRow?.category === "mine" ? "hers" : mapRow?.category ?? "not sorted yet";
}

export function reposBlock(live, mapRows, cats) {
  if (cats.problem) throw new Stop("NO_REPO_CATEGORIES", cats.problem);
  const byName = new Map(mapRows.map((r) => [r.repo, r]));
  const rows = live
    .filter((r) => !r.isArchived)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((r) => {
      const m = byName.get(r.name);
      const what = herWords(m?.what ?? r.description ?? "") || "No description yet; ask Claude to read the repo.";
      const whose = m?.business === "brokerage" ? "Brokerage: do not touch" : /\bScooter's\b/.test(m?.what ?? "") ? "yours (Scooter's)" : repoCategory(r.name, cats, m);
      return [`github.com/seq23/${r.name}`, whose, what, r.visibility === "PRIVATE" ? "private" : "public"];
    });
  return `${rows.length} repos, live from GitHub.\n\n${table(["Repo", "Whose", "What it is", "Visibility"], rows)}`;
}

/** The Spry Labs brain's "App Store apps" table (Company section), with an App Store Connect link per app. */
export function appsBlock(spryBody) {
  const body = String(spryBody ?? "");
  const start = body.search(/^\*\*App Store apps\b[^\n]*$/m);
  if (start < 0) throw new Stop("NO_APPS_TABLE", "The spry brain has no \"App Store apps\" table, so the apps could not be listed.");
  const lines = body.slice(start).split("\n").slice(1);
  const rows = [];
  for (const l of lines) {
    const t = l.trim();
    if (!t && !rows.length) continue;
    if (!t.startsWith("|")) break;
    const cells = t.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    if (cells.every((c) => /^:?-+:?$/.test(c)) || /^app$/i.test(cells[0])) continue;
    rows.push(cells);
  }
  if (!rows.length) throw new Stop("NO_APPS_TABLE", "The spry brain's App Store apps table has no rows.");
  return table(["App", "Bundle id", "App Store Connect", "State"], rows.map(([app, bundle, id, state]) => [app, bundle, /^\d+$/.test(id ?? "") ? `https://appstoreconnect.apple.com/apps/${id}` : id, state]));
}

/** Every domain she keeps, its registrar and expiry: renew these, never let one lapse. */
export function domainsBlock(domains, now = new Date()) {
  const soon = new Date(now.getTime() + 60 * 86_400_000).toISOString().slice(0, 10);
  const rows = (domains.rows ?? []).filter((r) => r.tier === "keep" || r.tier === "sunset")
    .sort((a, b) => String(a.expires ?? "9999").localeCompare(String(b.expires ?? "9999")) || a.domain.localeCompare(b.domain))
    .map((r) => [r.domain, r.expires && r.expires <= soon ? `RENEW NOW, before ${r.expires}` : r.tier === "keep" ? "Keep: renew" : "Keep for now: renew unless Claude confirms nothing uses it", r.registrar, r.expires ?? "not known yet", herWords(r.mail_words ?? "")]);
  if (!rows.length) throw new Stop("NO_DOMAINS", "The Domains map has no domain marked keep.");
  return table(["Domain", "Keep or let go", "Registrar (where to renew)", "Paid until", "Email on it"], rows);
}

/** The Social Map's live profiles: status only (the logins are in the hand-written matrix). */
export const SOCIAL_WORDS = { live_auto: "Live, posts automatically", live_manual: "Live, posted by hand", paused: "Off: ask Claude whether on purpose or broken" };
export function socialBlock(social) {
  const label = Object.fromEntries((social.businesses ?? []).map((b) => [b.key, b.label]));
  const rows = (social.rows ?? []).filter((r) => r.status in SOCIAL_WORDS && !/^GitHub/i.test(r.platform ?? ""))
    .map((r) => [label[r.business] ?? r.business, r.platform, r.handle || r.url || "", SOCIAL_WORDS[r.status]]);
  return table(["Business", "Platform", "Handle", "Status"], rows);
}

/** Who an Email Map sender writes to, in the words Day 1 acts on. Order is the table's order. */
export const EMAIL_KINDS = [
  ["brokerage", "Brokerage: stop on Day 1; do not read"],
  ["tap", "Sends as Sequoia when a button is tapped: stop on Day 1; never tap"],
  ["outreach", "Outreach in her name: stop on Day 1"],
  ["customers", "Customers (receipts, sign-ins, replies): leave on"],
  ["friends", "A friend's or client's business: theirs, leave on"],
  ["her", "Sequoia only: harmless, leave on or pause"],
];
const OUTREACH = /\b(prospects?|LPs?|LP list|offices|institutions|communities|brands|introduced|business address|businesses \()\b/i;
export function emailKind(row) {
  const to = String(row.to ?? "");
  if (row.business === "brokerage") return "brokerage";
  if (/send as is|\bgo\?|yes, go|approve and|approved card|her own words sent as/i.test(`${row.what} ${row.pause} ${row.trigger ?? ""}`)) return "tap";
  if (/^(none|no one)/i.test(to)) return null;
  if (/^you\b/i.test(to)) return "her";
  if (row.business === "friends" || /\bValerie\b|studio's owner/.test(to)) return "friends";
  if (OUTREACH.test(to)) return "outreach";
  return "customers";
}

/**
 * How to stop an email, as a sentence Scooter can follow: never the raw command (Claude finds it in
 * the Email Map by its id). A switch that is not an action ("already off", "do not tap Send") is said as is.
 */
export function stopWords(row) {
  const p = String(row.pause ?? "").trim();
  if (!p || /^(–|-|none)$/i.test(p)) return "Nothing to do.";
  if (/^(tap|do not|don't|already|nothing|leave|it stops|stops|pausing|it is|retired)/i.test(p)) return herWords(p);
  const receipts = /RESEND_API_KEY|resend/i.test(p) ? " (this also stops customers' receipts)" : "";
  return `Ask Claude: "Stop the Email Map sender ${row.id}."${receipts}`;
}

/** Every automatic email, from the Email Map, grouped by who it writes to, with how to stop it. */
export function emailsBlock(emailMap) {
  const label = Object.fromEntries((emailMap.businesses ?? []).map((b) => [b.key, b.label]));
  const rows = (emailMap.rows ?? []).map((r) => ({ r, kind: emailKind(r) })).filter((x) => x.kind);
  if (!rows.length) throw new Stop("NO_EMAIL_MAP", "The Email Map has no senders, so the emails could not be listed.");
  const order = Object.fromEntries(EMAIL_KINDS.map(([k], i) => [k, i]));
  const words = Object.fromEntries(EMAIL_KINDS);
  rows.sort((a, b) => order[a.kind] - order[b.kind] || String(a.r.business).localeCompare(String(b.r.business)));
  return `${rows.length} automatic emails, from Boss OS › Email Map.\n\n${table(["Who it writes to", "Business", "What it is", "Sent to", "How to stop it"], rows.map(({ r, kind }) => [
    words[kind], label[r.business] ?? r.business, herWords(r.what), herWords(r.to), stopWords(r),
  ]))}`;
}

/** Every account a job posts to by itself, from the Social Map. Posts speak for the brand, not for her. */
export function postingBlock(social) {
  const label = Object.fromEntries((social.businesses ?? []).map((b) => [b.key, b.label]));
  const rows = (social.rows ?? []).filter((r) => r.status === "live_auto" && r.posts?.by === "job" && !/^GitHub/i.test(r.platform ?? ""))
    .map((r) => [label[r.business] ?? r.business, r.platform, herWords(r.posts.what), `Ask Claude: "Pause the job that posts to ${r.platform} for ${label[r.business] ?? r.business}."`]);
  return `${rows.length} accounts post automatically (brand posts, never personal messages).\n\n${table(["Business", "Platform", "What posts", "How to stop it"], rows)}`;
}

/** Every "[Sequoia fills …]" and "[Sequoia confirms …]" in the built book, with its section, so none is missed. */
export function gapsBlock(md) {
  const rows = [];
  let sectionName = "Top of the book";
  let sub = "";
  let header = null;
  for (const line of String(md).split("\n")) {
    if (!line.trim().startsWith("|")) header = null;
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) { sectionName = h2[1].trim(); sub = ""; continue; }
    const h3 = /^###\s+(.+)$/.exec(line);
    if (h3) { sub = h3[1].trim(); continue; }
    const isRow = line.trim().startsWith("|");
    if (isRow && /^\|[\s|:-]+\|$/.test(line.trim())) continue;
    const cells = isRow ? line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim().replace(/\*\*/g, "")) : null;
    if (isRow && !header) { header = cells; continue; }
    for (const m of line.matchAll(/\[Sequoia (fills|confirms)([^\]]*)\]/g)) {
      if (line[(m.index ?? 0) - 1] === '"') continue; // the marker named in a sentence, not a blank
      const inside = m[2].replace(/^[:,\s]+/, "").trim();
      let where;
      if (cells) {
        const col = cells.findIndex((c) => c.includes(m[0].replace(/\*\*/g, "")));
        const name = cells[0].replace(m[0], "").trim() || "row";
        const platform = /platform/i.test(header?.[1] ?? "") ? ` ${cells[1]}` : "";
        where = `${name}${platform} › ${header?.[col] ?? "a cell"}`;
      } else {
        const at = m.index ?? 0;
        const prev = line.lastIndexOf(". ", at);
        const start = prev < 0 ? 0 : prev + 2;
        const end = line.indexOf(". ", at);
        where = line.slice(start, end < 0 ? undefined : end + 1).replace(m[0], "…").replace(/\*\*/g, "").replace(/^[\s\-\d.]+/, "").trim();
        if (where.length > 160) where = `${where.slice(0, 160).replace(/\s+\S*$/, "")} …`;
        where = where.replace(/\.$/, "");
      }
      rows.push([sub ? `${sectionName} › ${sub}` : sectionName, m[1] === "fills" ? "Fill in" : "Confirm", inside ? `${where}: ${inside}` : where]);
    }
  }
  return rows.length ? `${rows.length} blanks.\n\n${table(["Where", "Do", "What"], rows)}` : "None: every blank is filled.";
}

/** Things that must never be in the book. Returns problems (empty = safe). */
export function safetyProblems(md) {
  const p = [];
  if (/\b\d{2}-\d{7}\b/.test(md)) p.push("a number shaped like an EIN");
  if (/<!--\s*confidential/i.test(md)) p.push("a private brain span");
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{20,}|\bghp_[A-Za-z0-9]{20,}|\bre_[A-Za-z0-9]{20,}/.test(md)) p.push("something shaped like a key");
  // A value after "password:" that looks like a secret (has a digit or symbol), not words such as "sealed envelope".
  if (/\b(password|passcode|passphrase)\s*[:=]\s*[^\s|]*[0-9!@#$%^&*_+=~][^\s|]*/i.test(md)) p.push("a password written out");
  if (Buffer.byteLength(md) > MAX_BYTES) p.push(`over ${MAX_BYTES} bytes`);
  return p;
}

export function buildBook({ template, live, mapRows, cats, domains, social, emailMap, spryBody, now = new Date() }) {
  if (!String(template ?? "").trim()) throw new Stop("NO_TEMPLATE", "The template is empty.");
  if (!live.length) throw new Stop("NO_REPOS", "`gh repo list seq23` returned no repos.");
  const firstPass = fillBlocks(template, {
    apps: appsBlock(spryBody),
    repos: reposBlock(live, mapRows, cats),
    domains: domainsBlock(domains, now),
    social: socialBlock(social),
    emails: emailsBlock(emailMap),
    posting: postingBlock(social),
    built: now.toISOString().slice(0, 10),
    gaps: "",
  });
  const md = firstPass.replace(/(<!-- GEN:gaps -->)[\s\S]*?(<!-- \/GEN:gaps -->)/, (_m, a, b) => `${a}\n${gapsBlock(firstPass)}\n${b}`);
  const problems = safetyProblems(md);
  if (problems.length) throw new Stop("UNSAFE_CONTENT", `The built book holds ${problems.join(", ")}; nothing was stored.`);
  return md;
}

// ─── The Drive copy: a Google Doc, so it reads on a phone (Drive shows a .md as raw text) ───

const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function inlineHtml(t) {
  return esc(t)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s)<]+[^\s)<.,;:])/g, '$1<a href="$2">$2</a>');
}
export function mdToHtml(md, title) {
  const lines = String(md).replace(/<!--[\s\S]*?-->/g, "").split("\n");
  const out = [`<html><head><meta charset="utf-8"><title>${esc(title)}</title></head><body>`];
  const LIST = /^(\s*)([-*]|\d+[.)])\s+/;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { out.push(`<h${h[1].length}>${inlineHtml(h[2])}</h${h[1].length}>`); i++; continue; }
    if (line.startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = lines[i].trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells);
        i++;
      }
      out.push(`<table border="1" cellpadding="4">${rows.map((r, n) => `<tr>${r.map((c) => (n ? `<td>${inlineHtml(c)}</td>` : `<th>${inlineHtml(c)}</th>`)).join("")}</tr>`).join("")}</table>`);
      continue;
    }
    if (LIST.test(lines[i])) {
      const stack = [];
      while (i < lines.length && LIST.test(lines[i])) {
        const m = LIST.exec(lines[i]);
        const depth = Math.floor(m[1].length / 2);
        const tag = /\d/.test(m[2]) ? "ol" : "ul";
        while (stack.length > depth + 1) out.push(`</${stack.pop()}>`);
        if (stack.length === depth + 1 && stack[depth] !== tag) out.push(`</${stack.pop()}>`);
        while (stack.length < depth + 1) { out.push(`<${tag}>`); stack.push(tag); }
        out.push(`<li>${inlineHtml(lines[i].slice(m[0].length))}</li>`);
        i++;
      }
      while (stack.length) out.push(`</${stack.pop()}>`);
      continue;
    }
    out.push(`<p>${inlineHtml(line)}</p>`);
    i++;
  }
  out.push("</body></html>");
  return out.join("\n");
}

// ─── The run ────────────────────────────────────────────────────────────────────────────────

async function session(passcode, fetchImpl) {
  if (!passcode) throw new Stop("NO_PASSCODE", "BOSS_PASSCODE is not set; run through the vault (npm run vault:run -- …).", 3);
  const u = await fetchImpl(`${ORIGIN}/api/boss/auth/unlock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode }) });
  if (!u.ok) throw new Stop("UNLOCK_REFUSED", `Boss OS refused the passcode (${u.status}).`, 3);
  const cookie = (u.headers.get("set-cookie") ?? "").split(";")[0];
  return {
    get: async (p) => { const r = await fetchImpl(`${ORIGIN}/api/boss${p}`, { headers: { cookie } }); if (!r.ok) throw new Error(`${p} answered ${r.status}`); return (await r.json()).data; },
    put: async (p, body) => { const r = await fetchImpl(`${ORIGIN}/api/boss${p}`, { method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`${p} answered ${r.status}: ${(await r.text()).slice(0, 200)}`); return (await r.json()).data; },
    post: async (p, body) => { const r = await fetchImpl(`${ORIGIN}/api/boss${p}`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) }); return r.ok; },
  };
}

const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));

export async function run({ argv = process.argv.slice(2), env = process.env, fetchImpl = fetch, home = homedir(), exec = execFileSync } = {}) {
  const dry = argv.includes("--dry");
  const templatePath = env.SUCCESSION_TEMPLATE ?? join(home, "Work", "succession", "book.template.md");
  if (!existsSync(templatePath)) throw new Stop("NO_TEMPLATE", `${templatePath.replace(home, "~")} is not on this Mac.`);
  const api = await session(env.BOSS_PASSCODE, fetchImpl);
  const personal = await api.get("/brains/personal").catch(() => null);
  const spry = await api.get("/brains/spry").catch(() => null);
  const cats = personal?.body_md ? parseRepoCategories(personal.body_md) : { problem: "the personal brain was not returned, so her repo categories could not be read" };
  const live = JSON.parse(exec("gh", ["repo", "list", "seq23", "--limit", "300", "--json", "name,visibility,isArchived,description"], { encoding: "utf8" }));
  const md = buildBook({
    template: readFileSync(templatePath, "utf8"),
    live,
    mapRows: readJson("src/shared/boss/maps/repos.json").rows ?? [],
    cats,
    domains: readJson("src/shared/boss/maps/domains.json"),
    social: readJson("src/shared/boss/socialMap/manifest.json"),
    emailMap: readJson("src/shared/boss/emailMap/manifest.json"),
    spryBody: spry?.body_md,
  });
  const local = join(dirname(templatePath), "book.md");
  mkdirSync(dirname(local), { recursive: true });
  writeFileSync(`${local}.tmp`, md, { mode: 0o600 });
  renameSync(`${local}.tmp`, local);
  if (dry) { console.log(`OUTPUT 0 books built (dry run: ${Buffer.byteLength(md)} bytes in ${local.replace(home, "~")}, not stored)`); return { md, stored: false }; }
  try { await api.put("/succession", { markdown: md, built_at: new Date().toISOString() }); }
  catch (e) { throw Object.assign(new Stop("STORE_FAILED", `Boss OS did not store the book (${e.message}).`), { api }); }
  const docHtml = join(dirname(templatePath), `${DRIVE_DOC_NAME}.html`);
  writeFileSync(docHtml, mdToHtml(md, DRIVE_DOC_NAME), { mode: 0o600 });
  try {
    exec("rclone", ["copyto", local, DRIVE_TARGET], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    // Imported as a Google Doc; the same name updates the same Doc in place each month.
    exec("rclone", ["copyto", docHtml, `${DRIVE_FOLDER}/${DRIVE_DOC_NAME}.html`, "--drive-import-formats", "html", "--drive-export-formats", "html"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  }
  catch (e) { throw Object.assign(new Stop("DRIVE_FAILED", `The book is in Boss OS but the Drive copy failed (${String(e.stderr ?? e.message).slice(0, 200)}).`), { api }); }
  await api.post("/open-loops/intake", { repo: "seq23/boss-os", stop: "SUCCESSION_BOOK", cleared: true }).catch(() => false);
  console.log(`OUTPUT 1 books built (${Buffer.byteLength(md)} bytes; Boss OS, the Drive Doc and ${DRIVE_TARGET}, ${local.replace(home, "~")})`);
  return { md, stored: true };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run().catch(async (e) => {
    console.error(e.message);
    console.log("OUTPUT 0 books built");
    // A stopped rebuild is a row someone sees, owned by Claude, never a quiet log line.
    try {
      const api = e.api ?? (await session(process.env.BOSS_PASSCODE, fetch));
      await api.post("/open-loops/intake", {
        repo: "seq23/boss-os", stop: "SUCCESSION_BOOK", owner: "claude", business: "personal",
        title: "The Succession Book rebuild stopped",
        finish_line: "The monthly Succession Book is rebuilt and stored in Boss OS and Drive",
        next_step: `Read ~/Library/Logs/boss-succession/ and fix: ${String(e.message).slice(0, 300)}`,
      });
    } catch { /* the log line above is all that is left */ }
    process.exit(e.exit ?? 1);
  });
}
