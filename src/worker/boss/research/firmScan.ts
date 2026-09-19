/**
 * "FIND ME A LIST OF FIRMS THAT DID X, AND DRAFT AN EMAIL TO ASK THEM Y."
 *
 * ─── Her words, 19 September 2026 ──────────────────────────────────────────
 *
 *   "I would want one of my Boss OS AI agents to find me a list of firms that have reported IPO
 *    participation in the release, and draft an email for me to ask if I can send investors to
 *    them."
 *
 * ─── The path, one instruction in, a list and letters out ──────────────────
 *
 *   1. PARSE. `parseFirmScan` turns the sentence into FIND ("have reported IPO participation in
 *      the release") and ASK ("if I can send investors to them"). It is a grammar, not a model:
 *      the same instruction parses the same way every time, and a sentence it cannot parse falls
 *      through to the ordinary intake untouched. `admitTask` calls it on every door — Team → New
 *      task, the mail intake, the API — so there is one place an instruction becomes this work.
 *   2. SEARCH. A model on the ladder proposes three news-search queries for FIND; each is read
 *      from a public news RSS feed (no key, no account), and the articles are fetched and reduced
 *      to text. Every source is recorded with its URL and title.
 *   3. EXTRACT, AND VERIFY. The model reads the fetched text and names each firm with THE SENTENCE
 *      that says it did X. A finding is `verified` only if that sentence is literally on the page
 *      it cites — the model is not trusted to have read what it says it read. Unverified findings
 *      are kept for the record and get no letter.
 *   4. DRAFT, THROUGH THE SAME DOOR AS EVERY LETTER. Each verified firm becomes a
 *      `sourcing_candidates` row (origin `firm_scan`) and the model composes the ask in her voice,
 *      checked by `checkLetter` — her name, Spry VC, her LinkedIn, never "broker", no address, no
 *      figure she did not state, one retry — and raised by `raiseLetterFor` as a judgement card.
 *      From there it is the proven chain: the green button makes the Gmail draft in staylor@spry.vc,
 *      a send-back with a note is rewritten (0261), nothing sends.
 *
 * Every step writes its count on `firm_scans`, so the desk says "6 sources read · 4 firms · 4
 * letters in your Inbox" from rows. Cost: the calls land on the ladder's first eligible rung; the
 * fetched text is public news so the work is `public_model_approved` unless the router's own scan
 * says otherwise, and `cost_micros` is recorded per scan.
 */

import type { Env } from "../env";
import { newId } from "../lib/id";
import { logEvent } from "../lib/log";
import { routeCompletion, BudgetExceeded, RoutingBlocked, ProviderFailure, type RouteRequest, type RouteResult } from "../router";
import { checkLetter, parseLetterReply, type Complete, type LetterFacts } from "../wealth/rewrite";
import type { CandidateRow, Draft } from "../wealth/outreach";

export const SCAN_OWNER = "emp_research";
export const SCAN_CANDIDATE_KIND = "ask";
export const MAX_SOURCES = 8;
export const MAX_PAGE_CHARS = 9_000;

// ─── 1. The grammar ───────────────────────────────────────────────────────────

export interface FirmScanRequest {
  /** What the firms did — the search and the extraction criterion. */
  find: string;
  /** What she wants to ask them, in her words. */
  ask: string;
  raw: string;
}

const FIND_RE =
  /\b(?:find|get|pull|compile|build|make)\s+(?:me\s+)?(?:a\s+|the\s+)?(?:list\s+of\s+(?:the\s+)?)?(?:firms|companies|investors|funds|banks|institutions|names|people|players|parties|groups)\s+(?:that|who|which|with|having)\s+(.+?)(?=\s*(?:[,;.]|\band\b)\s*(?:then\s+)?(?:please\s+)?(?:draft|write|compose|prepare)\b)/i;
const ASK_RE =
  /\b(?:draft|write|compose|prepare)\s+(?:me\s+)?(?:an?\s+|the\s+)?(?:short\s+)?(?:email|e-mail|letter|note|message|outreach)s?\s*(?:for\s+me\s+)?(?:to\s+)?(?:each\s+(?:of\s+them\s+)?|them\s+)?(?:to\s+)?(?:ask(?:ing)?|see|find\s+out|request(?:ing)?|propos(?:e|ing))\s+(?:them\s+)?(.+?)[.?!]?\s*$/i;

