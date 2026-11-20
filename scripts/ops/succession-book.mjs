#!/usr/bin/env node
/**
 * THE SUCCESSION BOOK (owner ruling 19 Nov 2026, personal brain, Settled decisions "SUCCESSION PLAN, $0").
 *
 * Builds ONE markdown book for Scooter from:
 *   - her hand-written template, kept on her Mac only (~/Work/succession/book.template.md by default;
 *     SUCCESSION_TEMPLATE overrides). It holds her own words and the "[Sequoia fills]" answers, so it is
 *     never in this public repo;
 *   - the brains (Boss OS brain API), her repo categories (the personal brain), ~/HANDOFF.md PINNED,
 *     the live `gh repo list seq23`, and this repo's Accounts and Social maps.
 * Each `<!-- GEN:name --> … <!-- /GEN:name -->` block in the template is replaced with a fresh table;
 * everything else is kept word for word.
 *
 * Where the book goes (never into git): Boss OS stores it behind the passcode (PUT /api/succession,
 * the Worker's existing R2 bucket) and shows it at ☰ More → Succession Book; a text copy goes to
 * her Google Drive (rclone remote `gdrive`, folder Succession, shared with nobody); a local copy
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
export const DRIVE_TARGET = "gdrive:Succession/succession-book.md";
export const MAX_BYTES = 900_000;

export class Stop extends Error {
  constructor(code, sentence, exit = 2) { super(`NAMED STOP [${code}] ${sentence}`); this.code = code; this.exit = exit; }
}

// ─── Pure parts (tests/successionBook.test.ts) ───────────────────────────────────────────────

/** Remove every private span; an unclosed one removes the rest of the text (fail closed). */
export function stripConfidential(text) {
  return String(text ?? "")
    .replace(/<!--\s*confidential\s*-->[\s\S]*?<!--\s*\/\s*confidential\s*-->/gi, "")
    .replace(/<!--\s*confidential\s*-->[\s\S]*$/i, "");
}

/** A table cell: one line, no pipe. */
const cell = (v) => String(v ?? "").replace(/\s+/g, " ").replace(/\|/g, "/").trim() || "–";

/** The maps speak to her ("your account"); the book speaks to Scooter about her. */
export const herWords = (t) => String(t ?? "").replace(/\bYour\b/g, "Sequoia's").replace(/\byour\b/g, "her").replace(/\bYou\b/g, "Sequoia").replace(/\byou\b/g, "Sequoia");

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

/** The section under `## <name>` (to the next `## `), or "". */
export function section(md, name) {
  const re = new RegExp(`^##\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m");
  const m = re.exec(md);
  if (!m) return "";
  const rest = md.slice(m.index + m[0].length);
  const end = rest.search(/^##\s/m);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

/** HANDOFF.md PINNED: the backup map and the "if the Mac dies" steps, word for word. */
export function handoffBackups(handoff) {
  const m = /^### Backups[^\n]*\n([\s\S]*?)(?=^### |^## |^---)/m.exec(String(handoff ?? ""));
  if (!m) throw new Stop("HANDOFF_BACKUPS_MISSING", "~/HANDOFF.md has no PINNED \"### Backups\" section, so the restore steps could not be copied.");
  return m[1].trim();
}

/** A brain's Company facts: its top-level bullets, private parts removed, at most `max`. */
export function companyFacts(body, max = 8) {
  const company = stripConfidential(section(body, "Company"));
  return company.split("\n").filter((l) => /^- /.test(l) && !/\[MISSING\]/.test(l)).slice(0, max).map((l) => l.length > 600 ? `${l.slice(0, 597)}…` : l);
}

export function brainsBlock(brains) {
  const parts = [];
  for (const b of brains) {
    const facts = companyFacts(b.body_md);
    if (!facts.length) continue;
    parts.push(`**${b.title ?? b.slug}** (brain \`${b.slug}\`)\n\n${facts.join("\n")}`);
  }
  return parts.join("\n\n");
}

export function reposBlock(live, mapRows) {
  const byName = new Map(mapRows.map((r) => [r.repo, r]));
  const rows = live
    .filter((r) => !r.isArchived)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((r) => {
      const m = byName.get(r.name);
      return [`github.com/seq23/${r.name}`, r.visibility === "PRIVATE" ? "private" : "public", m?.category ?? "not in the Repos map", herWords(m?.what ?? r.description ?? ""), String(r.pushedAt ?? "").slice(0, 10)];
    });
  return table(["Repo", "Visibility", "Category", "What it is", "Last change"], rows);
}

export function categoriesBlock(cats) {
  if (cats.problem) throw new Stop("NO_REPO_CATEGORIES", cats.problem);
  const groups = [["Hers", cats.mine], ["Friends and clients", cats.friends], ["Parked", cats.parked], ["Support and system", cats.system]];
  return table(["Group", "Repos"], groups.filter(([, v]) => Array.isArray(v) && v.length).map(([k, v]) => [k, v.join(", ")]));
}

