#!/usr/bin/env node
/**
 * THE CLICK-THROUGH ~/bin/land ASKS FOR, DONE BY DANIELLE'S LANE (17 Nov 2026).
 *
 * ~/bin/land refuses a PR that changes a screen people operate (src/client/**, *.tsx|jsx|vue|svelte)
 * unless its body or a comment carries a "Clicked through:" line (owner, 6 Nov 2026, after the P&P
 * request form shipped green with a script that never ran). Nothing in the Search Readiness fix run
 * ever wrote that line, so detoxdenver.org's PR #18 (components/ClarityLoader.tsx) was refused in
 * every round of the 17 Nov run and the run stopped SR_QUEUE_STALLED with 2 briefs left.
 *
 * This does the click-through honestly, on the PR's own preview:
 *   1. the preview URL is read from the Cloudflare Pages comment (only when its "Latest commit" is the
 *      PR head; the Branch Preview URL, else the commit Preview URL), else from a GitHub deployment of
 *      the head sha. Neither readable -> NAMED STOP [PREVIEW_URL_UNREAD]: never a guessed host;
 *   2. each path opens at 390 px in the ONE shared launcher (browser.mjs, profile "danielle"); console
 *      errors, page errors and failed same-site requests are collected; every in-page <button> and
 *      <summary> that does not navigate is clicked, and the console is read again;
 *   3. clean -> the PR gets one comment, "Clicked through: <paths> at 390 px in Chrome; console clean;
 *      N controls clicked (automated, Danielle's lane)", and this exits 0. Dirty -> the errors are
 *      printed and it exits 3, so the PR is not landed and the next round's worker has a real defect.
 * Rule 0: zero paths, or zero pages loaded, is a named stop, never exit 0.
 *
 *   node scripts/ops/clickthrough.mjs <pr-url> [--paths /,/contact/] [--dry]
 *   node scripts/ops/clickthrough.mjs --self-test
 *
 * Exit codes: 0 clicked through and commented; 2 PREVIEW_URL_UNREAD / no paths; 3 CLICKTHROUGH_DIRTY;
 * 4 BROWSER_UNAVAILABLE; 5 COMMENT_NOT_POSTED.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PR_URL = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)$/;

/** The preview URL of the PR's head, from the Cloudflare Pages comment or a deployment; null = unread. */
export function previewUrlFrom({ head, comments = [], deployments = [] } = {}) {
  if (!/^[0-9a-f]{7,40}$/.test(String(head ?? ""))) return null;
  for (const body of [...comments].reverse().map((c) => String(c?.body ?? c ?? ""))) {
    if (!/Cloudflare Pages/i.test(body)) continue;
    const commit = /Latest commit:[\s\S]*?<code>([0-9a-f]{7,40})<\/code>/i.exec(body)?.[1];
    if (!commit || !head.startsWith(commit) || !/Deploy successful/i.test(body)) continue;
    const pick = (label) => new RegExp(`<strong>${label}:</strong>[\\s\\S]*?href='(https://[^']+)'`, "i").exec(body)?.[1];
    const url = pick("Branch Preview URL") ?? pick("Preview URL");
    if (url) return url.replace(/\/+$/, "");
  }
  const dep = deployments.find((d) => d?.sha === head && /^https:\/\//.test(String(d?.environment_url ?? "")));
  return dep ? String(dep.environment_url).replace(/\/+$/, "") : null;
}

/**
 * Which paths to click: "/" always, then any page URL or "/path/" named on the brief rows (never /admin),
 * at most five. Rows = findings rows of the PR ({ pages, headline, because }).
 */
export function pathsFrom(rows = []) {
  const out = ["/"];
  for (const r of rows) {
    for (const p of r?.pages ?? []) { try { out.push(new URL(p).pathname); } catch { if (String(p).startsWith("/")) out.push(String(p)); } }
    for (const m of `${r?.headline ?? ""} ${r?.because ?? ""}`.matchAll(/(?:^|[\s("'`])(\/[a-z0-9][a-z0-9\-/]*\/)(?=[\s)"'`,.;:]|$)/gi)) out.push(m[1]);
  }
  return [...new Set(out)].filter((p) => !/^\/admin(\/|$)/i.test(p)).slice(0, 5);
}

/** The verdict over each page's record { path, loaded, errors[], clicked }. */
export function verdict(pages) {
  if (!pages.length) return { ok: false, code: "NOTHING_CLICKED", why: "no path was given, so nothing was clicked" };
  const unloaded = pages.filter((p) => !p.loaded);
  if (unloaded.length === pages.length) return { ok: false, code: "NOTHING_CLICKED", why: `no page loaded (${unloaded.map((p) => `${p.path}: ${p.errors[0] ?? "no answer"}`).join("; ")})` };
  const dirty = pages.filter((p) => !p.loaded || p.errors.length);
  if (dirty.length) return { ok: false, code: "CLICKTHROUGH_DIRTY", why: dirty.map((p) => `${p.path}: ${(p.errors.length ? p.errors : ["did not load"]).slice(0, 3).join(" | ")}`).join("; ").slice(0, 600) };
  const clicked = pages.reduce((n, p) => n + p.clicked, 0);
  return { ok: true, code: "CLICKED_THROUGH", line: `Clicked through: ${pages.map((p) => p.path).join(", ")} at 390 px in Chrome; console clean; ${clicked} control${clicked === 1 ? "" : "s"} clicked (automated, Danielle's lane)` };
}

function gh(args) {
  const r = spawnSync("gh", args, { encoding: "utf8", timeout: 60_000 });
  return { status: r.status ?? 1, out: `${r.stdout ?? ""}`, err: `${r.stderr ?? ""}` };
}

/** Open one path at 390 px, collect errors, click the in-page controls, read again. */
async function clickPath(context, base, path) {
  const rec = { path, loaded: false, errors: [], clicked: 0 };
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  const host = new URL(base).host;
  page.on("console", (m) => { if (m.type() === "error") rec.errors.push(`console: ${m.text().slice(0, 160)}`); });
  page.on("pageerror", (e) => rec.errors.push(`page error: ${String(e?.message ?? e).slice(0, 160)}`));
  page.on("requestfailed", (q) => { try { if (new URL(q.url()).host === host) rec.errors.push(`request failed: ${new URL(q.url()).pathname} (${q.failure()?.errorText ?? "?"})`); } catch { /* not a URL */ } });
  page.on("response", (res) => { try { if (new URL(res.url()).host === host && res.status() >= 400) rec.errors.push(`HTTP ${res.status()}: ${new URL(res.url()).pathname}`); } catch { /* not a URL */ } });
  try {
    await page.goto(base + path, { waitUntil: "load", timeout: 45_000 });
    rec.loaded = true;
    await page.waitForTimeout(1500);
    const controls = page.locator("button:visible, summary:visible");
    const n = Math.min(await controls.count(), 12);
    for (let i = 0; i < n; i++) {
      const el = controls.nth(i);
      // A submit button inside a form would send it: never clicked.
      if (await el.evaluate((b) => b.tagName === "BUTTON" && (b.type || "submit") === "submit" && !!b.closest("form")).catch(() => true)) continue;
      const before = page.url();
      await el.click({ timeout: 3000, trial: false }).then(() => { rec.clicked += 1; }).catch(() => {});
      await page.waitForTimeout(300);
      if (page.url() !== before) { await page.goto(base + path, { waitUntil: "load", timeout: 45_000 }).catch(() => {}); break; }
    }
    await page.waitForTimeout(800);
  } catch (err) {
    rec.errors.push(`did not load: ${String(err?.message ?? err).split("\n")[0].slice(0, 160)}`);
  }
  await page.close().catch(() => {});
  return rec;
}

function stop(code, why, exit) {
  console.log(`NAMED STOP [${code}] ${why}`);
  process.exit(exit);
}

async function main(argv) {
  const url = argv.find((a) => PR_URL.test(a));
  const flag = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1]; };
  if (!url) stop("NOTHING_CLICKED", "usage: clickthrough.mjs <https://github.com/owner/repo/pull/N> [--paths /,/contact/]", 2);
  const [, slug, num] = PR_URL.exec(url);
  const view = gh(["pr", "view", url, "--json", "headRefOid,comments"]);
  let pr = null; try { pr = view.status === 0 ? JSON.parse(view.out) : null; } catch { /* unread */ }
  if (!pr?.headRefOid) stop("PREVIEW_URL_UNREAD", `${url} could not be read (${(view.err || view.out).trim().slice(0, 160)}), so its preview is unknown`, 2);
  let deployments = [];
  const deps = gh(["api", `repos/${slug}/deployments?sha=${pr.headRefOid}&per_page=5`, "--jq", ".[] | [.sha, .statuses_url] | @tsv"]);
  for (const line of deps.status === 0 ? deps.out.split("\n").filter(Boolean) : []) {
    const [sha, statuses] = line.split("\t");
    const st = gh(["api", statuses, "--jq", "[.[] | select(.state == \"success\") | .environment_url][0] // empty"]);
    if (st.status === 0 && st.out.trim()) deployments.push({ sha, environment_url: st.out.trim() });
  }
  const base = previewUrlFrom({ head: pr.headRefOid, comments: pr.comments, deployments });
  if (!base) stop("PREVIEW_URL_UNREAD", `no preview of ${url}'s head ${pr.headRefOid.slice(0, 7)} was found (no successful Cloudflare Pages comment for that commit, no deployment), so nothing was clicked`, 2);
  const paths = (flag("paths") ?? "/").split(",").map((p) => p.trim()).filter((p) => p.startsWith("/"));
  if (!paths.length) stop("NOTHING_CLICKED", "no path to click", 2);

  let context;
  try {
    const { openProfile } = await import("./browser.mjs");
    ({ context } = await openProfile("danielle"));
  } catch (err) {
    stop("BROWSER_UNAVAILABLE", `Chrome could not be started for danielle: ${String(err?.message ?? err).slice(0, 200)}`, 4);
  }
  const pages = [];
  try { for (const p of paths) pages.push(await clickPath(context, base, p)); } finally { await context.close().catch(() => {}); }
  for (const p of pages) console.log(`  ${p.path}: ${p.loaded ? "loaded" : "NOT loaded"}, ${p.clicked} clicked, ${p.errors.length} error(s)${p.errors.length ? ` — ${p.errors.slice(0, 3).join(" | ")}` : ""}`);
  const v = verdict(pages);
  if (!v.ok) stop(v.code, `${url} on ${base}: ${v.why}`, v.code === "NOTHING_CLICKED" ? 2 : 3);
  if (argv.includes("--dry")) { console.log(`DRY ${v.line}`); process.exit(0); }
  const posted = gh(["pr", "comment", url, "--body", `${v.line}\n\nPreview: ${base} (head ${pr.headRefOid.slice(0, 7)}).`]);
  if (posted.status !== 0) stop("COMMENT_NOT_POSTED", `${url} was clicked through clean but the comment did not post: ${(posted.err || posted.out).trim().slice(0, 160)}`, 5);
  console.log(`CLICKED_THROUGH ${url} #${num}: ${v.line}`);
}

function selfTest() {
  const assert = (c, m) => { if (!c) { console.error(`SELF-TEST FAILED: ${m}`); process.exit(1); } };
  const cf = (commit, status = "✅&nbsp; Deploy successful!") => `## Deploying x with Cloudflare Pages\n<table><tr><td><strong>Latest commit:</strong> </td><td>\n<code>${commit}</code>\n</td></tr>\n<tr><td><strong>Status:</strong></td><td>${status}</td></tr>\n<tr><td><strong>Preview URL:</strong></td><td>\n<a href='https://e401.x.pages.dev'>https://e401.x.pages.dev</a>\n</td></tr>\n<tr><td><strong>Branch Preview URL:</strong></td><td>\n<a href='https://br.x.pages.dev'>https://br.x.pages.dev</a>\n</td></tr></table>`;
  const head = "f6e33e52303798239c32af24b81a6818ef6e2d16";
  assert(previewUrlFrom({ head, comments: [{ body: cf("f6e33e5") }] }) === "https://br.x.pages.dev", "the Branch Preview URL of the head commit");
  assert(previewUrlFrom({ head, comments: [{ body: cf("0051718") }] }) === null, "a preview of an older commit is never used");
  assert(previewUrlFrom({ head, comments: [{ body: cf("f6e33e5", "❌ Deploy failed") }] }) === null, "a failed deploy is never used");
  assert(previewUrlFrom({ head, deployments: [{ sha: head, environment_url: "https://d.example.dev/" }] }) === "https://d.example.dev", "a deployment of the head");
  assert(previewUrlFrom({ head, deployments: [{ sha: "abc", environment_url: "https://d.example.dev" }] }) === null, "another sha's deployment is never used");
  assert(previewUrlFrom({ head: "", comments: [{ body: cf("f6e33e5") }] }) === null, "no head, no preview");
  assert(JSON.stringify(pathsFrom([{ because: "renders a loader into the /contact/ HTML (never on /admin/); /about/ gets an H2" }])) === JSON.stringify(["/", "/contact/", "/about/"]), "paths from the brief, /admin never");
  assert(JSON.stringify(pathsFrom([{ pages: ["https://x.org/a/b/"] }])) === JSON.stringify(["/", "/a/b/"]), "paths from page URLs");
  assert(verdict([]).code === "NOTHING_CLICKED", "zero pages is a named stop");
  assert(verdict([{ path: "/", loaded: false, errors: ["timeout"], clicked: 0 }]).code === "NOTHING_CLICKED", "nothing loaded is a named stop");
  assert(verdict([{ path: "/", loaded: true, errors: ["console: x is undefined"], clicked: 1 }]).code === "CLICKTHROUGH_DIRTY", "a console error is dirty");
  const ok = verdict([{ path: "/", loaded: true, errors: [], clicked: 2 }, { path: "/contact/", loaded: true, errors: [], clicked: 0 }]);
  assert(ok.ok && /^Clicked through: \/, \/contact\/ at 390 px in Chrome; console clean; 2 controls clicked/.test(ok.line), "the clean line satisfies land's gate");
  console.log("clickthrough self-test: 12 checks passed");
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) selfTest();
  else main(argv).catch((err) => stop("BROWSER_UNAVAILABLE", `unexpected failure: ${String(err?.message ?? err).slice(0, 300)}`, 4));
}
