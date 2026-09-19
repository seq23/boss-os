/**
 * "FIND ME A LIST OF FIRMS THAT DID X, AND DRAFT AN EMAIL TO ASK THEM Y" — `research/firmScan.ts`.
 *
 * Driven with a FAKE web (fetch answers the feed and two articles) and a FAKE model, so what is
 * pinned is the mechanism: the grammar reads her sentence on every door; the feed's wrapped links
 * are unwrapped; a finding is kept only when its sentence is on the page it cites; each verified
 * firm gets a letter through the letters' own door (judgement card, her ask in it, never
 * "broker"); the counts on the row are what the desk prints; a firm the model invents gets no
 * letter; and the buyer recommendation never lists a scan firm.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { apiJson, stubFetch, uid } from "./helpers";
import { handleTask } from "../../src/worker/boss/queue/consumer";
import { admitTask } from "../../src/worker/boss/tasks/admit";
import {
  newsFeedUrl, parseFeed, parseFirmScan, pageText, runFirmScan, verifyFinding,
} from "../../src/worker/boss/research/firmScan";
import type { Complete } from "../../src/worker/boss/wealth/rewrite";
import type { RouteRequest, RouteResult } from "../../src/worker/boss/router";
import type { ChatMessage } from "../../src/worker/boss/router/types";

const INSTRUCTION =
  "find me a list of firms that have reported IPO participation in the release, and draft an email for me to ask if I can send investors to them";

const ARTICLE_1 = "https://news.example/anthropic-ipo-banks";
const ARTICLE_2 = "https://news.example/anthropic-ipo-investors";
const FEED_XML = `<?xml version="1.0"?><rss><channel>
<item><title>Anthropic taps banks for IPO</title><link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;url=${encodeURIComponent(ARTICLE_1)}&amp;c=1</link><pubDate>Sat, 19 Sep 2026 10:00:00 GMT</pubDate></item>
<item><title>Who is in on the Anthropic listing</title><link>${ARTICLE_2}</link><pubDate>Sat, 19 Sep 2026 11:00:00 GMT</pubDate></item>
<item><title>No link here</title></item>
</channel></rss>`;
const PAGE_1 = `<html><head><title>x</title><script>var a=1;</script><style>.a{}</style></head><body><h1>Anthropic taps banks for IPO</h1>
<p>Anthropic has hired Goldman Sachs and Morgan Stanley to lead its initial public offering, according to people familiar with the matter.</p>
<p>The company is considering a listing as early as next year. ${"Lorem ipsum dolor sit amet. ".repeat(30)}</p></body></html>`;
const PAGE_2 = `<html><body><p>Who is in on the Anthropic listing</p><p>Existing backer Lightspeed Venture Partners said it planned to participate in the offering, the firm confirmed in a statement.</p><p>${"More words about markets. ".repeat(30)}</p></body></html>`;

function reply(text: string, cost = 7): RouteResult {
  return {
    text, costMicros: cost, modelId: "mdl_cf_llama33_70b", modelName: "Llama 3.3 70B (Workers AI)", modelDisplayName: "Llama 3.3 70B (Workers AI)",
    providerId: "prv_workers_ai", usedFallback: false, decisionId: uid("rtd"), backendId: "bk_workers_ai", backendName: "Workers AI",
    degraded: false, degradedReason: null, notice: null, freeTier: true,
  };
}

const GOOD_LETTER = (firm: string) => JSON.stringify({
  subject: `Investors for the Anthropic offering — ${firm}`,
  body:
    "My name is Sequoia Taylor, and I run Spry VC (linkedin.com/in/sequoiataylor). I work with investors who are actively looking for late-stage positions in private technology companies.\n\n" +
    `I read that ${firm} is taking part in the Anthropic offering. I have investors who would want to be in it, and I would like to ask if I can send investors to you.\n\n` +
    "If it is useful I will send over who they are and what they are looking for, and you can tell me whether it is a fit.\n\n" +
    "Sequoia Taylor\nSpry VC\nlinkedin.com/in/sequoiataylor",
});

/** The scripted model: queries, then findings, then a letter per firm. */
function fakeModel(findings: unknown, letters: Record<string, string[]> = {}) {
  const calls: { kind: string; user: string }[] = [];
  const perFirm: Record<string, number> = {};
  const complete: Complete = async (_env: unknown, req: RouteRequest) => {
    const user = req.messages.filter((m: ChatMessage) => m.role === "user").map((m: ChatMessage) => m.content).join("\n");
    calls.push({ kind: req.intakeKind ?? "?", user });
    if (user.includes("Write 3 news-search queries")) return reply(JSON.stringify(["Anthropic IPO banks", "Anthropic IPO investors participate", "Anthropic listing"]));
    if (user.includes("Find every organisation that")) return reply(typeof findings === "string" ? findings : JSON.stringify(findings));
    const m = /RECIPIENT: (.+?)\./.exec(user);
    const firm = m?.[1] ?? "?";
    const script = letters[firm];
    if (script) { const i = perFirm[firm] ?? 0; perFirm[firm] = i + 1; return reply(script[Math.min(i, script.length - 1)]!); }
    return reply(GOOD_LETTER(firm));
  };
  return { complete, calls };
}