/**
 * Parse an instruction into FIND and ASK, or null when it is not this shape of work.
 *
 * Given several texts (a title, a prompt, a mail body) it reads each ON ITS OWN and takes the first
 * that parses — joining them would let the ASK run into the next text, which is how the desk's
 * title-plus-prompt door first produced "if I can send investors to them. find me a list of…".
 */
export function parseFirmScan(text: string | null | undefined | (string | null | undefined)[]): FirmScanRequest | null {
  if (Array.isArray(text)) {
    for (const t of text) { const p = parseFirmScan(t); if (p) return p; }
    return null;
  }
  const raw = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const find = FIND_RE.exec(raw);
  const ask = ASK_RE.exec(raw);
  if (!find || !ask) return null;
  const findText = find[1]!.trim().replace(/[,;]$/, "");
  let askText = ask[1]!.trim();
  // "if I can send investors to them" — keep her phrasing; only strip a dangling "them".
  askText = askText.replace(/\s+to\s+them$/i, " to them");
  if (findText.length < 6 || askText.length < 4) return null;
  return { find: findText, ask: askText, raw };
}

// ─── 2. Sources: public news search, no key ───────────────────────────────────

export interface Source { url: string; title: string; published: string | null; text?: string; fetched?: boolean; error?: string }

/** Bing News RSS. Keyless, public, and its links carry the article URL in a `url=` parameter. */
export function newsFeedUrl(query: string): string {
  return `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss`;
}

const decodeEntities = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

/** The items in an RSS feed, with the click-tracking wrapper unwrapped. */
export function parseFeed(xml: string): Source[] {
  const out: Source[] = [];
  const items = xml.split(/<item>/i).slice(1);
  for (const item of items) {
    const title = decodeEntities((/<title>([\s\S]*?)<\/title>/i.exec(item)?.[1] ?? "").replace(/<!\[CDATA\[|\]\]>/g, "").trim());
    let link = decodeEntities((/<link>([\s\S]*?)<\/link>/i.exec(item)?.[1] ?? "").trim());
    const published = /<pubDate>([\s\S]*?)<\/pubDate>/i.exec(item)?.[1]?.trim() ?? null;
    const wrapped = /[?&]url=([^&]+)/i.exec(link);
    if (wrapped) { try { link = decodeURIComponent(wrapped[1]!); } catch { /* keep the wrapper */ } }
    if (!/^https?:\/\//i.test(link) || !title) continue;
    out.push({ url: link, title, published });
  }
  return out;
}

/** HTML → readable text, bounded. Scripts, styles and tags out; whitespace collapsed. */
export function pageText(html: string, cap = MAX_PAGE_CHARS): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|br|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(stripped).replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim().slice(0, cap);
}

const FETCH_HEADERS = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 BossOS-research/1.0",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

async function fetchText(url: string, fetchImpl: typeof fetch, timeoutMs = 12_000): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers: FETCH_HEADERS, signal: ctl.signal, redirect: "follow" });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, text: await res.text() };
  } catch (err) {
    return { ok: false, error: (err as Error)?.name === "AbortError" ? "timed out" : ((err as Error)?.message ?? String(err)) };
  } finally {
    clearTimeout(t);
  }
}

// ─── 3. Extraction, and the grounding check ───────────────────────────────────

export interface Finding { firm: string; role: string; quote: string; evidence_url: string; source_title: string | null; verified: boolean }

const normQ = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

/** A finding is verified when its quote (≥ 25 chars) is literally in the page it cites. */
export function verifyFinding(f: { quote: string; evidence_url: string }, sources: Source[]): boolean {
  const src = sources.find((s) => s.url === f.evidence_url && s.fetched && s.text);
  if (!src || !src.text) return false;
  const q = normQ(f.quote);
  if (q.length < 25) return false;
  return normQ(src.text).includes(q);
}

