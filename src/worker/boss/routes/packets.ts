/**
 * One page, one link, every meeting agenda — newest first.
 *
 * ─── Her words ─────────────────────────────────────────────────────────────
 *
 *   "id rather have a download link to the packet"
 *   "or at least an artifact in the web page that seems to be more space efficient"
 *   "u can have several meetings in one scrollable page"
 *   "i dont need a real page in boss OS that is stupid"
 *
 * So this is not a client screen. It is a page the Worker renders, at a URL that never changes, that
 * she bookmarks once and opens on a phone on the way into the meeting. Today carries a compact
 * pointer — the meeting, the date, the blocking headline — and this holds the documents.
 *
 * ─── Why the Worker renders it rather than claude.ai ───────────────────────
 *
 * The proposal was to publish an Artifact from her Mac, the way Simone's watcher runs `claude -p`.
 * Tested headlessly on 9 September: a headless session HAS NO ARTIFACT TOOL — "The Artifact tool is
 * not available in my current tool set". Building on it would have shipped a weekly job that
 * silently never published, which is this system's signature defect done on purpose.
 *
 * ─── What may cross, enforced rather than promised ─────────────────────────
 *
 * The packet's markdown reaches the Worker, which is a deliberate, named relaxation of "Boss OS
 * holds no LP data" — see 0210. What crosses is aggregate counts and agenda items already stored
 * here. `POST /` REFUSES THE WHOLE DOCUMENT if it contains an address that is not one of hers.
 * Whole, not the offending line: a partially-stored packet reports success on a leaking run.
 *
 * ─── A missing packet says so ──────────────────────────────────────────────
 *
 * Her rule from this morning: the screen never shows an empty section for something that exists. A
 * Wednesday with no packet renders as a Wednesday with no packet and the reason, never as an absence.
 */

import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { ok, badRequest, notFound } from "../lib/http";

export const packets = new Hono<{ Bindings: Env; Variables: Vars }>();

/**
 * The only addresses a packet may contain.
 *
 * HERS, AND NOTHING ELSE. The West Peek sending address is in the grant steps and has to be —
 * telling Scooter to authorise a mailbox without naming it is not an instruction. Everything else
 * with an `@` in it is a counterparty, and the whole document is refused rather than edited.
 */
const HER_ADDRESSES = [
  "sequoia@westpeek.ventures",
  "staylor@spry.vc",
  "seq.taylor@gmail.com",
];

/** Every `@`-bearing token in the text that is not one of hers. */
export function foreignAddresses(markdown: string): string[] {
  const found = markdown.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  return [...new Set(found.map((a) => a.toLowerCase()))].filter((a) => !HER_ADDRESSES.includes(a));
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Markdown to HTML, for the six things a packet actually contains.
 *
 * DELIBERATELY NOT A MARKDOWN LIBRARY. Headings, paragraphs, lists, blockquotes, bold, inline code
 * and horizontal rules cover every packet this generator has ever produced, and a dependency here
 * would be a parser running over a document on the one page she reads under time pressure. Anything
 * it does not understand renders as its own text rather than disappearing — an unrecognised line is
 * shown, never dropped.
 */
export function renderMarkdown(md: string): string {
  const inline = (t: string) =>
    esc(t)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/(^|\s)_([^_]+)_/g, "$1<em>$2</em>");

  const out: string[] = [];
  let list: string[] = [];
  let quote: string[] = [];
  const flush = () => {
    if (list.length) { out.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join("")}</ul>`); list = []; }
    if (quote.length) { out.push(`<pre>${esc(quote.join("\n"))}</pre>`); quote = []; }
  };

  for (const raw of md.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (/^>\s?/.test(line)) { if (list.length) flush(); quote.push(line.replace(/^>\s?/, "")); continue; }
    if (quote.length) flush();

    if (/^\s*[-*]\s+/.test(line)) { list.push(line.replace(/^\s*[-*]\s+/, "")); continue; }
    if (list.length) flush();

    if (!line.trim()) continue;
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { const n = h[1]!.length + 1; out.push(`<h${n}>${inline(h[2]!)}</h${n}>`); continue; }
    if (/^---+$/.test(line)) { out.push("<hr>"); continue; }
    out.push(`<p>${inline(line)}</p>`);
  }
  flush();
  return out.join("\n");
}

const PAGE_CSS = `
:root { color-scheme: light dark; --ink:#141414; --muted:#5b5b5b; --line:#d9d5cc; --bg:#faf8f4; --card:#fff; --gold:#8a6b1f; --alarm:#8f2f2f; }
@media (prefers-color-scheme: dark) {
  :root { --ink:#ece8e0; --muted:#a09a90; --line:#3a3730; --bg:#151412; --card:#1e1c19; --gold:#d3ae57; --alarm:#e08b8b; }
}
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
main { max-width: 46rem; margin: 0 auto; padding: 28px 18px 80px; }
h1 { font-size: 22px; letter-spacing:-.01em; margin:0 0 4px; }
.sub { color:var(--muted); font-size:13px; margin:0 0 26px; }
article { background:var(--card); border:1px solid var(--line); border-radius:4px; padding:18px 18px 8px; margin-bottom:18px; }
article h2 { font-size:18px; margin:0 0 2px; }
article h3 { font-size:15px; margin:20px 0 4px; }
article h4, article h5 { font-size:14px; margin:16px 0 4px; }
article p { margin:0 0 10px; }
article ul { margin:0 0 12px; padding-left:20px; }
pre { background:var(--bg); border:1px solid var(--line); border-left:3px solid var(--gold); border-radius:2px; padding:12px 14px; overflow-x:auto; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space:pre-wrap; word-break:break-word; }
code { font: .9em ui-monospace, SFMono-Regular, Menlo, monospace; background:var(--bg); padding:1px 4px; border-radius:2px; }
.meta { font: 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); }
.blocking { color:var(--alarm); font-weight:600; }
.dl { display:inline-block; margin:6px 0 14px; font-size:13px; color:var(--gold); }
.absent { border-style:dashed; color:var(--muted); }
`;

/** The page. One URL, every agenda, newest first. */
packets.get("/page", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT id, counterpart, day_id, markdown, headline, blocking, published_at, source
         FROM meeting_packets ORDER BY day_id DESC, published_at DESC LIMIT 60`,
    )
    .all<any>();
  const list = rows.results ?? [];

  const body = list.length
    ? list
        .map(
          (p) =>
            `<article>` +
            `<div class="meta">${esc(p.day_id)} · ${esc(p.counterpart)} · filed ${new Date(p.published_at).toISOString().slice(0, 10)}${p.source === "manual" ? " · by hand" : ""}</div>` +
            (p.blocking ? `<p class="blocking">BLOCKING — ${esc(p.headline ?? "")}</p>` : "") +
            `<a class="dl" href="/api/boss/packets/${esc(p.id)}/download" download>Download this packet (.md)</a>` +
            renderMarkdown(p.markdown) +
            `</article>`,
        )
        .join("\n")
    : /*
       * RULE 0, ON A PAGE. An empty page and a page whose writer has stopped running look identical,
       * and only one of them means she has no meetings. Said rather than left blank.
       */
      `<article class="absent"><h2>No packet has ever been filed here.</h2>` +
      `<p>The Wednesday job writes one to your Mac at 07:00 and posts it here. If this is empty on a ` +
      `Wednesday afternoon, the job did not run or could not reach Boss OS — that is a broken job, not a quiet week. ` +
      `Run <code>npm run packet:remind -- --force</code>.</p></article>`;

  return c.html(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>Meeting agendas — Boss OS</title><style>${PAGE_CSS}</style></head><body><main>` +
      `<h1>Meeting agendas</h1>` +
      `<p class="sub">Every packet, newest first. This link never changes — bookmark it.</p>` +
      body +
      `</main></body></html>`,
  );
});

/** The raw document, for keeping or forwarding. */
packets.get("/:id/download", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB
    .prepare(`SELECT counterpart, day_id, markdown FROM meeting_packets WHERE id = ?`)
    .bind(id).first<{ counterpart: string; day_id: string; markdown: string }>();
  if (!row) throw notFound("No packet with that id");
  return new Response(row.markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${row.day_id}-${row.counterpart}.md"`,
    },
  });
});