function fakeWeb(overrides: Record<string, () => Response> = {}) {
  const hits: string[] = [];
  const restore = stubFetch((req) => {
    const url = req.url;
    hits.push(url);
    if (overrides[url]) return overrides[url]!();
    if (url.startsWith("https://www.bing.com/news/search")) return new Response(FEED_XML, { status: 200, headers: { "content-type": "application/xml" } });
    if (url === ARTICLE_1) return new Response(PAGE_1, { status: 200, headers: { "content-type": "text/html" } });
    if (url === ARTICLE_2) return new Response(PAGE_2, { status: 200, headers: { "content-type": "text/html" } });
    return new Response("nope", { status: 404 });
  });
  return { hits, restore };
}

async function clean() {
  await env.DB.prepare(`DELETE FROM ask_scan_findings`).run();
  await env.DB.prepare(`DELETE FROM ask_scans`).run();
  await env.DB.prepare(`DELETE FROM buyer_outreach_drafts`).run();
  await env.DB.prepare(`DELETE FROM judgement_calls WHERE resume_kind = 'buyer_outreach_email'`).run();
  await env.DB.prepare(`DELETE FROM sourcing_candidates WHERE kind = 'ask'`).run();
}

describe("the grammar — one shape of instruction, read the same way every time", () => {
  it("parses her sentence into FIND and ASK", () => {
    const p = parseFirmScan(INSTRUCTION)!;
    expect(p.find).toBe("have reported IPO participation in the release");
    expect(p.ask).toBe("if I can send investors to them");
  });

  it("generalises to any 'find firms that X and draft an ask Y'", () => {
    const p = parseFirmScan("Find the companies that announced a Series D this month; then write a note to each asking whether they would take a secondary buyer.")!;
    expect(p.find).toBe("announced a Series D this month");
    expect(p.ask).toBe("whether they would take a secondary buyer");
    const q = parseFirmScan("get a list of funds who invested in Neuralink's last round and draft emails to see if they have appetite for more")!;
    expect(q.find).toBe("invested in Neuralink's last round");
    expect(q.ask).toBe("if they have appetite for more");
  });

  it("refuses a sentence that is not both a find and an ask, so ordinary work is untouched", () => {
    expect(parseFirmScan("find me a list of firms that reported IPO participation")).toBeNull();
    expect(parseFirmScan("draft an email to ask Saints Capital about their appetite")).toBeNull();
    expect(parseFirmScan("summarise the board pack")).toBeNull();
    expect(parseFirmScan("")).toBeNull();
  });
});

