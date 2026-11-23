#!/usr/bin/env node
/**
 * THE AI ANSWERS DUTY'S TWO CODE STEPS (her ask 22 Nov 2026; the rules: src/shared/boss/growth/aiAnswers.mjs).
 * scripts/ops/ai-visibility.sh runs, in order:
 *
 *   node ai-visibility-report.mjs context <context.txt> <state.json>
 *       Before the reading session. For each selling site: its search-loop `output.url_prefix` (the
 *       repo's search-loop.config.json, through gh), its sitemap (engine pages = under that prefix),
 *       the misses its loop strengthened (the newest `search-loop-week`, src/shared/boss/searchLoop/
 *       week.mjs `strengthenedOf`), and from Boss OS the open lanes and the channels each business
 *       holds. The session has no file or web tools, so this is written into its prompt.
 *
 *   node ai-visibility-report.mjs post <run.log> <state.json>
 *       After it. Reads the session's SITE-BEGIN/SITE-END blocks, checks each against that site's own
 *       pages (readSite with the sitemap: an OWN page is one of the site's engine pages, A3), and posts
 *       the week to POST /api/boss/growth/ai-week, where every count is recomputed again.
 *
 * MONEY (A8). The session prints OpenSEO's credits before and after: they must be equal (the duty only
 * reads) or it is NAMED STOP [OPENSEO_CREDITS_MOVED]; unread is [OPENSEO_CREDITS_UNREAD], never "fine".
 * The weekly estimate across all six sites over 500 credits is NAMED STOP [OPENSEO_OVER_PLAN] and an
 * Open Loops row (the intake), cleared again on a week within plan.
 *
 * RULE 0. Prints `OUTPUT <n> sites_read`. No site read at all → exit 9 with the named stops; a money
 * proof missing → exit 10. Run under the vault (BOSS_PASSCODE): `npm run vault:run -- node …`.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { AI_SITES, STOPS, creditsProblem, pageOnHost, planProblem, prefixOk, readSite } from "../../src/shared/boss/growth/aiAnswers.mjs";
import { strengthenedOf, weekFor } from "../../src/shared/boss/searchLoop/week.mjs";
import { fetchLoopWeeks } from "./lib/search-loop-week.mjs";
import { bossApi } from "./lib/duty-kit.mjs";
import { outputLine } from "../../src/shared/boss/alarms/rules.mjs";

const OWNER = "seq23";
const REPO = "seq23/boss-os";
const MAX_LISTED = 250;

/** The repo's search-loop url_prefix for this host, or a named problem. Exact host match on `site`. */
export function prefixFrom(config, host) {
  if (!config || typeof config !== "object") return { problem: "LOOP_CONFIG_UNREAD" };
  const site = String(config.site ?? config.domain ?? "").toLowerCase().replace(/^www\./, "");
  if (site !== host) return { prefix: null, note: `the repo's search loop is for ${site || "another site"}, not ${host}` };
  const p = config.output?.url_prefix;
  return prefixOk(p) ? { prefix: p } : { problem: "LOOP_CONFIG_UNREAD" };
}

/** Every <loc> in a sitemap or sitemap index. */
export const locsOf = (xml) => [...String(xml ?? "").matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));

/** The site's pages from its sitemap (an index is followed one level, up to 20 children). */
export async function sitePages(host, prefix, fetchImpl = fetch) {
  const get = async (u) => {
    const r = await fetchImpl(u, { signal: AbortSignal.timeout(20_000), headers: { "user-agent": "boss-os-ai-answers/1" } });
    if (!r.ok) throw new Error(`${u} → ${r.status}`);
    return r.text();
  };
  let xml;
  try { xml = await get(`https://${host}/sitemap.xml`); } catch { return { problem: "SITEMAP_UNREAD" }; }
  let locs = locsOf(xml);
  if (/<sitemapindex/i.test(xml)) {
    const kids = locs.filter((u) => pageOnHost(u, host)).slice(0, 20);
    locs = [];
    for (const k of kids) { try { locs.push(...locsOf(await get(k))); } catch { return { problem: "SITEMAP_UNREAD" }; } }
  }
  const all = [...new Set(locs.filter((u) => pageOnHost(u, host)))].slice(0, 5000);
  if (!all.length) return { problem: "SITEMAP_UNREAD" };
  const engine = prefix ? all.filter((u) => pageOnHost(u, host, prefix)) : [];
  return { engine, other: all.filter((u) => !engine.includes(u)) };
}