export function accountsBlock(accounts) {
  const rows = (accounts.rows ?? []).map((r) => [r.service, herWords(accounts.owners?.[r.owner] ?? r.owner), r.login ?? "not known yet", r.business, herWords(r.used_by)]);
  return table(["Service", "Whose login", "Login (shortened)", "Business", "Used for"], rows);
}

export function socialBlock(social) {
  const statuses = social.statuses ?? {};
  const rows = (social.rows ?? []).filter((r) => r.status !== "dead" && r.status !== "never")
    .map((r) => [r.business, r.platform, r.handle || r.url || "", statuses[r.status] ?? r.status, r.account_email ?? ""]);
  return table(["Business", "Platform", "Handle", "Status", "Login (shortened)"], rows);
}

/** Things that must never be in the book. Returns problems (empty = safe). */
export function safetyProblems(md) {
  const p = [];
  if (/\b\d{2}-\d{7}\b/.test(md)) p.push("a number shaped like an EIN");
  if (/<!--\s*confidential/i.test(md)) p.push("a private brain span");
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{20,}|\bghp_[A-Za-z0-9]{20,}|\bre_[A-Za-z0-9]{20,}/.test(md)) p.push("something shaped like a key");
  if (/\bpassword\s*[:=]\s*\S/i.test(md)) p.push("a password written out");
  if (Buffer.byteLength(md) > MAX_BYTES) p.push(`over ${MAX_BYTES} bytes`);
  return p;
}

export function buildBook({ template, brains, live, mapRows, cats, accounts, social, handoff, now = new Date() }) {
  if (!String(template ?? "").trim()) throw new Stop("NO_TEMPLATE", "The template is empty.");
  if (!brains.length) throw new Stop("NO_BRAINS", "Boss OS returned no brains, so the business facts could not be written.");
  if (!live.length) throw new Stop("NO_REPOS", "`gh repo list seq23` returned no repos.");
  const md = fillBlocks(template, {
    repos: reposBlock(live, mapRows),
    categories: categoriesBlock(cats),
    brains: brainsBlock(brains),
    accounts: accountsBlock(accounts),
    social: socialBlock(social),
    handoff: handoffBackups(handoff),
    built: now.toISOString().slice(0, 10),
  });
  const problems = safetyProblems(md);
  if (problems.length) throw new Stop("UNSAFE_CONTENT", `The built book holds ${problems.join(", ")}; nothing was stored.`);
  return md;
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
  const list = (await api.get("/brains"))?.brains ?? [];
  const brains = [];
  for (const b of list) brains.push(await api.get(`/brains/${encodeURIComponent(b.slug)}`).then((full) => ({ ...b, ...full })));
  const personal = brains.find((b) => b.slug === "personal");
  const cats = personal ? parseRepoCategories(personal.body_md) : { problem: "the personal brain was not returned" };
  const live = JSON.parse(exec("gh", ["repo", "list", "seq23", "--limit", "300", "--json", "name,visibility,isArchived,pushedAt,description"], { encoding: "utf8" }));
  const md = buildBook({
    template: readFileSync(templatePath, "utf8"),
    brains,
    live,
    mapRows: readJson("src/shared/boss/maps/repos.json").rows ?? [],
    cats,
    accounts: readJson("src/shared/boss/maps/accounts.json"),
    social: readJson("src/shared/boss/socialMap/manifest.json"),
    handoff: readFileSync(join(home, "HANDOFF.md"), "utf8"),
  });
  const local = join(dirname(templatePath), "book.md");
  mkdirSync(dirname(local), { recursive: true });
  writeFileSync(`${local}.tmp`, md, { mode: 0o600 });
  renameSync(`${local}.tmp`, local);
  if (dry) { console.log(`OUTPUT 0 books built (dry run: ${Buffer.byteLength(md)} bytes in ${local.replace(home, "~")}, not stored)`); return { md, stored: false }; }
  try { await api.put("/succession", { markdown: md, built_at: new Date().toISOString() }); }
  catch (e) { throw Object.assign(new Stop("STORE_FAILED", `Boss OS did not store the book (${e.message}).`), { api }); }
  try { exec("rclone", ["copyto", local, DRIVE_TARGET], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { throw Object.assign(new Stop("DRIVE_FAILED", `The book is in Boss OS but the Drive copy failed (${String(e.stderr ?? e.message).slice(0, 200)}).`), { api }); }
  await api.post("/open-loops/intake", { repo: "seq23/boss-os", stop: "SUCCESSION_BOOK", cleared: true }).catch(() => false);
  console.log(`OUTPUT 1 books built (${Buffer.byteLength(md)} bytes; Boss OS, ${DRIVE_TARGET}, ${local.replace(home, "~")})`);
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
