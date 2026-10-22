#!/usr/bin/env node
/**
 * ZORA'S GALLERY INPUT, WRITTEN WITHOUT A CHAT SESSION (22 Oct 2026).
 *
 * `archive-audit.mjs` reads `~/.boss-os/archive/gallery.json`, and nothing wrote it: the artifact
 * gallery lives on claude.ai and a headless `claude -p` on this Mac has no Artifact tool (CONFIRMED
 * 22 Oct 2026). So her Friday audit could only ever report "could not read" — a duty that runs and
 * reads nothing.
 *
 * This builds the export from what IS on this Mac: every claude.ai artifact link written down in
 *   1. ~/HANDOFF.md (§4 pinned pages and the other pages it lists),
 *   2. the repos' docs (a repo copy's line 1 names its source page: `boss-os/docs/SIDE_BUSINESS_REVIEW.md`),
 *   3. the memory notes (~/.claude/projects/<home>/memory/*.md),
 * each with the title written beside it and the date its source file last changed. A page nobody
 * wrote down anywhere is not findable by anybody, so it is not on the list either — and Zora's audit
 * files the rest.
 *
 * RULE 0: zero links found is a failure (exit 3), never an empty export. `open_loops` is carried
 * over from a mirror a session with the Artifact tool leaves (`open-loops.json`), and is null — a
 * named stop in the audit — when there is none.
 *
 *   node scripts/ops/gallery-export.mjs          # write the export, print the count
 *   node scripts/ops/gallery-export.mjs --print  # print it, write nothing
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const HOME = homedir();
export const GALLERY_EXPORT_PATH = process.env.BOSS_GALLERY_EXPORT ?? join(HOME, ".boss-os", "archive", "gallery.json");
export const OPEN_LOOPS_MIRROR = join(dirname(GALLERY_EXPORT_PATH), "open-loops.json");
export const ARTIFACT_URL_RE = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9-]{8,}/g;

/** The files to read, in order of authority: HANDOFF first, then repo docs, then memory. */
export function gallerySources(home = HOME) {
  const out = [];
  const handoff = join(home, "HANDOFF.md");
  if (existsSync(handoff)) out.push(handoff);
  const gh = join(home, "GitHub");
  if (existsSync(gh)) {
    for (const repo of readdirSync(gh)) {
      if (repo.includes("-wt-") || repo.startsWith(".")) continue;
      const docs = join(gh, repo, "docs");
      if (!existsSync(docs)) continue;
      const walk = (d, depth) => {
        if (depth > 2) return;
        for (const f of readdirSync(d, { withFileTypes: true })) {
          const p = join(d, f.name);
          if (f.isDirectory()) walk(p, depth + 1);
          else if (f.name.endsWith(".md")) out.push(p);
        }
      };
      try { walk(docs, 0); } catch { /* unreadable docs dir: skipped, the other sources still count */ }
    }
  }
  const mem = join(home, ".claude", "projects", home.replace(/\//g, "-"), "memory");
  if (existsSync(mem)) for (const f of readdirSync(mem)) if (f.endsWith(".md")) out.push(join(mem, f));
  return out;
}

const clean = (s) => String(s ?? "").replace(/\*\*|__|`/g, "").replace(/^[\s|:\-–—•*#>]+|[\s|:\-–—(]+$/g, "").replace(/\s+/g, " ").trim();

/** The title written beside a link on one line, or null. Pure. */
export function titleBeside(line, url) {
  const md = new RegExp(`\\[([^\\]]{3,120})\\]\\(${url.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`).exec(line);
  if (md) return clean(md[1]);
  if (/^\s*\|/.test(line)) {
    const first = clean(line.split("|")[1]);
    if (first && !first.includes("claude.ai")) return first;
  }
  const before = clean(line.slice(0, line.indexOf(url)).replace(/^.*?[-*•]\s+/, "").replace(/\b(?:at|here|page|link|see)\s*$/i, ""));
  if (before.length >= 3 && before.length <= 120) return before;
  return null;
}

/** The title a whole file gives: frontmatter `name`, else its first heading. */
function fileTitle(text) {
  const fm = /^---\n[\s\S]*?\nname:\s*(.+)\n/.exec(text);
  if (fm) return clean(fm[1]);
  const h = /^#\s+(.+)$/m.exec(text);
  return h ? clean(h[1]) : null;
}

/** Every artifact link in the given files, deduplicated by URL, first (most authoritative) title wins. Pure over its reader. */
export function collectArtifacts(files, read = (p) => readFileSync(p, "utf8"), mtime = (p) => statSync(p).mtime) {
  const byUrl = new Map();
  for (const file of files) {
    let text;
    try { text = read(file); } catch { continue; }
    const whole = fileTitle(text);
    for (const line of text.split(/\r?\n/)) {
      for (const url of line.match(ARTIFACT_URL_RE) ?? []) {
        if (byUrl.has(url)) continue;
        const title = titleBeside(line, url) ?? whole;
        if (!title) continue;
        byUrl.set(url, { title: title.slice(0, 200), url, updated: new Date(mtime(file)).toISOString().slice(0, 10), source: file.replace(HOME, "~") });
      }
    }
  }
  return [...byUrl.values()];
}

/** Build and (unless printing) write the export. Returns { ok, count, why?, export }. */
export function writeGalleryExport({ print = false, home = HOME, now = new Date() } = {}) {
  const artifacts = collectArtifacts(gallerySources(home));
  if (artifacts.length === 0) return { ok: false, count: 0, why: "no claude.ai artifact link was found in ~/HANDOFF.md, the repos' docs or the memory notes" };
  let loops = null;
  // The mirror carries its own date; one older than a week is not this week's loops, whatever this export's date says.
  try {
    if (existsSync(OPEN_LOOPS_MIRROR)) {
      const m = JSON.parse(readFileSync(OPEN_LOOPS_MIRROR, "utf8"));
      if (now.getTime() - Date.parse(m.exported_at ?? "") <= 8 * 86_400_000) loops = m.open_loops ?? null;
    }
  } catch { loops = null; }
  const out = { exported_at: now.toISOString(), source: "gallery-export.mjs: HANDOFF + repo docs + memory", artifacts, open_loops: Array.isArray(loops) ? loops : null };
  if (!print) {
    mkdirSync(dirname(GALLERY_EXPORT_PATH), { recursive: true });
    writeFileSync(GALLERY_EXPORT_PATH, JSON.stringify(out, null, 2) + "\n");
  }
  return { ok: true, count: artifacts.length, export: out };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const print = process.argv.includes("--print");
  const r = writeGalleryExport({ print });
  if (!r.ok) { console.error(`NAMED STOP [GALLERY_READ_NOTHING] ${r.why}`); process.exit(3); }
  if (print) console.log(JSON.stringify(r.export, null, 2));
  console.log(`GALLERY-EXPORT-COMPLETE: ${r.count} page(s)${print ? " (printed, not written)" : ` → ${GALLERY_EXPORT_PATH}`}`);
}