const ghJson = (path) => JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 << 20 }));
function loopConfig(repo) {
  try { return JSON.parse(Buffer.from(ghJson(`repos/${OWNER}/${repo}/contents/search-loop.config.json`).content, "base64").toString("utf8")); }
  catch { return null; }
}

/** The context step: one state entry per site, and the prompt's SITES section. */
export async function buildContext({ api, fetchImpl = fetch, config = loopConfig, loopWeeks = fetchLoopWeeks, now = Date.now() } = {}) {
  const lanes = await api.get("/growth/ai-lanes");
  const state = {};
  const parts = [];
  for (const [host, site] of Object.entries(AI_SITES)) {
    const s = { host, prefix: null, stop: null, notes: [], engine: [], other: [], strengthened: [] };
    if (site.loop) {
      const p = prefixFrom(config(site.repo), host);
      if (p.problem) s.stop = p.problem; else s.prefix = p.prefix;
      if (p.note) s.notes.push(p.note);
      const w = loopWeeks(site.repo, { now });
      const wk = w.problem ? null : weekFor(w.weeks, { domain: host, repo: site.repo, now });
      s.strengthened = wk?.week && !wk.problem ? strengthenedOf(wk.week) : [];
      if (!wk?.week || wk.problem) s.notes.push(`no usable search-loop week (${w.problem ?? wk?.problem ?? "none yet"}): no strengthened pages counted`);
    }
    if (!s.stop) {
      const pg = await sitePages(host, s.prefix, fetchImpl);
      if (pg.problem) s.stop = pg.problem; else { s.engine = pg.engine; s.other = pg.other; }
    }
    state[host] = s;
    const open = (lanes.lanes ?? []).filter((l) => l.site === host);
    parts.push([
      `### ${host}`,
      `CHANNELS: ${(lanes.channels?.[host] ?? []).join(", ") || "none"}`,
      `ENGINE PAGES:${s.engine.length ? "\n" + s.engine.slice(0, MAX_LISTED).join("\n") : " none"}`,
      `OTHER PAGES:${s.other.length ? "\n" + s.other.slice(0, MAX_LISTED).join("\n") : " none"}`,
      `OPEN LANES:${open.length ? "\n" + open.map((l) => `${l.prompt_id}: ${l.lane}`).join("\n") : " none"}`,
    ].join("\n"));
  }
  return { state, text: `## SITES\n\n${parts.join("\n\n")}\n` };
}

/** The session's log, read: each site's block (parsed JSON or a parse failure), credits, estimates. */
export function parseRun(log) {
  const text = String(log ?? "");
  const blocks = {};
  for (const m of text.matchAll(/^SITE-BEGIN (\S+)\s*\n([\s\S]*?)\nSITE-END \1\s*$/gm)) {
    const host = m[1].toLowerCase();
    if (!Object.hasOwn(AI_SITES, host) || Object.hasOwn(blocks, host)) continue;
    const body = m[2].trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    try { blocks[host] = { block: JSON.parse(body) }; } catch { blocks[host] = { stop: "OPENSEO_BAD_REPLY" }; }
  }
  const last = (re) => { const all = [...text.matchAll(re)]; return all.length ? Number(all.at(-1)[1]) : NaN; };
  const estimates = {};
  for (const m of text.matchAll(/^ESTIMATE (\S+) (\d+)\s*$/gm)) if (Object.hasOwn(AI_SITES, m[1].toLowerCase())) estimates[m[1].toLowerCase()] = Number(m[2]);
  return {
    blocks, estimates,
    before: last(/^CREDITS-BEFORE: (\d+)\s*$/gm), after: last(/^CREDITS-AFTER: (\d+)\s*$/gm),
    pluginMissing: /^NAMED STOP \[PLUGIN_NOT_LOADED\]/m.test(text),
  };
}

