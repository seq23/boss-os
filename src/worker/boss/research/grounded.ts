/**
 * THE FREE GROUNDED-GOOGLE RUNG FOR RESEARCH (owner, 6 Nov 2026: "what about google? what about the
 * chain? … i want boss os to do the fucking work").
 *
 * A research task whose seats are spent (Codex out until its reset, Claude not allowed to take over)
 * used to have nowhere to go: the plain cloud rungs cannot open a page, so a research brief that
 * reached them came back as a confident paragraph with no sources. This rung does the work with
 * Gemini 2.5 Flash and Google Search grounding, on the free tier, in sections:
 *
 *   · the brief is split into its numbered asks (`groundedSections`), one grounded call each, so a
 *     long brief fits inside the free key's daily allowance instead of one giant call that cannot;
 *   · each call's slot is CLAIMED before the call (`claimFreeSearch`, FREE_ROUTES.svc_gemini_grounded);
 *     the allowance gone, or Google's own 429, is NAMED STOP [FREE_SEARCH_CAP] with the reset time,
 *     and the finished sections are kept (task_events 'grounded_section') so the next run resumes;
 *   · ONLY LINES GOOGLE TIED TO A PAGE ARE KEPT (`keepSupported`, from groundingSupports). A line no
 *     page backs is removed and counted under "What I could not confirm" — nothing from memory;
 *   · the answer-first summary is written by a free model from the kept lines only; a sentence with a
 *     figure and no citation is removed (`sourcedSummary`).
 *
 * The router's privacy screen runs on every call: the Gemini free tier trains on prompts, so
 * private-model-only work is refused before any request exists (policy.ts) — fail closed.
 */
import type { Env } from "../env";
import { newId } from "../lib/id";
import { routeCompletion } from "../router";
import { claimFreeSearch } from "./searchQuota";

export const GROUNDED_SERVICE = "svc_gemini_grounded";
export const GROUNDED_SEARCH_JOB = "research_grounded_search";
export const GROUNDED_WRITE_JOB = "research_write";
const MAX_SECTIONS = 10;

export interface GroundedSection { n: number; ask: string }
export interface GroundedBrief { question: string; sections: GroundedSection[]; output: string }

/** The brief, split into its numbered asks. No numbered list → one section, the whole brief. Pure. */
export function groundedSections(instruction: string): GroundedBrief {
  const lines = String(instruction ?? "").split(/\r?\n/);
  const pre: string[] = [];
  const post: string[] = [];
  const items: GroundedSection[] = [];
  let ended = false;
  for (const raw of lines) {
    const line = raw.trim();
    const item = /^(\d{1,2})[.)]\s+(.+)$/.exec(line);
    if (!ended && item) { items.push({ n: Number(item[1]), ask: item[2]!.trim() }); continue; }
    if (items.length === 0) { pre.push(line); continue; }
    if (ended || /^(output|format|deliver(?:y|able)?)\b/i.test(line)) { ended = true; post.push(line); continue; }
    if (line) items[items.length - 1]!.ask += ` ${line}`;
  }
  const question = pre.filter(Boolean).join(" ").trim();
  const output = post.filter(Boolean).join(" ").trim();
  if (items.length === 0) return { question, sections: [{ n: 1, ask: question || String(instruction ?? "").trim() }], output };
  // More asks than the allowance should carry in one run: the tail is merged into the last section.
  const kept = items.slice(0, MAX_SECTIONS);
  if (items.length > MAX_SECTIONS) kept[MAX_SECTIONS - 1]!.ask += " " + items.slice(MAX_SECTIONS).map((i) => `${i.n}. ${i.ask}`).join(" ");
  return { question, sections: kept, output };
}

const enc = new TextEncoder();
const isSeparator = (l: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l);
const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isStructural = (l: string) => !l.trim() || /^\s*#{1,6}\s/.test(l) || isSeparator(l) || /^\s*\*\*[^*]{1,80}\*\*:?\s*$/.test(l);

/**
 * KEEP ONLY WHAT A PAGE BACKS. `supports` are Gemini's UTF-8 byte ranges into `text`, each with the
 * indexes of the sources behind it. A content line no support overlaps is dropped; a kept line gets
 * its citations as `[[s:i]]` (local source indexes), numbered later across sections. Table headers,
 * headings and separators are structure, kept only while the table/section keeps a row. "Not found:"
 * lines become gaps. Pure.
 */