export function parseFindingsReply(text: string): { firm: string; role: string; quote: string; evidence_url: string }[] | null {
  const raw = String(text ?? "").trim();
  const first = raw.indexOf("[");
  const last = raw.lastIndexOf("]");
  const shapes = [raw, raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")];
  if (first >= 0 && last > first) shapes.push(raw.slice(first, last + 1));
  for (const c of shapes) {
    try {
      const v = JSON.parse(c);
      const arr = Array.isArray(v) ? v : Array.isArray(v?.findings) ? v.findings : null;
      if (!arr) continue;
      return arr
        .filter((x: any) => x && typeof x.firm === "string" && typeof x.quote === "string" && typeof x.evidence_url === "string")
        .map((x: any) => ({ firm: String(x.firm).trim(), role: String(x.role ?? "").trim(), quote: String(x.quote).trim(), evidence_url: String(x.evidence_url).trim() }));
    } catch { /* next shape */ }
  }
  return null;
}

export function composeQueriesPrompt(req: FirmScanRequest): RouteRequest["messages"] {
  return [
    { role: "system", content: 'You write news-search queries. Reply with ONE JSON array of 3 short strings and nothing else, e.g. ["a b c","d e"].' },
    { role: "user", content: `Her instruction: "${req.raw}"\n\nWrite 3 news-search queries (3–7 words each, no quotes, no operators) that would find the articles naming firms that ${req.find}. Prefer the specific companies and events in the instruction over generic words.` },
  ];
}

export function composeExtractPrompt(req: FirmScanRequest, sources: Source[]): RouteRequest["messages"] {
  const corpus = sources
    .filter((s) => s.fetched && s.text)
    .map((s, i) => `=== SOURCE ${i + 1} ===\nURL: ${s.url}\nTITLE: ${s.title}\n${s.text}`)
    .join("\n\n");
  return [
    {
      role: "system",
      content:
        "You are Camille, Director of Research. You extract facts from the sources you are given and NOTHING else. " +
        "Reply with ONE JSON array only, no code fence, no commentary. Each element: " +
        '{"firm": "<the organisation\'s name as written>", "role": "<3-8 words: what the source says they did>", "quote": "<ONE sentence copied EXACTLY from the source that says it>", "evidence_url": "<the URL of that source>"}. ' +
        "The quote must be copied verbatim — it is checked against the page and a paraphrase is thrown away. " +
        "If no source names such a firm, reply with [].",
    },
    {
      role: "user",
      content: `Find every organisation that ${req.find}, according to these sources. Include each firm once, with the best single verbatim sentence.\n\n${corpus}`,
    },
  ];
}

export function composeAskPrompt(req: FirmScanRequest, finding: Finding, positions: number[]): RouteRequest["messages"] {
  const system =
    "You are Camille, Director of Research at Boss OS, drafting an email that Sequoia Taylor will send herself from her own mailbox. " +
    "Write in her voice: plain, direct, warm, short. No marketing tone, no bullet points, no em dashes. " +
    'Reply with ONE JSON object only: {"subject": "...", "body": "..."} — no code fence, no commentary. Paragraphs in the body are separated by a blank line.';
  const rules = [
    "Open with her name and firm: \"My name is Sequoia Taylor, and I run Spry VC\". Where the letter says Spry VC the first time, put her LinkedIn page in parentheses right after it: Spry VC (linkedin.com/in/sequoiataylor).",
    "She is an advisor and investor with LP relationships who works with investors looking for late-stage positions. NEVER call her a broker; never use the word broker or brokerage.",
    `The reason she is writing is what the source says about them: "${finding.quote}" (${finding.role || "as reported"}). Refer to it in one sentence, accurately, without quoting the URL.`,
    `THE ASK, in her words: ${req.ask}. Make that the one ask of the letter.`,
    positions.length ? `The only sizes the letter may state are the ones she stated herself: ${positions.map((p) => `$${p}`).join(", ")}.` : "State no dollar figure at all.",
    "No email addresses, no phone numbers, no URLs other than her LinkedIn page.",
    "Between 100 and 220 words. Sign off on three lines: Sequoia Taylor / Spry VC / linkedin.com/in/sequoiataylor.",
  ];
  return [
    { role: "system", content: system },
    { role: "user", content: `RECIPIENT: ${finding.firm}.\n\nRULES (checked by code after you reply):\n${rules.map((r, i) => `${i + 1}. ${r}`).join("\n")}\n\nWrite the letter now, as the JSON object.` },
  ];
}

// ─── The run ──────────────────────────────────────────────────────────────────

export interface ScanDeps { complete?: Complete; fetchImpl?: typeof fetch }

export interface ScanOutcome { state: "done" | "failed"; detail: string; verified: number; drafts: number; cost_micros: number; written_by: string | null }

async function progress(env: Env, scanId: string, patch: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(patch);
  if (keys.length === 0) return;
  await env.DB
    .prepare(`UPDATE firm_scans SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
    .bind(...keys.map((k) => patch[k]), Date.now(), scanId)
    .run();
}

async function event(env: Env, taskId: string, name: string, detail: unknown): Promise<void> {
  await env.DB
    .prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,?,?)`)
    .bind(newId("tev"), taskId, Date.now(), name, JSON.stringify(detail))
    .run()
    .catch(() => {});
}

/**
 * Run one scan for a task carrying `input.firm_scan`. Never throws for an honest failure (the
 * outcome is on the row); throws only for a transient provider failure so the queue retries.
 */
export async function runFirmScan(
  env: Env,
  task: { id: string; lane: string; employee_id: string | null },
  scanId: string,
  deps: ScanDeps = {},
): Promise<ScanOutcome> {
  const complete = deps.complete ?? routeCompletion;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const scan = await env.DB.prepare(`SELECT * FROM firm_scans WHERE id = ?`).bind(scanId).first<any>();
  if (!scan) return { state: "failed", detail: "The scan row is gone.", verified: 0, drafts: 0, cost_micros: 0, written_by: null };
  if (scan.state === "done") return { state: "done", detail: "Already run.", verified: scan.verified_count, drafts: scan.drafts_count, cost_micros: scan.cost_micros, written_by: scan.written_by };
  const req: FirmScanRequest = { find: scan.find_text, ask: scan.ask_text, raw: scan.instruction };
  let cost = 0;
  let writtenBy: string | null = null;

  const fail = async (why: string): Promise<ScanOutcome> => {
    await progress(env, scanId, { state: "failed", failure: why.slice(0, 600), cost_micros: cost, written_by: writtenBy, finished_at: Date.now() });
    await event(env, task.id, "scan_failed", { why });
    return { state: "failed", detail: why, verified: 0, drafts: 0, cost_micros: cost, written_by: writtenBy };
  };
  const ask = async (messages: RouteRequest["messages"], kind: string): Promise<RouteResult> => {
    try {
      const r = await complete(env, {
        routeId: "rt_ops_default", lane: task.lane, taskId: task.id, employeeId: task.employee_id,
        intakeKind: kind, risk: "medium", sensitivity: "internal", budgetMicros: 0, messages,
      });
      cost += r.costMicros;
      writtenBy = r.modelName;
      return r;
    } catch (err) {
      if (err instanceof ProviderFailure) {
        await progress(env, scanId, { state: "queued", failure: `Provider failed, retrying: ${err.message}`.slice(0, 600), cost_micros: cost });
        throw err;
      }
      throw err;
    }
  };

  try {
    await progress(env, scanId, { state: "searching", started_at: scan.started_at ?? Date.now() });

    // 2. Queries, then the feeds.
    const qr = await ask(composeQueriesPrompt(req), "research");
    let queries: string[] = [];
    try {
      const first = qr.text.indexOf("["); const last = qr.text.lastIndexOf("]");
      const arr = JSON.parse(first >= 0 && last > first ? qr.text.slice(first, last + 1) : qr.text);
      if (Array.isArray(arr)) queries = arr.map(String).map((s) => s.trim()).filter((s) => s.length > 2).slice(0, 3);
    } catch { /* fall through */ }
    if (queries.length === 0) queries = [req.find.slice(0, 80)];
    await progress(env, scanId, { queries: JSON.stringify(queries) });

    const seen = new Set<string>();
    const sources: Source[] = [];
    for (const q of queries) {
      const feed = await fetchText(newsFeedUrl(q), fetchImpl);
      if (!feed.ok) { await event(env, task.id, "scan_feed_failed", { query: q, error: feed.error }); continue; }
      for (const s of parseFeed(feed.text)) {
        const key = s.url.replace(/[?#].*$/, "");
        if (seen.has(key)) continue;
        seen.add(key);
        sources.push(s);
        if (sources.length >= MAX_SOURCES) break;
      }
      if (sources.length >= MAX_SOURCES) break;
    }
    await progress(env, scanId, { sources_found: sources.length });
    await event(env, task.id, "scan_sources", { queries, found: sources.length, urls: sources.map((s) => s.url) });
    if (sources.length === 0) return fail(`No news source answered for "${req.find}" — the feeds returned nothing for ${queries.join(" / ")}.`);

    // Read each article.
    let read = 0;
    for (const s of sources) {
      const page = await fetchText(s.url, fetchImpl);
      if (page.ok) {
        const text = pageText(page.text);
        if (text.length > 400) { s.text = text; s.fetched = true; read++; }
        else { s.fetched = false; s.error = "page had no readable text"; }
      } else { s.fetched = false; s.error = page.error; }
    }
    await progress(env, scanId, { sources_read: read, state: "extracting" });
    await event(env, task.id, "scan_read", { read, unread: sources.filter((s) => !s.fetched).map((s) => ({ url: s.url, error: s.error })) });
    if (read === 0) return fail(`${sources.length} sources were found and none could be read (${sources.map((s) => s.error).join("; ")}).`);

    // 3. Extract, verify.
    const er = await ask(composeExtractPrompt(req, sources), "research");
    const raw = parseFindingsReply(er.text);
    if (!raw) return fail("The model's findings were not a JSON list; nothing was recorded.");
    const now = Date.now();
    const findings: Finding[] = [];
    const named = new Set<string>();
    for (const f of raw) {
      const key = f.firm.toLowerCase();
      if (!f.firm || named.has(key)) continue;
      named.add(key);
      const src = sources.find((s) => s.url === f.evidence_url);
      findings.push({ ...f, source_title: src?.title ?? null, verified: verifyFinding(f, sources) });
    }
    for (const f of findings) {
      await env.DB
        .prepare(`INSERT INTO firm_scan_findings (id, scan_id, firm, role, quote, evidence_url, source_title, verified, created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
        .bind(newId("fsf"), scanId, f.firm, f.role, f.quote, f.evidence_url, f.source_title, f.verified ? 1 : 0, now)
        .run();
    }
    const verified = findings.filter((f) => f.verified);
    await progress(env, scanId, { findings_count: findings.length, verified_count: verified.length, state: "drafting" });
    await event(env, task.id, "scan_findings", { named: findings.length, verified: verified.length, unverified: findings.filter((f) => !f.verified).map((f) => f.firm) });
    if (verified.length === 0) {
      await progress(env, scanId, { state: "done", finished_at: Date.now(), cost_micros: cost, written_by: writtenBy });
      return {
        state: "done",
        detail: findings.length
          ? `${read} sources read. ${findings.length} firm${findings.length === 1 ? "" : "s"} named but none with a sentence that is actually on the page, so no letter was drafted.`
          : `${read} sources read and no firm that ${req.find} is named in them. Nothing was drafted.`,
        verified: 0, drafts: 0, cost_micros: cost, written_by: writtenBy,
      };
    }

    // 4. Draft the ask for each verified firm, through the letters' own door.
    const { getSetting } = await import("../lib/settings");
    const { readStoredPositions, WORKING_POSITIONS_KEY } = await import("../../../shared/wealth/positionSizes");
    const positions = readStoredPositions(await getSetting(env.DB, WORKING_POSITIONS_KEY));
    const { raiseLetterFor } = await import("../routes/wealth");
    let drafts = 0;
    for (const f of verified) {
      const candidateId = await upsertCandidate(env, f, req, now);
      const candidate = await env.DB.prepare(`SELECT * FROM sourcing_candidates WHERE id = ?`).bind(candidateId).first<CandidateRow>();
      if (!candidate) continue;
      const facts: LetterFacts = { candidate, positions_usd: positions, previous: { subject: "", body: "", attempt: 0 }, notes: [req.ask], rejectedBodies: [] };
      const messages = composeAskPrompt(req, f, positions);
      let letter: { subject: string; body: string } | null = null;
      let broken: string[] = [];
      for (let pass = 1; pass <= 2; pass++) {
        const r = await ask(messages, "drafting");
        letter = parseLetterReply(r.text);
        broken = letter ? checkLetter(letter, facts).filter((b) => !b.startsWith("it is too short")) : ["the reply was not a {subject, body} JSON object"];
        if (broken.length === 0) break;
        messages.push({ role: "assistant", content: r.text }, { role: "user", content: `That letter broke these rules: ${broken.map((b, i) => `${i + 1}) ${b}`).join("; ")}. Write it again as the JSON object, keeping every rule.` });
      }
      if (!letter || broken.length) {
        await env.DB.prepare(`UPDATE firm_scan_findings SET candidate_id = ?, draft_state = 'refused', draft_detail = ? WHERE scan_id = ? AND firm = ?`)
          .bind(candidateId, `Two tries, and the letter still broke a rule: ${broken.join("; ")}`, scanId, f.firm).run();
        continue;
      }
      const composed: Draft = {
        subject: letter.subject,
        body: letter.body,
        to_hint: `The contact route: find it from the source that named them — ${f.evidence_url}`,
        built_from: {
          candidate_id: candidateId, name: f.firm, drafted_at: Date.now(), used: ["firm_scan", "her_ask", "evidence_quote"],
          history_kind: null, history_label: `a firm named in ${f.source_title ?? "a public article"} as one that ${req.find}`,
          her_note: null, written_by: writtenBy, firm_scan_id: scanId, evidence_url: f.evidence_url, evidence_quote: f.quote, ask: req.ask,
        },
      };
      const raised = await raiseLetterFor(env, candidate, composed, null, Date.now());
      await env.DB.prepare(`UPDATE firm_scan_findings SET candidate_id = ?, draft_state = ?, draft_detail = ? WHERE scan_id = ? AND firm = ?`)
        .bind(candidateId, raised.drafted ? "awaiting" : "refused", raised.detail, scanId, f.firm).run();
      if (raised.drafted) drafts++;
      await progress(env, scanId, { drafts_count: drafts });
    }

    await progress(env, scanId, { state: "done", finished_at: Date.now(), cost_micros: cost, written_by: writtenBy, drafts_count: drafts });
    await event(env, task.id, "scan_done", { sources_read: read, verified: verified.length, drafts, cost_micros: cost, written_by: writtenBy });
    await logEvent(env.DB, { level: "info", scope: "research", event: "firm_scan_done", entityId: scanId, detail: { verified: verified.length, drafts, cost_micros: cost } }).catch(() => {});
    return {
      state: "done",
      detail: `${read} sources read · ${verified.length} firm${verified.length === 1 ? "" : "s"} found with the sentence that says so · ${drafts} letter${drafts === 1 ? "" : "s"} in your Inbox to approve (written by ${writtenBy}). Nothing has been sent.`,
      verified: verified.length, drafts, cost_micros: cost, written_by: writtenBy,
    };
  } catch (err) {
    if (err instanceof ProviderFailure) throw err;
    if (err instanceof BudgetExceeded || err instanceof RoutingBlocked) return fail(`The router refused the scan: ${(err as Error).message}`);
    return fail(`The scan could not run: ${(err as Error)?.message ?? String(err)}`);
  }
}

/** The firm as a candidate row — kind `ask`, so it never enters the buyer recommendation. */
async function upsertCandidate(env: Env, f: Finding, req: FirmScanRequest, now: number): Promise<string> {
  const existing = await env.DB
    .prepare(`SELECT id FROM sourcing_candidates WHERE name = ? AND kind = ?`)
    .bind(f.firm, SCAN_CANDIDATE_KIND)
    .first<{ id: string }>();
  if (existing) {
    await env.DB.prepare(`UPDATE sourcing_candidates SET source_url = ?, source_name = ?, read_at = ?, thesis = ?, status = 'reviewed', updated_at = ? WHERE id = ?`)
      .bind(f.evidence_url, f.source_title, now, `${req.find}: "${f.quote}"`, now, existing.id).run();
    return existing.id;
  }
  const id = newId("src");
  await env.DB
    .prepare(
      `INSERT INTO sourcing_candidates (id, name, kind, ticket_floor_usd, thesis, source_url, source_name, read_at, origin, status, created_at, updated_at)
       VALUES (?,?,?,NULL,?,?,?,?,'firm_scan','reviewed',?,?)`,
    )
    .bind(id, f.firm, SCAN_CANDIDATE_KIND, `${req.find}: "${f.quote}"`, f.evidence_url, f.source_title, now, now, now)
    .run();
  return id;
}

/** What the desk shows for a scan: the counts, the findings, and where each letter is. */
export async function scanReport(env: Env, scanId: string) {
  const scan = await env.DB.prepare(`SELECT * FROM firm_scans WHERE id = ?`).bind(scanId).first<any>();
  if (!scan) return null;
  const findings = await env.DB
    .prepare(
      `SELECT f.*, d.id AS draft_id, d.state AS letter_state, d.judgement_id
         FROM firm_scan_findings f
         LEFT JOIN buyer_outreach_drafts d ON d.id = (
           SELECT id FROM buyer_outreach_drafts WHERE candidate_id = f.candidate_id ORDER BY attempt DESC LIMIT 1
         )
        WHERE f.scan_id = ? ORDER BY f.verified DESC, f.firm`,
    )
    .bind(scanId)
    .all<any>();
  return { ...scan, queries: scan.queries ? JSON.parse(scan.queries) : [], findings: findings.results ?? [] };
}
