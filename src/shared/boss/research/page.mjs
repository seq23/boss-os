/**
 * CAMILLE'S RESEARCH PAGE — one question in, one page out (owner, 22 Oct 2026).
 *
 * "give Camille a real executor for research deliverables (output: an HTML/markdown page)". Until
 * today a research ask on Camille's desk reached a cloud rung as free text and came back as a
 * paragraph in `tasks.output`: no page, nowhere to find it again, nothing Zora could file.
 *
 * THE LANE, IN HER WORDS
 *
 *   To:      boss@sequoiataylor.com   (or camille@sequoiataylor.com)
 *   Subject: #camille research: what do Memphis senior-living communities pay referral services?
 *
 * `admitTask` reads it with `parseResearchPage` (every door: mail, Team → New task, the API), puts
 * `input.research_page` and `delivers: "research_page"` on the task and names her Claude Code seat
 * (`bk_claude_code`) as the backend. Her Mac claims it through /backends/claim on the agent's next
 * tick; the run writes `delivers.json` with `{ "research_page": { title, summary, markdown, sources } }`;
 * `deliverResearchPage` files it into `research_pages` and the shared `delivered_work` list, and the
 * page is served as HTML at /api/boss/research/pages/<id>. The executor record is
 * `SEAT_EXECUTORS.emp_research.research_page` in `src/shared/boss/duties/executors.mjs`.
 *
 * Plain ESM with a hand-written `.d.mts`, so the Worker, the tests and the validators run the SAME code.
 */

export const RESEARCH_PAGE_DELIVERS = "research_page";
export const RESEARCH_PAGE_SEAT = "emp_research";
export const RESEARCH_PAGE_BACKEND = "bk_claude_code";

/**
 * THE SEAT'S SCOPE FOR A RESEARCH PAGE (22 Oct 2026). The Mac runner refuses any envelope without an
 * absolute `repo_path` and a non-empty `allowed_paths` (scripts/sync-agent/runner.mjs) — and the first
 * research page ever emailed was refused there ("repo_path must be an absolute path") because the
 * page lane never said where the run works. A research run writes one file, delivers.json, in its own
 * folder on her Mac, with the web tools and nothing else; the same shape her standing research duties
 * carry (migrations 0182/0194). The installer creates the folder.
 */
export const RESEARCH_PAGE_DIR = "/Users/sequoiataylor/.boss-os/research";
export const RESEARCH_PAGE_REQUESTED = Object.freeze({
  repo_path: RESEARCH_PAGE_DIR,
  allowed_paths: Object.freeze([RESEARCH_PAGE_DIR]),
  web_tools: Object.freeze(["WebSearch", "WebFetch"]),
  max_seconds: 1500,
});
export const RESEARCH_PAGE_ROUTE = "/api/boss/research/pages";
export const BOSS_ORIGIN = "https://boss.sequoiataylor.com";

/** `research: <q>`, `research page: <q>`, `#camille research <q>`, `research on <q>`. */
const RESEARCH_RE = /(?:^|\n|#camille\s+)\s*research(?:\s+page)?(?:\s*[:\-–—]\s*|\s+(?:on|about|into)\s+|\s+(?=[a-z0-9"'“]))([\s\S]{8,2000})/i;

/**
 * Her question, or null. Only the explicit verb counts — "research" as the first word of a line, or
 * right after `#camille` — so an ordinary message that happens to contain the word stays ordinary.
 */
export function parseResearchPage(parts) {
  const text = (Array.isArray(parts) ? parts : [parts]).filter((x) => typeof x === "string" && x.trim()).join("\n");
  const m = RESEARCH_RE.exec(text);
  if (!m) return null;
  const question = m[1].replace(/\s+/g, " ").trim();
  if (question.length < 8) return null;
  return { question: question.slice(0, 2000) };
}

/** The page's own address — what the run puts at the end of its reply, and what Zora files. */
export function researchPageUrl(id) {
  return `${BOSS_ORIGIN}${RESEARCH_PAGE_ROUTE}/${encodeURIComponent(String(id))}`;
}

/** The instruction the seat run is handed. The delivery shape is stated exactly; nothing is left to guess. */
export function composeResearchPrompt({ id, question }) {
  return [
    "You are Camille, Director of Research on Sequoia Taylor's Boss OS team. She asked for a research page.",
    "",
    `HER QUESTION: ${question}`,
    "",
    "Do the research with your web tools. Read the pages you cite; never cite a page you did not open. A figure you could not verify goes under a 'What I could not confirm' heading, never estimated.",
    "Write for her: plain English, bold key phrase first in each bullet, short sections, a one-paragraph answer at the top. No jargon.",
    "",
    "DELIVERY — write a file named delivers.json in the current directory, valid JSON, exactly this shape:",
    '{ "status": "complete" | "partial", "research_page": { "title": "<4-10 words>", "summary": "<the answer in 1-3 sentences>", "markdown": "<the full page in Markdown: ## headings, - bullets, **bold**, [text](https://link)>", "sources": [ { "title": "<page title>", "url": "https://…" } ] }, "gaps": [ "<what you could not confirm, and why>" ] }',
    "",
    `When delivers.json is written, end your reply with exactly one line: Page: ${researchPageUrl(id)}`,
  ].join("\n");
}

// ─── The page ────────────────────────────────────────────────────────────────

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Inline Markdown on ALREADY-ESCAPED text: **bold**, *em*, `code`, [text](https://…). Links are https only. */
function inline(s) {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, (_, t, u) => `<a href="${u}" rel="noopener noreferrer">${t}</a>`);
}

/** A deliberately small Markdown → HTML: headings, bullets, numbered lists, paragraphs. Everything is escaped first. */
export function markdownToHtml(md) {
  const out = [];
  let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of String(md ?? "").split(/\r?\n/)) {
    const line = esc(raw.trimEnd());
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (h) { close(); const n = Math.min(4, h[1].length + 1); out.push(`<h${n}>${inline(h[2])}</h${n}>`); }
    else if (ul) { if (list !== "ul") { close(); out.push("<ul>"); list = "ul"; } out.push(`<li>${inline(ul[1])}</li>`); }
    else if (ol) { if (list !== "ol") { close(); out.push("<ol>"); list = "ol"; } out.push(`<li>${inline(ol[1])}</li>`); }
    else if (!line.trim()) close();
    else { close(); out.push(`<p>${inline(line)}</p>`); }
  }
  close();
  return out.join("\n");
}