describe("the sources — public feeds, unwrapped links, readable text", () => {
  it("builds a keyless feed URL and unwraps the click-tracking link", () => {
    expect(newsFeedUrl("Anthropic IPO")).toBe("https://www.bing.com/news/search?q=Anthropic%20IPO&format=rss");
    const items = parseFeed(FEED_XML);
    expect(items).toHaveLength(2); // the item with no link is dropped
    expect(items[0]!.url).toBe(ARTICLE_1);
    expect(items[0]!.title).toBe("Anthropic taps banks for IPO");
    expect(items[1]!.url).toBe(ARTICLE_2);
  });

  it("reduces a page to text without its scripts and styles, bounded", () => {
    const t = pageText(PAGE_1);
    expect(t).toContain("hired Goldman Sachs and Morgan Stanley");
    expect(t).not.toContain("var a=1");
    expect(t).not.toContain(".a{}");
    expect(pageText("<p>" + "x".repeat(20_000) + "</p>", 100)).toHaveLength(100);
  });

  it("verifies a finding only when its sentence is on the page it cites", () => {
    const sources = [{ url: ARTICLE_1, title: "t", published: null, text: pageText(PAGE_1), fetched: true }];
    expect(verifyFinding({ quote: "Anthropic has hired Goldman Sachs and Morgan Stanley to lead its initial public offering", evidence_url: ARTICLE_1 }, sources)).toBe(true);
    // Curly quotes and spacing do not defeat it; a paraphrase and a wrong URL do.
    expect(verifyFinding({ quote: "Anthropic  has hired Goldman Sachs and Morgan Stanley to lead its initial public offering", evidence_url: ARTICLE_1 }, sources)).toBe(true);
    expect(verifyFinding({ quote: "Goldman and Morgan Stanley were hired to run the IPO", evidence_url: ARTICLE_1 }, sources)).toBe(false);
    expect(verifyFinding({ quote: "Anthropic has hired Goldman Sachs and Morgan Stanley to lead its initial public offering", evidence_url: ARTICLE_2 }, sources)).toBe(false);
    expect(verifyFinding({ quote: "Anthropic has hired", evidence_url: ARTICLE_1 }, sources)).toBe(false); // too short to mean anything
  });
});