/** The week's entries for POST ai-week: the Mac's own check of each block, then the block as read. */
export function entriesFrom(run, state, now = Date.now()) {
  const out = [];
  for (const host of Object.keys(AI_SITES)) {
    const s = state[host] ?? { stop: "SITE_MISSING" };
    const b = run.blocks[host];
    if (run.pluginMissing) { out.push({ host, stop: "PLUGIN_NOT_LOADED" }); continue; }
    if (!b) { out.push({ host, stop: "SITE_MISSING" }); continue; }
    if (b.stop) { out.push({ host, stop: b.stop }); continue; }
    if (b.block?.stop) { out.push({ host, stop: STOPS[b.block.stop] ? b.block.stop : "OPENSEO_BAD_REPLY" }); continue; }
    if (s.stop) { out.push({ host, stop: s.stop }); continue; }
    const pages = { engine: new Set(s.engine), all: new Set([...s.engine, ...s.other]) };
    const r = readSite(b.block, { host, now, prefix: s.prefix, pages });
    if (r.status === "not_read") { out.push({ host, stop: r.stop, why: r.why }); continue; }
    // Only the lanes the sitemap check kept go on: a page that is not the site's own is gone here.
    const kept = new Map(r.misses.map((m) => [m.prompt_id, m]));
    const lanes = (Array.isArray(b.block.lanes) ? b.block.lanes : []).filter((l) => kept.has(String(l?.prompt_id))).map((l) => {
      const m = kept.get(String(l.prompt_id));
      return { prompt_id: m.prompt_id, lane: m.lane, page_url: m.page_url, fit_url: m.fit_url, source_domain: m.source_domain, channel: m.channel, why: m.why };
    });
    out.push({ host, block: { ...b.block, lanes }, prefix: s.prefix, strengthened: s.strengthened, notes: r.notes, read: { prompts: r.prompts, cited: r.cited } });
  }
  return out;
}

/** The `post` step; returns the exit code (0, 9 nothing read, 10 a money proof missing). `api` is for tests. */
export async function post(logFile, stateFile, { api } = {}) {
  const run = parseRun(readFileSync(logFile, "utf8"));
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  const entries = entriesFrom(run, state);
  const boss = api ?? await bossApi();
  const res = await boss.post("/growth/ai-week", { sites: entries.map(({ host, block, stop, prefix, strengthened }) => ({ host, block, stop, prefix, strengthened })) });
  let rc = 0;
  for (const s of res.sites ?? []) {
    if (s.status === "read") console.log(`READ ${s.host} ${s.week}: cited ${s.cited} of ${s.prompts}, named ${s.mentioned}; ${s.misses} not cited${s.unchanged ? " (same run, unchanged)" : ""}; ${(s.actions ?? []).map((a) => a.kind).join(", ") || "no new fixes"}`);
    else console.log(`NAMED STOP [${s.stop ?? "REFUSED"}] ${s.host}: ${s.why ?? STOPS[s.stop] ?? "not read"}`);
  }
  const read = res.read ?? 0;
  console.log(outputLine(read, "sites_read"));
  const money = creditsProblem(run.before, run.after);
  if (money) { console.log(money); rc = 10; }
  const plan = planProblem(run.estimates);
  if (plan.stop) {
    console.log(plan.stop);
    rc = rc || 10;
    if (plan.total !== null) await boss.post("/open-loops/intake", {
      repo: REPO, stop: "OPENSEO_OVER_PLAN", business: "spry", owner: "claude",
      title: `OpenSEO's weekly AI answers checks would cost ${plan.total} credits, over the 500 plan`,
      finish_line: "The six weekly checks together estimate 500 credits or less (fewer prompts, or her yes to more)",
      next_step: "Trim the largest tracker's prompts in OpenSEO, or ask her whether the plan grows",
    });
  } else {
    console.log(`weekly estimate ${plan.total} credits, within the 500 plan`);
    // Clearing an old over-plan row is best effort: a failed clear leaves her row open (never a false "fine").
    await boss.post("/open-loops/intake", { repo: REPO, stop: "OPENSEO_OVER_PLAN", cleared: true }).catch((e) => console.log(`note: the over-plan row could not be cleared (${String(e?.message ?? e).slice(0, 120)}); the next run retries`));
  }
  if (read === 0) { console.log("NAMED STOP [AI_ANSWERS_NOTHING_READ] no selling site's week was read; the scoreboard says 'not read' for each."); return 9; }
  return rc;
}

async function main(argv) {
  const [cmd, a, b] = argv;
  if (cmd === "context") {
    const { state, text } = await buildContext({ api: await bossApi() });
    writeFileSync(a, text); writeFileSync(b, JSON.stringify(state));
    for (const s of Object.values(state)) console.log(`CONTEXT ${s.host}: ${s.stop ? `NAMED STOP [${s.stop}]` : `${s.engine.length} engine pages, ${s.other.length} other`}, ${s.strengthened.length} strengthened${s.notes.length ? `; ${s.notes.join("; ")}` : ""}`);
    return 0;
  }
  if (cmd === "post") return post(a, b);
  console.error("usage: ai-visibility-report.mjs context <context.txt> <state.json> | post <run.log> <state.json>");
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then((rc) => process.exit(rc), (e) => { console.error(String(e?.message ?? e)); process.exit(/NAMED STOP/.test(String(e?.message)) ? 3 : 1); });
}