/** What is on the page right now, for Today's compact pointer. */
packets.get("/latest", async (c) => {
  const row = await c.env.DB
    .prepare(
      `SELECT id, counterpart, day_id, headline, blocking, published_at
         FROM meeting_packets ORDER BY day_id DESC, published_at DESC LIMIT 1`,
    )
    .first<any>();
  return ok(c, { latest: row ?? null, page: "/api/boss/packets/page" });
});

/** The local job filing one. */
packets.post("/", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const counterpart = String(b?.counterpart ?? "").trim();
  const dayId = String(b?.day_id ?? "").trim();
  const markdown = String(b?.markdown ?? "");

  if (!counterpart || !/^\d{4}-\d{2}-\d{2}$/.test(dayId) || markdown.trim().length === 0) {
    throw badRequest(
      "A packet needs a counterpart, a day and a document",
      "An empty packet filed as a real one is worse than none: the page would show a meeting she was prepared for and she was not.",
    );
  }

  /*
   * THE WHOLE DOCUMENT, OR NOTHING.
   *
   * A partial store reports success on a leaking run, which is the reasoning the mailbox reporter
   * carries and the reason its guard is worth having. Her own addresses pass because the grant steps
   * cannot name the mailbox to authorise without naming it.
   */
  const foreign = foreignAddresses(markdown);
  if (foreign.length > 0) {
    throw badRequest(
      `The packet carries ${foreign.length} address(es) that are not hers and was refused whole`,
      "A packet reports counts and agenda items. It never carries a counterparty's address — those live in the sheets on your Mac and stay there.",
    );
  }

  const now = Date.now();
  const id = newId("pkt");
  await c.env.DB
    .prepare(
      `INSERT INTO meeting_packets (id, counterpart, day_id, markdown, headline, blocking, source, published_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(counterpart, day_id) DO UPDATE SET
         markdown = excluded.markdown, headline = excluded.headline, blocking = excluded.blocking,
         source = excluded.source, published_at = excluded.published_at`,
    )
    .bind(
      id, counterpart, dayId, markdown,
      b?.headline ? String(b.headline).slice(0, 300) : null,
      b?.blocking === true ? 1 : 0,
      b?.source === "manual" ? "manual" : "launchd",
      now, now,
    )
    .run();

  const stored = await c.env.DB
    .prepare(`SELECT id FROM meeting_packets WHERE counterpart = ? AND day_id = ?`)
    .bind(counterpart, dayId).first<{ id: string }>();

  await audit(c.env.DB, {
    actor: "system", lane: "ops", entityType: "meeting_packet", entityId: stored?.id ?? id,
    action: "filed", detail: { counterpart, day_id: dayId, bytes: markdown.length },
  });

  return ok(c, { id: stored?.id ?? id, page: "/api/boss/packets/page" }, 201);
});