export function keepSupported(text: string, supports: { start: number; end: number; sources: number[] }[]): { lines: string[]; dropped: number; notFound: string[] } {
  const raw = String(text ?? "").replace(/```[a-z]*\n?/gi, "").split("\n");
  const ranges: { s: number; e: number }[] = [];
  let at = 0;
  for (const l of raw) { const len = enc.encode(l).length; ranges.push({ s: at, e: at + len }); at += len + 1; }
  const out: { line: string; content: boolean; table: boolean }[] = [];
  const notFound: string[] = [];
  let dropped = 0;
  raw.forEach((line, i) => {
    const nf = /^\s*[-*•]?\s*\**not found\**\s*[:\-–—]\s*(.+)$/i.exec(line);
    if (nf) { notFound.push(nf[1]!.trim().slice(0, 300)); return; }
    const header = isTableRow(line) && i + 1 < raw.length && isSeparator(raw[i + 1]!);
    if (isStructural(line) || header) { out.push({ line, content: false, table: isTableRow(line) || isSeparator(line) }); return; }
    const { s, e } = ranges[i]!;
    const ids = [...new Set(supports.filter((p) => p.start < e && p.end > s).flatMap((p) => p.sources))].sort((a, b) => a - b);
    if (ids.length === 0) { dropped++; return; }
    const tag = ids.map((x) => `[[s:${x}]]`).join("");
    const trimmed = line.trimEnd();
    const cited = isTableRow(trimmed) ? `${trimmed.replace(/\|\s*$/, "").trimEnd()} ${tag} |` : `${trimmed} ${tag}`;
    out.push({ line: cited, content: true, table: isTableRow(trimmed) });
  });
  // A table that lost every body row loses its header too; a heading with nothing under it goes.
  const kept: string[] = [];
  for (let i = 0; i < out.length; i++) {
    const o = out[i]!;
    if (o.table && !o.content) {
      let j = i; let rows = 0;
      while (j < out.length && out[j]!.table) { if (out[j]!.content) rows++; j++; }
      if (rows === 0) { i = j - 1; continue; }
      for (let k = i; k < j; k++) kept.push(out[k]!.line);
      i = j - 1; continue;
    }
    kept.push(o.line);
  }
  const tidy = kept.filter((l, i, a) => !(/^\s*#{1,6}\s/.test(l) && (i === a.length - 1 || /^\s*#{1,6}\s/.test(a[i + 1]!))));
  return { lines: tidy.join("\n").replace(/\n{3,}/g, "\n\n").trim().split("\n"), dropped, notFound };
}

/** A summary sentence carrying a figure must carry a citation; otherwise it is removed. Pure. */
export function sourcedSummary(summary: string, maxRef: number): string {
  const sentences = String(summary ?? "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/);
  return sentences.filter((s) => {
    const refs = [...s.matchAll(/\[(\d{1,3})\]/g)].map((m) => Number(m[1]));
    if (refs.some((r) => r < 1 || r > maxRef)) return false;
    return refs.length > 0 || !/[\d$%]/.test(s);
  }).join(" ").trim();
}

/** The next midnight in Google's own zone (Pacific), when the free allowance resets, plus five minutes. */
export function freeTierResetAt(now: number): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23", hour: "numeric", minute: "numeric", second: "numeric" })
    .formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  const into = ((Number(parts.hour) % 24) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) * 1000;
  return now - into + 24 * 3600_000 + 5 * 60_000;
}

/** Google's grounding links are redirects; the page a person reads is where they land. */
async function landingUrl(url: string): Promise<string> {
  if (!/^https:\/\/vertexaisearch\.cloud\.google\.com\//.test(url)) return url;
  try {
    const res = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(6000) });
    const loc = res.headers.get("location");
    return loc && /^https:\/\//.test(loc) ? loc : url;
  } catch { return url; }
}

export type GroundedOutcome =
  | { state: "done"; page: { title: string; summary: string; markdown: string; sources: { title: string; url: string }[]; gaps: string[]; status: "complete" | "partial" }; model: string }
  | { state: "stop"; code: "FREE_SEARCH_CAP" | "FREE_ROUTE_REFUSED"; why: string; resumeAt: number | null };

interface SectionDone { n: number; ask: string; lines: string[]; sources: { title: string; url: string }[]; dropped: number; notFound: string[]; failed?: string }

function sectionPrompt(brief: GroundedBrief, s: GroundedSection, today: string): string {
  return [
    `Today is ${today}. You are Camille, the research lead on Sequoia Taylor's team, researching with Google Search.`,
    "",
    `THE WHOLE BRIEF, FOR CONTEXT ONLY: ${brief.question}`,
    brief.output ? `HOW SHE WANTS IT: ${brief.output}` : "",
    "",
    `ANSWER ONLY THIS PART: ${s.ask}`,
    "",
    "RULES",
    "- Search Google for every fact. State only what a page you found says. Never estimate, never fill a gap from memory.",
    "- When you cannot find something, write one line that starts with \"Not found:\" and says what is missing.",
    "- Plain English for someone new to this field. Short sentences. Explain any term in a few words.",
    "- Start with one sentence that answers this part directly.",
    "- Use a Markdown table for any comparison: prices, fees, costs, rules by state, competitors, income ranges. One fact per row.",
    "- Give figures exactly as the page states them, with the place and year when the page gives them.",
    "- If this part asks for maths, show it as a small table where every input is a figure you found.",
    "- No heading for this part, no sources list, no links: the citations are added for you.",
    "- At most 400 words.",
  ].filter((l) => l !== "").join("\n");
}