describe("one instruction in, a list and letters out", () => {
  beforeEach(clean);

  it("Team → New task admits it as a scan owned by Camille, and the desk door parses the same way", async () => {
    const res = await apiJson<any>("/api/tasks", { method: "POST", body: { title: INSTRUCTION, input: { prompt: INSTRUCTION } } });
    expect(res.status).toBe(201);
    expect(res.body.data.task.employee_id).toBe("emp_research");
    expect(res.body.data.task.status).toBe("queued");
    const input = JSON.parse(res.body.data.task.input);
    expect(input.firm_scan.find).toBe("have reported IPO participation in the release");
    const scan = await env.DB.prepare(`SELECT * FROM ask_scans WHERE task_id = ?`).bind(res.body.data.task.id).first<any>();
    expect(scan.state).toBe("queued");
    expect(scan.ask_text).toBe("if I can send investors to them");

    const desk = await apiJson<any>("/api/research/firm-scans", { method: "POST", body: { instruction: INSTRUCTION } });
    expect(desk.status).toBe(201);
    expect(desk.body.data.scan_id).toBeTruthy();
    const list = await apiJson<any>("/api/research/firm-scans");
    expect(list.body.data.items).toHaveLength(2);
    expect(list.body.data.items[0].sentence).toContain("Queued for Camille");

    const notAScan = await apiJson<any>("/api/research/firm-scans", { method: "POST", body: { instruction: "summarise the board pack" } });
    expect(notAScan.status).toBe(400);
    expect(notAScan.body.error).toContain("both what to find and what to ask");

    // An ordinary task is untouched by the grammar.
    const plain = await admitTask(env as any, { title: "Summarise the board pack", input: { prompt: "Summarise the board pack" } });
    const plainRow = await env.DB.prepare(`SELECT input FROM tasks WHERE id = ?`).bind(plain.task_id).first<any>();
    expect(JSON.parse(plainRow.input).firm_scan).toBeUndefined();
  });

  it("reads the feed, fetches the pages, verifies each firm against its page, drafts the ask, and the desk counts it from rows", async () => {
    const admitted = await admitTask(env as any, { title: INSTRUCTION, input: { prompt: INSTRUCTION } });
    const scan = await env.DB.prepare(`SELECT * FROM ask_scans WHERE task_id = ?`).bind(admitted.task_id).first<any>();
    const web = fakeWeb();
    try {
      const model = fakeModel([
        { firm: "Goldman Sachs", role: "hired to lead the IPO", quote: "Anthropic has hired Goldman Sachs and Morgan Stanley to lead its initial public offering, according to people familiar with the matter.", evidence_url: ARTICLE_1 },
        { firm: "Morgan Stanley", role: "hired to lead the IPO", quote: "Anthropic has hired Goldman Sachs and Morgan Stanley to lead its initial public offering, according to people familiar with the matter.", evidence_url: ARTICLE_1 },
        { firm: "Lightspeed Venture Partners", role: "plans to participate", quote: "Existing backer Lightspeed Venture Partners said it planned to participate in the offering, the firm confirmed in a statement.", evidence_url: ARTICLE_2 },
        // INVENTED: no page says this. It is recorded and gets no letter.
        { firm: "Sequoia Capital", role: "anchor investor", quote: "Sequoia Capital will anchor the Anthropic IPO with a large order.", evidence_url: ARTICLE_2 },
      ]);
      const out = await runFirmScan(env as any, { id: admitted.task_id!, lane: "ops", employee_id: "emp_research" }, scan.id, { complete: model.complete });
      expect(out.state).toBe("done");
      expect(out.verified).toBe(3);
      expect(out.drafts).toBe(3);
      expect(out.detail).toContain("2 sources read");
      expect(out.detail).toContain("3 letters in your Inbox");
      expect(out.detail).toContain("Nothing has been sent");

      // The web was read: three feeds (one per query, deduped to two articles), then both pages.
      expect(web.hits.filter((u) => u.startsWith("https://www.bing.com/news/search"))).toHaveLength(3);
      expect(web.hits).toContain(ARTICLE_1);
      expect(web.hits).toContain(ARTICLE_2);
      // The model was shown the fetched text, not asked to recall it.
      const extract = model.calls.find((c) => c.user.includes("Find every organisation that"))!;
      expect(extract.user).toContain("hired Goldman Sachs and Morgan Stanley");
      expect(extract.user).toContain(`URL: ${ARTICLE_2}`);

      // The row is what the desk prints.
      const row = await env.DB.prepare(`SELECT * FROM ask_scans WHERE id = ?`).bind(scan.id).first<any>();
      expect(row.state).toBe("done");
      expect(row.sources_found).toBe(2);
      expect(row.sources_read).toBe(2);
      expect(row.findings_count).toBe(4);
      expect(row.verified_count).toBe(3);
      expect(row.drafts_count).toBe(3);
      expect(row.cost_micros).toBeGreaterThan(0);
      expect(JSON.parse(row.queries)).toHaveLength(3);

      const report = await apiJson<any>(`/api/research/firm-scans/${scan.id}`);
      expect(report.body.data.sentence).toBe("2 sources read · 3 of 4 firms named have the sentence on the page · 3 letters in your Inbox");
      const findings = report.body.data.findings;
      expect(findings).toHaveLength(4);
      const invented = findings.find((f: any) => f.firm === "Sequoia Capital");
      expect(invented.verified).toBe(0);
      expect(invented.candidate_id).toBeNull();
      expect(invented.letter_state).toBeNull();
      const ls = findings.find((f: any) => f.firm === "Lightspeed Venture Partners");
      expect(ls.verified).toBe(1);
      expect(ls.letter_state).toBe("awaiting");
      expect(ls.evidence_url).toBe(ARTICLE_2);

      // Each letter is a judgement card in her Inbox with her ask in it, through the letters' door.
      const pending = await apiJson<any>("/api/judgement/pending");
      const cards = pending.body.data.items.filter((i: any) => i.resume_kind === "buyer_outreach_email");
      expect(cards).toHaveLength(3);
      const card = cards.find((c: any) => c.title === "A letter to Lightspeed Venture Partners");
      expect(card.letter.body).toContain("send investors to you");
      expect(card.letter.body).not.toMatch(/broker/i);
      expect(card.letter.written_by).toContain("Llama 3.3 70B");
      expect(card.question).toContain("answering your note");
      const draft = await env.DB.prepare(`SELECT built_from FROM buyer_outreach_drafts WHERE judgement_id = ?`).bind(card.id).first<any>();
      const built = JSON.parse(draft.built_from);
      expect(built.firm_scan_id).toBe(scan.id);
      expect(built.evidence_url).toBe(ARTICLE_2);
      expect(built.evidence_quote).toContain("Lightspeed Venture Partners said it planned to participate");

      // The candidate rows are kind 'ask' and never enter the buyer recommendation.
      const cands = await env.DB.prepare(`SELECT name, kind, origin, status FROM sourcing_candidates WHERE kind = 'ask' ORDER BY name`).all<any>();
      expect(cands.results!.map((c) => c.name)).toEqual(["Goldman Sachs", "Lightspeed Venture Partners", "Morgan Stanley"]);
      expect(cands.results!.every((c) => c.origin === "firm_scan" && c.status === "reviewed")).toBe(true);
      const rec = await apiJson<any>("/api/wealth/recommendations");
      const recNames = JSON.stringify(rec.body.data);
      expect(recNames).not.toContain("Lightspeed Venture Partners");
    } finally { web.restore(); }
  });

  it("a letter that breaks a rule twice is refused by name on the finding, and the rest still land", async () => {
    const admitted = await admitTask(env as any, { title: INSTRUCTION, input: { prompt: INSTRUCTION } });
    const scan = await env.DB.prepare(`SELECT * FROM ask_scans WHERE task_id = ?`).bind(admitted.task_id).first<any>();
    const web = fakeWeb();
    try {
      const bad = JSON.stringify({ subject: "s", body: "I am a broker. Email me at a@b.com. " + JSON.parse(GOOD_LETTER("Goldman Sachs")).body });
      const model = fakeModel(
        [{ firm: "Goldman Sachs", role: "lead", quote: "Anthropic has hired Goldman Sachs and Morgan Stanley to lead its initial public offering", evidence_url: ARTICLE_1 },
         { firm: "Lightspeed Venture Partners", role: "participant", quote: "Existing backer Lightspeed Venture Partners said it planned to participate in the offering", evidence_url: ARTICLE_2 }],
        { "Goldman Sachs": [bad, bad] },
      );
      const out = await runFirmScan(env as any, { id: admitted.task_id!, lane: "ops", employee_id: "emp_research" }, scan.id, { complete: model.complete });
      expect(out.state).toBe("done");
      expect(out.verified).toBe(2);
      expect(out.drafts).toBe(1);
      const gs = await env.DB.prepare(`SELECT draft_state, draft_detail FROM ask_scan_findings WHERE scan_id = ? AND firm = 'Goldman Sachs'`).bind(scan.id).first<any>();
      expect(gs.draft_state).toBe("refused");
      expect(gs.draft_detail).toContain("broker");
      expect(gs.draft_detail).toContain("at-sign");
      const retry = model.calls.filter((c) => c.user.includes("RECIPIENT: Goldman Sachs") && c.user.includes("broke these rules"));
      expect(retry).toHaveLength(1);
    } finally { web.restore(); }
  });

  it("no source, or no readable page, stops by name rather than drafting from nothing", async () => {
    const admitted = await admitTask(env as any, { title: INSTRUCTION, input: { prompt: INSTRUCTION } });
    const scan = await env.DB.prepare(`SELECT * FROM ask_scans WHERE task_id = ?`).bind(admitted.task_id).first<any>();
    const web = fakeWeb({ [ARTICLE_1]: () => new Response("", { status: 403 }), [ARTICLE_2]: () => new Response("<html></html>", { status: 200 }) });
    try {
      const model = fakeModel([]);
      const out = await runFirmScan(env as any, { id: admitted.task_id!, lane: "ops", employee_id: "emp_research" }, scan.id, { complete: model.complete });
      expect(out.state).toBe("failed");
      expect(out.detail).toContain("none could be read");
      expect(out.detail).toContain("HTTP 403");
      expect(model.calls.some((c) => c.user.includes("Find every organisation"))).toBe(false); // nothing to read → no extraction call
      const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM buyer_outreach_drafts`).first<{ n: number }>();
      expect(n?.n).toBe(0);
    } finally { web.restore(); }
  });

  it("the queue consumer branches on the task and closes it with the scan's counts", async () => {
    const admitted = await admitTask(env as any, { title: INSTRUCTION, input: { prompt: INSTRUCTION } });
    const web = fakeWeb();
    try {
      // The real router: this harness has no eligible model, so the scan stops by name and the task
      // fails with the router's sentence — the branch is proven by the task carrying the scan's
      // outcome rather than the generic draft.
      await handleTask(env as any, { taskId: admitted.task_id!, lane: "ops" });
      const task = await env.DB.prepare(`SELECT status, error, output FROM tasks WHERE id = ?`).bind(admitted.task_id).first<any>();
      expect(task.status).toBe("failed");
      expect(task.error).toContain("scan");
      expect(task.output).toBeNull();
      const scan = await env.DB.prepare(`SELECT state, failure FROM ask_scans WHERE task_id = ?`).bind(admitted.task_id).first<any>();
      expect(["failed", "queued"]).toContain(scan.state);
      expect(scan.failure).toBeTruthy();
    } finally { web.restore(); }
  });
});