/**
 * A PAGE IS NEVER "DONE" OVER A CHANGE THAT WAS NOT MADE (owner incident, 1 Nov 2026). A ruling
 * reached Camille as research; the page's summary said "Done as you ruled" while its own gaps said
 * "the duty change itself … still has to be built … this research run cannot change code". The gap
 * that says an asked-for change was not made, or null. Read by `runNeedsHerDecision` (the task is not
 * accepted as done) and by `readResearchDelivery` (the summary says so first). Pure.
 */
const NOT_TAKEN_RE = /\b(?:still\s+(?:has|have|needs?)\s+to\s+be\s+(?:built|made|changed|applied|done|wired|added|implemented|updated)|(?:can\s*not|cannot|can't|could\s+not|couldn't|did\s+not|didn't|was\s+not\s+able\s+to)\s+(?:change|edit|apply|build|update|implement|wire|make\s+the\s+change)|(?:was|were|is|are|has|have)\s+not\s+(?:yet\s+)?(?:been\s+)?(?:changed|applied|built|implemented|updated|wired|made))\b/i;
export function actionNotTaken(payload) {
  const gaps = payload && typeof payload === "object" && Array.isArray(payload.gaps) ? payload.gaps : [];
  const hit = gaps.map((g) => String(g ?? "")).find((g) => NOT_TAKEN_RE.test(g));
  return hit ? hit.slice(0, 500) : null;
}

/**
 * The delivered payload, checked. Returns `{ ok: true, page }` or `{ ok: false, why }` — a run that
 * delivered no page is a failure by name (Rule 0), never an empty page filed as done.
 */
export function readResearchDelivery(payload) {
  const p = payload && typeof payload === "object" ? payload.research_page : null;
  if (!p || typeof p !== "object") return { ok: false, why: "the run's delivers.json carried no research_page object" };
  const title = typeof p.title === "string" ? p.title.trim().slice(0, 200) : "";
  const markdown = typeof p.markdown === "string" ? p.markdown.trim().slice(0, 200_000) : "";
  if (!title) return { ok: false, why: "the research page has no title" };
  if (markdown.length < 80) return { ok: false, why: `the research page body is ${markdown.length} characters — not a page` };
  const sources = (Array.isArray(p.sources) ? p.sources : [])
    .map((s) => ({ title: String(s?.title ?? "").trim().slice(0, 300), url: String(s?.url ?? "").trim() }))
    .filter((s) => /^https:\/\/[^\s]+$/.test(s.url))
    .slice(0, 60);
  const gaps = (Array.isArray(payload.gaps) ? payload.gaps : []).map((g) => String(g).slice(0, 500)).slice(0, 30);
  const status = payload.status === "complete" && gaps.length === 0 ? "complete" : "partial";
  const summary = typeof p.summary === "string" ? p.summary.trim().slice(0, 1000) : "";
  const notTaken = actionNotTaken(payload);
  return { ok: true, page: { title, summary: notTaken ? `Not done yet: ${notTaken}` : summary, markdown, sources, gaps, status } };
}

/** The whole page, self-contained, calm, readable on a phone. */
export function renderResearchPageHtml({ title, summary, markdown, sources = [], gaps = [], question = "", delivered_at = null }) {
  const when = delivered_at ? new Date(delivered_at).toLocaleDateString("en-US", { timeZone: "America/Chicago", year: "numeric", month: "long", day: "numeric" }) : "";
  const src = (sources ?? []).length
    ? `<h2>Sources</h2><ol>${sources.map((s) => `<li><a href="${esc(s.url)}" rel="noopener noreferrer">${esc(s.title || s.url)}</a></li>`).join("")}</ol>`
    : "";
  const gap = (gaps ?? []).length ? `<h2>What I could not confirm</h2><ul>${gaps.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;background:#f6f4ef;color:#1f1d1a;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}main{max-width:720px;margin:0 auto;padding:24px 16px 48px;background:#fff}h1{font-size:26px;line-height:1.25;margin:0 0 6px}h2{font-size:19px;margin:28px 0 8px}h3,h4{font-size:16px;margin:20px 0 6px}.meta{color:#6b665e;font-size:13px;margin:0 0 16px}.summary{background:#fbf6ea;border:1px solid #eadfc4;border-radius:8px;padding:12px 14px}a{color:#1d4ed8}code{background:#f1efe9;padding:0 4px;border-radius:3px}@media (prefers-color-scheme:dark){body{background:#151412;color:#ece9e2}main{background:#1d1c19}.summary{background:#26231c;border-color:#3b3528}.meta{color:#a39d92}a{color:#93b4ff}code{background:#2a2824}}</style>
</head><body><main><h1>${esc(title)}</h1><p class="meta">Research by Camille${when ? ` · ${esc(when)}` : ""}${question ? ` · asked: “${esc(question)}”` : ""}</p>${summary ? `<p class="summary"><strong>${esc(summary)}</strong></p>` : ""}
${markdownToHtml(markdown)}
${gap}${src}</main></body></html>`;
}