/**
 * Run (or resume) the grounded research for a task. Finished sections are read back from
 * task_events, so a run cut short — a Worker invocation that died, a cap reached — never repeats a
 * search it already paid its allowance for.
 */
export async function runGroundedResearch(
  env: Env,
  task: { id: string; lane: string; title: string; sensitivity?: string | null; model_access?: string | null; employee_id?: string | null; risk?: string | null },
  instruction: string,
  now: () => number = Date.now,
): Promise<GroundedOutcome> {
  const brief = groundedSections(instruction);
  const today = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", dateStyle: "long" }).format(new Date(now()));
  const prior = await env.DB
    .prepare(`SELECT detail FROM task_events WHERE task_id = ? AND event = 'grounded_section' ORDER BY ts`)
    .bind(task.id).all<{ detail: string }>();
  const done = new Map<number, SectionDone>();
  for (const r of prior.results ?? []) { try { const d = JSON.parse(r.detail) as SectionDone; done.set(d.n, d); } catch { /* unreadable: redo it */ } }

  const base = {
    routeId: "rt_ops_default", lane: task.lane, taskId: task.id, employeeId: task.employee_id ?? null,
    intakeKind: "research", risk: task.risk ?? "low", sensitivity: task.sensitivity ?? "private",
    modelAccess: (task.model_access ?? null) as any, freeOnly: true, onlyProviderId: "prv_gemini",
  } as const;

  let model = "Gemini 2.5 Flash with Google Search (Google, free)";
  for (const s of brief.sections) {
    if (done.has(s.n)) continue;
    const slot = await claimFreeSearch(env.DB, GROUNDED_SERVICE, now());
    if (!slot.ok) {
      return { state: "stop", code: "FREE_SEARCH_CAP", resumeAt: freeTierResetAt(now()),
        why: `NAMED STOP [FREE_SEARCH_CAP] the free Google-search allowance for today is used (${slot.used} of ${slot.cap}); ${done.size} of ${brief.sections.length} parts are done and kept, the rest run after the reset` };
    }
    let rec: SectionDone;
    try {
      const r = await routeCompletion(env, { ...base, jobKey: GROUNDED_SEARCH_JOB, webSearch: true, maxOutputTokens: 2500, messages: [{ role: "user", content: sectionPrompt(brief, s, today) }] });
      model = r.modelDisplayName || model;
      const kept = keepSupported(r.text, r.supports ?? []);
      rec = { n: s.n, ask: s.ask, lines: kept.lines, sources: (r.sources ?? []).map((x) => ({ title: x.title, url: x.url })), dropped: kept.dropped, notFound: kept.notFound };
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      if (/\b429\b|RESOURCE_EXHAUSTED|quota/i.test(why)) {
        return { state: "stop", code: "FREE_SEARCH_CAP", resumeAt: freeTierResetAt(now()),
          why: `NAMED STOP [FREE_SEARCH_CAP] Google's free tier refused more searches today (${why.slice(0, 160)}); ${done.size} of ${brief.sections.length} parts are done and kept` };
      }
      if (/privacy|private|no candidate|refus|blocked|not allowed|no model/i.test(why)) {
        return { state: "stop", code: "FREE_ROUTE_REFUSED", resumeAt: null, why: `NAMED STOP [FREE_ROUTE_REFUSED] the free Google route declined this work: ${why.slice(0, 240)}` };
      }
      throw e; // transient: the queue retries with backoff, and the parts already done are kept
    }
    await env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'grounded_section',?)`)
      .bind(newId("tev"), task.id, now(), JSON.stringify(rec)).run();
    done.set(s.n, rec);
  }

  // Number the sources across every part, by the page a person lands on.
  const sections = brief.sections.map((s) => done.get(s.n)!).filter(Boolean);
  const raw = [...new Set(sections.flatMap((s) => s.sources.map((x) => x.url)))];
  const landed = new Map<string, string>();
  for (let i = 0; i < raw.length; i += 8) {
    const batch = raw.slice(i, i + 8);
    const urls = await Promise.all(batch.map((u) => landingUrl(u)));
    batch.forEach((u, k) => landed.set(u, urls[k]!));
  }
  const numbered: { title: string; url: string }[] = [];
  const numberOf = (title: string, url: string) => {
    const at = landed.get(url) ?? url;
    let n = numbered.findIndex((x) => x.url === at);
    if (n === -1) { numbered.push({ title, url: at }); n = numbered.length - 1; }
    return n + 1;
  };
  const gaps: string[] = [];
  const body: string[] = [];
  for (const s of sections) {
    const heading = s.ask.replace(/[:.].*$/, "").slice(0, 90);
    const text = s.lines.join("\n").replace(/\[\[s:(\d+)\]\]/g, (_, i) => {
      const src = s.sources[Number(i)];
      return src ? `[${numberOf(src.title, src.url)}]` : "";
    }).replace(/(\[\d+\])(?:\s*\1)+/g, "$1");
    body.push(`## ${s.n}. ${heading}`, "", text.trim() || "_Nothing on this part could be tied to a page._", "");
    for (const nf of s.notFound) gaps.push(`Part ${s.n}: ${nf}`);
    if (s.dropped > 0) gaps.push(`Part ${s.n}: ${s.dropped} line${s.dropped === 1 ? "" : "s"} no page backed ${s.dropped === 1 ? "was" : "were"} removed.`);
  }
  const found = body.join("\n");

  // The answer first, written ONLY from the kept, cited lines.
  let title = (brief.question || task.title).replace(/^deep research\s*[:\-–—]\s*/i, "").slice(0, 90);
  let summary = "";
  try {
    const w = await routeCompletion(env, {
      ...base, jobKey: GROUNDED_WRITE_JOB, maxOutputTokens: 900,
      messages: [{ role: "user", content: [
        `HER QUESTION: ${brief.question}`,
        "",
        "THE SOURCED FINDINGS (each fact ends with its [n] citation):",
        found.slice(0, 60_000),
        "",
        "Write the answer she reads first. Return JSON only: {\"title\": \"<4-10 plain words>\", \"summary\": \"<3-5 short sentences: the direct answer first, then what it takes, what it costs and what it can earn>\"}.",
        "Use ONLY facts in the findings. Every sentence with a number keeps the [n] citation the finding had. Plain English, no jargon.",
      ].join("\n") }],
    });
    const m = /\{[\s\S]*\}/.exec(w.text);
    const j = m ? JSON.parse(m[0]) : null;
    if (j && typeof j.title === "string" && j.title.trim()) title = j.title.trim().slice(0, 120);
    if (j && typeof j.summary === "string") summary = sourcedSummary(j.summary, numbered.length);
  } catch { /* the summary falls back to the parts' own first lines below */ }
  if (!summary) {
    summary = sections.map((s) => s.lines.find((l) => !isStructural(l) && !isTableRow(l)) ?? "").filter(Boolean).slice(0, 3).join(" ")
      .replace(/\[\[s:(\d+)\]\]/g, "").trim();
  }

  const markdown = [
    "## The answer first", "", summary || "_No part of the answer could be tied to a page._", "",
    found,
    "## Sources", "",
    ...numbered.map((s, i) => `${i + 1}. [${s.title.replace(/[[\]]/g, "")}](${s.url})`),
    "",
    ...(gaps.length ? ["## What I could not confirm", "", ...gaps.map((g) => `- ${g}`), ""] : []),
    `_Researched ${today} with Google Search (free tier). Only lines Google tied to a page are kept._`,
  ].join("\n");
  return { state: "done", model, page: { title, summary, markdown, sources: numbered, gaps, status: gaps.length ? "partial" : "complete" } };
}
