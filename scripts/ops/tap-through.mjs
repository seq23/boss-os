#!/usr/bin/env node
/**
 * THE APP TAP-THROUGH (owner, 22 Nov 2026: "we have like a factory standard that we live by and all our
 * shipped out things are up to our standard"; "add a real tap-through step for apps": "yes to all").
 * Before an app change ships, a robot taps through the app's free web preview like a person, at phone
 * size (390 px) in light and dark: every journey in the app's flow file (`tap-through.json` at the app
 * repo's root), every control on each swept screen, the paid and hidden states through preview flags.
 * It records one video per journey and a screenshot per step, and fails BY NAME on:
 *   DEAD_BUTTON        a tap that changed nothing (no screen, text, state, dialog, link or download)
 *   CONSOLE_ERROR      an error in the console or an uncaught exception
 *   ERROR_SCREEN       the framework's error or not-found screen, the app's own (flow `error_text`), or a blank screen
 *   STEP_UNREACHABLE   a control or screen the flow says is there and is not
 *   PROMISE_UNBUILT    a promise on a price screen with no reached screen behind it (app-review check 13)
 *   STATE_HIDDEN       a radio, tab or switch whose tap changed nothing and that tells the web build nothing
 *                      (no aria-checked / aria-selected): the chosen option or a dead one, a screen reader
 *                      cannot tell which (react-native-web 0.21 drops accessibilityState)
 *   UNMAPPED_SCREEN    a screen this change touched that the run could not open (a route with a value in
 *                      its path, never reached by a journey)
 * and stops BY NAME, never a pass (rule-zero-shapes), on PREVIEW_DOWN, FLOW_INVALID, FLOW_TAPS_NOTHING and
 * CHANGED_SCREENS_UNMAPPED (screen files changed and no expo-router route maps them).
 *
 * THE CHANGE DECIDES WHAT IS OPENED, not only the hand-kept journeys: with --changed (the PR's
 * `git diff --name-only base...head`) and --files (`git ls-files`), each changed expo-router route file
 * is a URL (the path is the route: structure, not a guess). A changed screen no journey reached is
 * opened and swept; a changed shared file (a component, a layout) opens and sweeps every route.
 *
 * SAFE BY CONSTRUCTION: every request that is not a read (anything but GET/HEAD/OPTIONS) is blocked
 * unless the flow mocks it with test values, and the main page never leaves the preview's origin, so
 * no real purchase, sign-in, email or delete can happen; the flow only uses preview flags and test values.
 *
 *   node scripts/ops/tap-through.mjs --flow <tap-through.json> --target <preview URL> --out <dir> [--schemes light,dark]
 *                                     [--changed <changed.txt> --files <files.txt>]
 *   node scripts/ops/tap-through.mjs --self-test     (the broken-fixture proof; CI runs it)
 *
 * Runs on GitHub only (.github/workflows/tap-through.yml; the Mac never runs
 * Playwright). `ship-review --kind tap-through --on-github` dispatches it and judges what it recorded.
 * Exit 0 every step passed · 1 named failures (all in tap-report.json) · 9 a named stop (nothing judged).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const FAILS = Object.freeze(["DEAD_BUTTON", "CONSOLE_ERROR", "ERROR_SCREEN", "STEP_UNREACHABLE", "PROMISE_UNBUILT", "STATE_HIDDEN", "UNMAPPED_SCREEN"]);
export const STOPS = Object.freeze(["PREVIEW_DOWN", "FLOW_INVALID", "FLOW_TAPS_NOTHING", "CHANGED_SCREENS_UNMAPPED"]);
/** A flow longer than this cannot be judged in one review: split it (the judge must open every shot). */
export const MAX_STEPS = 40;
/** Sweep budget: taps per swept screen and per run. What the budget leaves is named, never dropped. */
export const SWEEP_PER_SCREEN = 40, SWEEP_PER_RUN = 240;
/** A shared file changed, so every route is opened: each one gets this many taps, from its own budget. */
export const SWEEP_PER_ROUTE = 8, ROUTE_SWEEP_PER_RUN = 160;
/** Roles whose chosen state the web build must say out loud (aria-checked / aria-selected). */
const STATEFUL_ROLES = ["radio", "tab", "switch"];
/**
 * The framework's own error and not-found screens (expo-router build/views: Unmatched.js, ErrorBoundary.js).
 * Exact strings the framework renders, all of a set present: structure, not a guess at meaning.
 */
export const FRAMEWORK_ERROR_SCREENS = Object.freeze([["Unmatched Route", "Page could not be found."], ["Something went wrong", "Retry"]]);
const READS = new Set(["GET", "HEAD", "OPTIONS"]);
const CONTROL_ROLES = ["button", "link", "checkbox", "switch", "tab", "radio", "menuitem"];

const stop = (code, why) => Object.assign(new Error(`NAMED STOP [${code}] ${why}`), { stopCode: code, code: 9 });

// ─── The flow file ───────────────────────────────────────────────────────────────────────────────

const ACTIONS = ["see", "tap", "fill", "goto", "back", "sweep", "wait"];
/** A text or name to match: "/re/i" is a regular expression, anything else an exact accessible name or text. */
export function matcher(s) {
  const m = /^\/(.+)\/([a-z]*)$/.exec(String(s));
  return m ? new RegExp(m[1], m[2]) : String(s);
}
const actionOf = (step) => ACTIONS.find((k) => k in step);
/** A step's target as a person reads it: an object spec ({ role, name }) as JSON, never "[object Object]". */
export const said = (v) => (v && typeof v === "object" ? JSON.stringify(v) : String(v));

/** Every problem with a flow, one plain line each; [] when it can run. Pure. */
export function flowProblems(flow) {
  const out = [];
  if (!flow || typeof flow !== "object") return ["the flow is not a JSON object"];
  if (flow.error) return [`the flow file could not be read: ${flow.error}`];
  if (!flow.app) out.push("`app` is missing (the app's name)");
  const journeys = Array.isArray(flow.journeys) ? flow.journeys : [];
  if (!journeys.length) out.push("`journeys` is empty: a flow that taps nothing is no tap-through");
  const ids = new Set(), names = new Set();
  let steps = 0;
  for (const j of journeys) {
    if (!j?.name || !/^[a-z0-9-]+$/.test(j.name)) { out.push(`journey "${j?.name ?? ""}": name must be lower-case words joined by -`); continue; }
    if (names.has(j.name)) out.push(`journey "${j.name}" is listed twice`);
    names.add(j.name);
    if (!Array.isArray(j.steps) || !j.steps.length) { out.push(`journey "${j.name}" has no steps`); continue; }
    for (const [i, s] of j.steps.entries()) {
      steps++;
      const act = actionOf(s ?? {});
      if (!act) out.push(`${j.name} step ${i + 1}: needs one of ${ACTIONS.join(", ")}`);
      if (act === "fill" && typeof s.value !== "string") out.push(`${j.name} step ${i + 1}: fill needs a test "value"`);
      if (s?.id) ids.add(`${j.name}:${s.id}`);
    }
  }
  if (steps > MAX_STEPS) out.push(`${steps} steps: at most ${MAX_STEPS} fit one review; split the flow`);
  for (const p of flow.promises ?? []) {
    if (!p?.text) { out.push("a promise has no `text` (the words on the price screen)"); continue; }
    if (!p.on || !ids.has(p.on)) out.push(`promise "${p.text}": \`on\` must name the price-screen step as "<journey>:<step id>"`);
    if (p.native_only) { if (!(flow.native_only ?? []).some((n) => n.feature === p.native_only)) out.push(`promise "${p.text}": native_only "${p.native_only}" is not in the flow's native_only list`); }
    else if (p.built && !ids.has(p.built)) out.push(`promise "${p.text}": \`built\` names ${p.built}, which is no step in this flow`);
  }
  for (const n of flow.native_only ?? []) if (!n?.feature || !n?.why) out.push("each native_only entry needs `feature` and `why` (why the web preview cannot run it)");
  for (const c of flow.console_ok ?? []) if (!c?.text || !c?.why) out.push("each console_ok entry needs `text` and `why`");
  for (const m of flow.mocks ?? []) if (!m?.url || !m?.why) out.push("each mock needs `url` and `why` (test values only)");
  for (const s of flow.sweep_skip ?? []) if (!s?.name || !s?.why) out.push("each sweep_skip entry needs `name` and `why`");
  for (const [route, st] of Object.entries(flow.route_storage_for ?? {})) {
    if (!route.startsWith("/")) out.push(`route_storage_for "${route}": the key is a route path starting with "/"`);
    if (!st || typeof st !== "object" || Array.isArray(st) || !Object.keys(st).length) out.push(`route_storage_for "${route}": the value is the storage map to set before opening it (key → value)`);
  }
  return out;
}

/** Promises on price screens checked against what the run reached (check 13). Pure. */
export function promiseFailures(flow, reached) {
  const out = [];
  for (const p of flow.promises ?? []) {
    const shown = reached.get(p.on);
    if (!shown?.ok) continue; // the price screen itself failed: that step's own failure is named already
    if (!shown.text.includes(p.text)) out.push({ code: "PROMISE_UNBUILT", where: p.on, what: `the flow maps "${p.text}" but the price screen at ${p.on} does not show it (the map is stale, or the line moved)` });
    else if (p.native_only) continue;
    else if (!p.built) out.push({ code: "PROMISE_UNBUILT", where: p.on, what: `the price screen promises "${p.text}" and no screen in the app is mapped behind it` });
    else if (!reached.get(p.built)?.ok) out.push({ code: "PROMISE_UNBUILT", where: p.on, what: `the price screen promises "${p.text}"; the screen behind it (${p.built}) was not reached` });
  }
  return out;
}

// ─── The change: which screens it touched ────────────────────────────────────────────────────────

const CODE = /\.(tsx|ts|jsx|js)$/;
const NOT_APP = /(^|\/)(__tests__|tests?|e2e|scripts|\.github|node_modules)\/|\.(test|spec|d)\.[jt]sx?$|(^|\/)[^/]*\.config\.[cm]?[jt]s$/;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** An expo-router route file (relative to its app folder) as a route: its URL pattern, and a URL when it has no value in it. */
export function routeOf(rel) {
  const segs = rel.replace(CODE, "").split("/").filter((s) => !/^\(.*\)$/.test(s));
  if (segs.at(-1) === "index") segs.pop();
  const dynamic = segs.some((s) => /^\[.+\]$/.test(s));
  const re = segs.map((s) => (/^\[\.\.\..+\]$/.test(s) ? ".+" : /^\[.+\]$/.test(s) ? "[^/]+" : escapeRe(s))).join("/");
  return { route: `/${segs.join("/")}`, re: new RegExp(`^/${re}/?$`), url: dynamic ? null : `/${segs.join("/")}` };
}

/**
 * What a change touched, from its changed files and the repo's file list. Pure. `changed` null = no diff
 * given (not a pull request): the journeys alone run, and the report says so. A route file is its route;
 * any other app file (a component, a layout, a hook) is shared, so every route is opened; tests, scripts,
 * configs and files outside the app's package are not screens.
 */
export function changedScreens({ changed = null, files = [], appDir = null }) {
  if (!changed) return { given: false };
  const roots = appDir ? [appDir.replace(/\/$/, "")] : [...new Set(files.map((f) => /^(?:(.+)\/)?app\/(?:_layout|index)\.(?:tsx|ts|jsx|js)$/.exec(f)).filter(Boolean).map((m) => (m[1] ? `${m[1]}/app` : "app")))];
  const pkgOf = (root) => root.replace(/(^|\/)app$/, "");
  const inPkg = (f) => roots.some((r) => { const p = pkgOf(r); return !p || f.startsWith(`${p}/`); });
  const rootOf = (f) => roots.find((r) => f.startsWith(`${r}/`));
  const isRoute = (f) => { const r = rootOf(f); return r && CODE.test(f) && !NOT_APP.test(f) && !/^[_+]/.test(f.split("/").pop()); };
  const all = [];
  for (const f of files) if (isRoute(f)) { const r = routeOf(f.slice(rootOf(f).length + 1)); if (!all.some((x) => x.route === r.route)) all.push({ ...r, file: f }); }
  const changedRoutes = [], shared = [], present = new Set(files);
  for (const f of changed) {
    if (!CODE.test(f) || NOT_APP.test(f) || (files.length && !present.has(f))) continue; // a deleted file is no screen to open
    if (isRoute(f)) { const r = all.find((x) => x.file === f) ?? { ...routeOf(f.slice(rootOf(f).length + 1)), file: f }; if (!changedRoutes.some((x) => x.route === r.route)) changedRoutes.push(r); }
    else if (roots.length && inPkg(f)) shared.push(f);
    else if (!roots.length && /\.(tsx|jsx)$/.test(f)) shared.push(f);
  }
  const screenFiles = changedRoutes.length + shared.length;
  const stop = screenFiles && !all.length
    ? `${screenFiles} screen file(s) changed (${[...changedRoutes.map((r) => r.file), ...shared].slice(0, 4).join(", ")}) and no expo-router route maps them (no app/_layout or app/index in the repo); set "app_dir" in the flow`
    : null;
  return { given: true, changedRoutes, shared, everyRoute: shared.length > 0, allRoutes: all, stop, ignored: changed.length - screenFiles };
}

/** The run's outcome from what happened. Rule 0: zero taps is a stop, never a pass. Pure. */
export function outcome({ taps, failures, stopped = null }) {
  if (stopped) return { exit: 9, line: `NAMED STOP [${stopped.code}] ${stopped.why}` };
  if (!taps) return { exit: 9, line: "NAMED STOP [FLOW_TAPS_NOTHING] the flow ran and tapped nothing, so nothing was proven" };
  if (failures.length) return { exit: 1, line: `TAP-THROUGH FAIL ${failures.length}: ${[...new Set(failures.map((f) => f.code))].join(", ")}` };
  return { exit: 0, line: `TAP-THROUGH PASS ${taps} taps` };
}

// ─── The browser ─────────────────────────────────────────────────────────────────────────────────

/** What the person sees right now, as one string: a tap that leaves it unchanged did nothing. */
const FINGERPRINT = () => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const states = [...document.querySelectorAll("[aria-checked],[aria-pressed],[aria-expanded],[aria-selected],input,textarea,select")]
    .filter(vis).map((e) => `${e.getAttribute("aria-checked") ?? ""}${e.getAttribute("aria-pressed") ?? ""}${e.getAttribute("aria-expanded") ?? ""}${e.getAttribute("aria-selected") ?? ""}${"value" in e ? e.value : ""}${"checked" in e ? e.checked : ""}`).join("|");
  const dialogs = document.querySelectorAll("[role=dialog],[role=alertdialog],[aria-modal=true],dialog[open]").length;
  return `${location.href}\n${dialogs}\n${states}\n${document.body?.innerText ?? ""}`;
};

// What a person sees of each control. RN-web 0.21 drops accessibilityState, so a chosen radio or tab often
// changes only its look (DW plan radios, KMP language and tabs, 22 Nov 2026): a person sees that, so it is
// never DEAD, but the report names it (a screen reader on the web build is told nothing).
const LOOK = () => [...document.querySelectorAll("[role],a[href],button,input")]
  .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4; })
  .map((e) => { const s = getComputedStyle(e); return `${s.borderTopColor}${s.borderTopWidth}${s.backgroundColor}${s.color}`; }).join("|");
async function snap(page) {
  await page.mouse.move(1, 1).catch(() => {}); // the same pointer place as the look taken after the tap
  return { fp: await page.evaluate(FINGERPRINT).catch(() => ""), look: await page.evaluate(LOOK).catch(() => "") };
}

/** The controls a person can tap on this screen, in reading order; tappables with no role are named apart. */
// With `mark`, the same scan tags that one control (data-tap-through-target) so the tap hits exactly the control
// the sweep counted. A role+name locator counts controls this scan leaves out (screens kept mounted under the
// one on show), so its nth hit the wrong copy: AP "Back" DEAD and "Next question" untappable, 22 Nov 2026.
const CONTROLS = ({ roles, mark, stateful }) => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 4 && r.height > 4 && s.visibility !== "hidden" && s.display !== "none" && !e.closest("[aria-hidden=true]"); };
  const fullName = (e) => (e.getAttribute("aria-label") || e.innerText || e.getAttribute("title") || e.value || "").replace(/\s+/g, " ").trim();
  const roleOf = (e) => e.getAttribute("role") || (e.tagName === "A" && e.hasAttribute("href") ? "link" : e.tagName === "BUTTON" ? "button" : e.type === "checkbox" ? "checkbox" : null);
  const seen = new Map(), out = [], noRole = [];
  for (const e of document.querySelectorAll("[role],a[href],button,input[type=checkbox]")) {
    const role = roleOf(e);
    if (!roles.includes(role) || !vis(e)) continue;
    const n = fullName(e).slice(0, 120), key = `${role}|${n}`; // the mark below finds it again: no locator matches this name
    const nth = seen.get(key) ?? 0; seen.set(key, nth + 1);
    if (mark) {
      if (role === mark.role && n === mark.name && nth === mark.nth) { e.setAttribute("data-tap-through-target", ""); return { marked: true }; }
      continue;
    }
    out.push({ role, name: n, nth, hidesState: stateful.includes(role) && !e.hasAttribute("aria-checked") && !e.hasAttribute("aria-selected"), disabled: e.getAttribute("aria-disabled") === "true" || e.disabled === true, current: (role === "tab" && (e.getAttribute("aria-selected") === "true" || (e.getAttribute("aria-current") ?? "false") !== "false")) || (role === "radio" && e.getAttribute("aria-checked") === "true") || (role === "button" && e.getAttribute("aria-selected") === "true"), href: e.tagName === "A" ? e.href : null });
  }
  for (const e of document.querySelectorAll("[tabindex='0']:not([role]):not(a):not(button):not(input)")) if (vis(e) && fullName(e) && e.querySelector("[role]") === null && getComputedStyle(e).cursor === "pointer") noRole.push(fullName(e).slice(0, 120));
  if (mark) return { marked: false };
  return { controls: out, noRole: [...new Set(noRole)].slice(0, 10) };
};

function locate(page, spec) {
  if (typeof spec === "object" && spec) {
    const n = spec.name != null ? matcher(spec.name) : undefined;
    const l = spec.role ? page.getByRole(spec.role, { name: n, exact: typeof n === "string" }) : page.getByText(n, { exact: typeof n === "string" });
    return l.filter({ visible: true }).nth(spec.nth ?? 0);
  }
  // Only a copy on show counts: a copy kept mounted out of sight (stacked screens) is never tapped or "seen".
  const n = matcher(spec), exact = typeof n === "string";
  const byRole = CONTROL_ROLES.map((r) => page.getByRole(r, { name: n, exact })).reduce((a, b) => a.or(b));
  return byRole.or(page.getByText(n, { exact })).filter({ visible: true }).first();
}

async function screenText(page) { return page.evaluate(() => document.body?.innerText ?? "").catch(() => ""); }

/** The framework's error screens, the app's own (flow.error_text), or nothing on the screen at all. */
async function errorScreen(page, flow, settled = false) {
  const s = await page.evaluate(() => ({ text: document.body?.innerText ?? "", media: [...document.querySelectorAll("img,svg,canvas,video")].filter((e) => e.getBoundingClientRect().width > 20).length })).catch(() => ({ text: "", media: 0 }));
  for (const set of FRAMEWORK_ERROR_SCREENS) if (set.every((t) => s.text.includes(t))) return `the framework's error screen ("${set[0]}")`;
  for (const t of flow.error_text ?? []) if (s.text.includes(t)) return `the app's own error screen ("${t}")`;
  if (s.text.trim().length < 3 && s.media === 0) {
    // A screen mid-transition is blank for a moment: blank only counts if it is still blank 4 s later.
    if (settled) return "a blank screen";
    await page.waitForTimeout(4000);
    return errorScreen(page, flow, true);
  }
  return null;
}

/** Why a click failed, in the words that help: what covers the control, or that it never settles. */
function whyNot(e) {
  const lines = String(e.message).split("\n");
  return (lines.find((l) => /intercepts pointer events|not stable|outside of the viewport|not visible|not enabled/.test(l)) ?? lines[0]).trim();
}

/** Tap like a person. Playwright already re-scrolls a covered control (it tries other alignments), so a
 * second scroll here added nothing: AP ran without it with no covered control (run 45052767700). */
async function tap(loc, timeout) {
  return loc.click({ timeout }).then(() => true, whyNot);
}

/** Wait until the screen differs from `before` (up to ms), or a link, dialog or download said it worked. */
const LOOK_ONLY = "only its look changed (a screen reader on the web build is told nothing)";
async function changed(page, before, signal, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (signal.hit) return signal.hit;
    const now = await page.evaluate(FINGERPRINT).catch(() => null);
    if (now !== null && now !== before.fp) return "the screen changed";
    await page.waitForTimeout(150);
  }
  if (signal.hit) return signal.hit;
  // The pointer moves off and the focus leaves first: a hover or focus style is not a change the tap made
  // (a dead "Buy now" with a :focus border passed as live, review of #509, 22 Nov 2026).
  await page.mouse.move(1, 1).catch(() => {});
  await page.evaluate(() => document.activeElement?.blur?.()).catch(() => {});
  await page.waitForTimeout(200);
  const look = await page.evaluate(LOOK).catch(() => null);
  return look !== null && look !== before.look ? LOOK_ONLY : null;
}

/** Shows where the robot tapped, so the video reads like a person using the app. */
async function showTap(page, loc) {
  const b = await loc.boundingBox().catch(() => null);
  if (!b) return;
  await page.evaluate(({ x, y }) => {
    const d = document.createElement("div");
    d.setAttribute("aria-hidden", "true");
    d.style.cssText = `position:fixed;left:${x - 18}px;top:${y - 18}px;width:36px;height:36px;border-radius:50%;border:3px solid #e5484d;background:rgba(229,72,77,.18);z-index:2147483647;pointer-events:none`;
    document.body.appendChild(d); setTimeout(() => d.remove(), 450);
  }, { x: b.x + b.width / 2, y: b.y + b.height / 2 }).catch(() => {});
  await page.waitForTimeout(120);
}

/**
 * One browser context with the safety guard: reads pass, writes are blocked unless mocked with test
 * values, the main page never leaves the preview, popups and downloads are noted and closed.
 */
async function openContext(browser, { flow, origin, scheme, video, notes }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, locale: flow.locale ?? "en-US", isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: "block", ...(video ? { recordVideo: { dir: video, size: { width: 390, height: 844 } } } : {}) });
  const signal = { hit: null };
  await ctx.route("**/*", async (route) => {
    const req = route.request(), url = req.url(), method = req.method();
    const mock = (flow.mocks ?? []).find((m) => url.startsWith(m.url) && (m.method ?? "POST").toUpperCase() === method);
    if (mock) return route.fulfill({ status: mock.status ?? 200, contentType: "application/json", body: JSON.stringify(mock.json ?? {}) });
    if (!READS.has(method)) { notes.blocked.add(`${method} ${url.split("?")[0]}`); signal.hit ??= `it sent ${method} ${url.split("?")[0]} (blocked: the tap-through never writes)`; return route.abort("blockedbyclient"); }
    // A service worker's request has no frame (frame() throws); service workers are blocked above, so
    // every request the page makes passes through this guard.
    let frame = null; try { frame = req.frame(); } catch { /* no frame */ }
    if (req.isNavigationRequest() && frame && frame === frame.page()?.mainFrame() && !url.startsWith(origin)) {
      notes.external.add(url.split("?")[0]); signal.hit ??= `it opens ${url.split("?")[0]} (not followed: outside the preview)`; return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  ctx.on("page", async (p) => { if (p !== ctx.pages()[0]) { signal.hit ??= `it opens a new window (${p.url() || "about:blank"})`; notes.external.add(p.url() || "a new window"); await p.close().catch(() => {}); } });
  const page = await ctx.newPage();
  // Every screen the run reaches, replays and sweeps included: a changed screen reached here was opened.
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) notes.paths?.add(pathOf(f.url())); });
  page.on("dialog", async (d) => { signal.hit ??= `it asks "${d.message().slice(0, 80)}"`; await (signal.accept ? d.accept() : d.dismiss()).catch(() => {}); });
  page.on("download", async (d) => { signal.hit ??= `it downloads ${d.suggestedFilename()}`; await d.cancel().catch(() => {}); });
  const errors = [];
  // The guard's own abort (a write or an outside page, recorded in notes) logs "net::ERR_BLOCKED_BY_CLIENT"
  // in the console; a clean CI Chromium has no extension that could, so that line is ours, not the app's.
  page.on("console", (m) => { if (m.type() === "error" && !/net::ERR_BLOCKED_BY_CLIENT/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => errors.push(`uncaught: ${String(e.message).slice(0, 200)}`));
  return { ctx, page, signal, errors };
}

async function load(page, url, flow, storage) {
  if (storage && Object.keys(storage).length) await page.addInitScript((s) => { try { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v)); } catch { /* storage blocked */ } }, storage);
  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch((e) => ({ status: () => 0, err: e.message.split("\n")[0] }));
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  return res;
}

/** A URL's screen path, the way a route matches it ("/plans", never "/plans/" or "/plans.html"). */
export function pathOf(url) {
  try { const p = new URL(url).pathname.replace(/\.html$/, "").replace(/\/index$/, "").replace(/\/+$/, ""); return p || "/"; } catch { return ""; }
}

const joinUrl = (target, start = "/") => /^https?:/.test(start) ? start : new URL(start, target.endsWith("/") ? target : `${target}/`).href;

/**
 * One step. Returns { ok, code?, what, tapped } and never throws for the app's faults.
 * `sweep` steps are handled by the caller.
 */
async function doStep(c, s, flow, target) {
  const { page, signal } = c;
  const act = actionOf(s);
  signal.hit = null; signal.accept = s.dialog === "accept";
  if (act === "see") {
    const ok = await locate(page, s.see).waitFor({ state: "visible", timeout: s.timeout ?? 15_000 }).then(() => true, () => false);
    return ok ? { ok, what: `sees ${s.see}` } : { ok, code: "STEP_UNREACHABLE", what: `"${s.see}" never appeared` };
  }
  if (act === "wait") { await page.waitForTimeout(Math.min(Number(s.wait) || 500, 5000)); return { ok: true, what: `waits ${s.wait} ms` }; }
  if (act === "goto") { const r = await load(page, joinUrl(target, s.goto), flow, null); const st = r?.status?.() ?? 0; return st && st < 400 ? { ok: true, what: `opens ${s.goto}` } : { ok: false, code: "STEP_UNREACHABLE", what: `${s.goto} answered ${st || r?.err || "nothing"}` }; }
  if (act === "back") { const before = await snap(page); await page.goBack({ timeout: 10_000 }).catch(() => {}); const ch = await changed(page, before, signal); return ch ? { ok: true, what: "goes back" } : { ok: false, code: "DEAD_BUTTON", what: "back changed nothing" }; }
  const field = (n) => page.getByLabel(n).or(page.getByPlaceholder(n)).or(page.getByRole("textbox", { name: n })).first();
  const loc = act === "fill" ? field(matcher(s.fill)) : locate(page, s.tap);
  const there = await loc.waitFor({ state: "visible", timeout: s.timeout ?? 15_000 }).then(() => true, () => false);
  if (!there) return { ok: false, code: "STEP_UNREACHABLE", what: `"${said(s[act])}" is not on the screen` };
  if (act === "fill") {
    const ok = await loc.fill(s.value, { timeout: 10_000 }).then(() => true, () => false);
    return ok ? { ok, what: `types into ${s.fill}` } : { ok, code: "STEP_UNREACHABLE", what: `"${s.fill}" cannot be typed into` };
  }
  const before = await snap(page);
  const hides = await loc.evaluate((e, roles) => roles.includes(e.getAttribute("role")) && !e.hasAttribute("aria-checked") && !e.hasAttribute("aria-selected"), STATEFUL_ROLES).catch(() => false);
  await showTap(page, loc);
  const clicked = await tap(loc, 10_000);
  if (clicked !== true) return { ok: false, code: "STEP_UNREACHABLE", what: `"${said(s.tap)}" could not be tapped (${clicked})`, tapped: false };
  const ch = await changed(page, before, signal);
  if (!ch) return hides ? { ok: false, code: "STATE_HIDDEN", what: stateHidden("control", said(s.tap)), tapped: true } : { ok: false, code: "DEAD_BUTTON", what: `tapping "${said(s.tap)}" changed nothing`, tapped: true };
  if (s.then != null) {
    const ok = await locate(page, s.then).waitFor({ state: "visible", timeout: s.timeout ?? 15_000 }).then(() => true, () => false);
    if (!ok) return { ok: false, code: "STEP_UNREACHABLE", what: `after "${said(s.tap)}", "${said(s.then)}" never appeared`, tapped: true };
  }
  return { ok: true, what: `taps ${said(s.tap)}: ${ch}`, tapped: true };
}

const stateHidden = (role, name) => `tapping the ${role} "${name}" changed nothing, and it tells the web build nothing (no aria-checked / aria-selected): it is the chosen option or a dead one, and a screen reader cannot tell which; set aria-checked or aria-selected (react-native-web drops accessibilityState)`;
const consoleOk = (flow, text) => (flow.console_ok ?? []).some((c) => text.includes(c.text));
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "step";

/** Replays a journey's first `upto` steps in a fresh context (no video, no shots) to get back to a screen. */
async function replay(browser, flow, target, origin, j, upto, notes) {
  const c = await openContext(browser, { flow, origin, scheme: "light", video: null, notes });
  await load(c.page, joinUrl(target, j.start), flow, j.storage);
  for (const s of j.steps.slice(0, upto)) {
    if ("sweep" in s) continue;
    const r = await doStep(c, s, flow, target);
    if (!r.ok) { await c.ctx.close(); return null; }
  }
  return c;
}

/** Taps every control on the screen a journey reached, each from that screen; a dead one fails by name. */
async function sweep(browser, flow, target, origin, j, at, c, ctx, cap = SWEEP_PER_SCREEN, budget = ctx.budget) {
  const { notes, swept } = ctx;
  const shots = []; // a shot after every sweep tap: the reviewer sees each one (review of #509: sweeps left no capture)
  const { controls, noRole } = await c.page.evaluate(CONTROLS, { roles: CONTROL_ROLES, stateful: STATEFUL_ROLES }).catch(() => ({ controls: [], noRole: [] }));
  const skip = (flow.sweep_skip ?? []).map((s) => matcher(s.name));
  const path = await c.page.evaluate(() => location.pathname + location.search).catch(() => "");
  const results = [], left = [], where = `${j.name}${at ? ` step ${at + 1}` : ""} sweep`;
  // Every tap starts from a replayed copy of this screen, never the journey's own page: the steps after a
  // sweep must find the screen the sweep saw (PBS first-open, 22 Nov 2026: the door was gone).
  let cur = c, fresh = false, here = 0;
  if (noRole.length) notes.noRole.push(...noRole.map((n) => `${j.name} step ${at + 1}: "${n}"`));
  for (const k of controls) {
    const shown = k;
    const key = `${path}|${k.role}|${k.name}|${k.nth}`;
    if (swept.has(key)) continue;
    if (!k.name) { results.push({ ...shown, result: "no accessible name (a screen reader says nothing)" }); notes.unnamed.push(`${j.name} step ${at + 1}: a ${k.role} with no name`); swept.add(key); continue; }
    if (k.disabled) { results.push({ ...shown, result: "disabled here" }); swept.add(key); continue; }
    if (k.current) { results.push({ ...shown, result: k.role !== "tab" ? "the chosen option (tapping it keeps it)" : "the current tab (tapping it stays here)" }); swept.add(key); continue; }
    if (skip.some((m) => (typeof m === "string" ? m === k.name : m.test(k.name)))) { results.push({ ...shown, result: "skipped (sweep_skip)" }); swept.add(key); continue; }
    if (k.href && /^(mailto|tel|sms):/i.test(k.href)) { results.push({ ...shown, result: `opens ${k.href.split(":")[0]} (not followed)` }); swept.add(key); continue; }
    if (k.href && !k.href.startsWith(origin)) { results.push({ ...shown, result: `links to ${k.href.split("?")[0]} (not followed)` }); notes.external.add(k.href.split("?")[0]); swept.add(key); continue; }
    if (budget.left <= 0 || here >= cap) { left.push(k.name); continue; }
    if (!fresh) {
      if (cur !== c) await cur.ctx.close().catch(() => {});
      cur = await replay(browser, flow, target, origin, j, at, notes);
      if (!cur) { left.push(k.name, "(could not return to this screen)"); cur = c; break; }
    }
    budget.left--; here++; swept.add(key);
    await cur.page.evaluate(() => document.querySelectorAll("[data-tap-through-target]").forEach((e) => e.removeAttribute("data-tap-through-target"))).catch(() => {});
    // The replayed screen may still be drawing (lists load after the screen opens): wait for the control as a
    // locator click would, up to 5 s. An instant look made AP, APM and PBS controls "gone" (22 Nov 2026).
    let marked = false;
    for (const t0 = Date.now(); !marked && Date.now() - t0 < 5_000; ) {
      ({ marked } = await cur.page.evaluate(CONTROLS, { roles: CONTROL_ROLES, stateful: STATEFUL_ROLES, mark: { role: k.role, name: k.name, nth: k.nth } }).catch(() => ({ marked: false })));
      if (!marked) await cur.page.waitForTimeout(250);
    }
    if (!marked) { results.push({ ...shown, result: "gone when this screen was opened again" }); ctx.failures.push({ code: "STEP_UNREACHABLE", where, what: `the ${k.role} "${k.name}" was not there when the screen was opened again (the screen differs each time)` }); fresh = false; continue; }
    const loc = cur.page.locator("[data-tap-through-target]");
    const before = await snap(cur.page);
    cur.signal.hit = null; cur.signal.accept = false;
    cur.errors.length = 0; // only what this tap logs: the replay's own load is the journey's to judge
    await showTap(cur.page, loc);
    const clicked = await tap(loc, 5_000);
    if (clicked !== true) { results.push({ ...shown, result: `could not be tapped (${clicked})` }); ctx.failures.push({ code: "STEP_UNREACHABLE", where, what: `the ${k.role} "${k.name}" is shown but cannot be tapped (${clicked.slice(0, 120)})` }); continue; }
    ctx.taps.n++;
    const ch = await changed(cur.page, before, cur.signal, 2500);
    const err = await errorScreen(cur.page, flow);
    // A tap that draws and then throws is a crash a person hits: read this context's errors, as a step's are.
    const cons = cur.errors.splice(0).filter((e) => !consoleOk(flow, e));
    for (const e of cons) ctx.failures.push({ code: "CONSOLE_ERROR", where, what: `tapping "${k.name}": ${e}` });
    const result = !ch ? (k.hidesState ? "STATE_HIDDEN" : "DEAD") : ch;
    if (ctx.out) {
      const file = join(ctx.out, `${String(shots.length + 1).padStart(2, "0")}-${slug(k.name)}.jpg`);
      await cur.page.screenshot({ path: file, type: "jpeg", quality: 60, animations: "disabled", timeout: 30_000 }).catch(() => {});
      if (existsSync(file)) shots.push({ file, caption: `${slug(j.name)} · tap "${k.name.slice(0, 40)}" → ${result === ch ? "live" : result}${cons.length ? " · CONSOLE_ERROR" : ""}` });
    }
    if (!ch) {
      results.push({ ...shown, result });
      ctx.failures.push(k.hidesState ? { code: "STATE_HIDDEN", where, what: stateHidden(k.role, k.name) } : { code: "DEAD_BUTTON", where, what: `tapping the ${k.role} "${k.name}" changed nothing` });
      fresh = true; continue;
    }
    if (err) ctx.failures.push({ code: "ERROR_SCREEN", where, what: `tapping "${k.name}" shows ${err}` });
    results.push({ ...shown, result: ch });
    fresh = false;
  }
  if (cur !== c) await cur.ctx.close().catch(() => {});
  return { results, left, found: controls.length, shots };
}

/** Shots on one sheet (one journey's dark screens, or one screen's sweep taps), so the judge opens one image, not 40. */
async function sheet(browser, files, out) {
  if (!files.length) return null;
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const imgs = files.map((x) => { const f = x.file ?? x; return `<figure><img src="data:image/${extname(f) === ".jpg" ? "jpeg" : "png"};base64,${readFileSync(f).toString("base64")}"><figcaption>${esc(x.caption ?? f.split("/").pop())}</figcaption></figure>`; }).join("");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await p.setContent(`<style>body{margin:0;background:#888;display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:12px;font:13px sans-serif}img{width:100%;display:block}figure{margin:0}figcaption{color:#fff;padding:4px 0}</style>${imgs}`);
  await p.screenshot({ path: out, fullPage: true });
  await ctx.close();
  return out;
}

/**
 * The whole run. Returns the report (also written to out/tap-report.json) with every step, every
 * sweep result, every failure by name, the facts and the capture list ship-review judges.
 */
export async function run({ flow, target, out, schemes = ["light", "dark"], chromium = null, changed = null, files = [] }) {
  mkdirSync(out, { recursive: true });
  const report = { app: flow?.app, target, schemes, journeys: [], sweeps: [], routes: [], failures: [], facts: [], shots: [], videos: [], taps: 0, stopped: null };
  const finish = () => {
    const o = outcome({ taps: report.taps, failures: report.failures, stopped: report.stopped });
    report.result = o.line;
    writeFileSync(join(out, "tap-report.json"), JSON.stringify(report, null, 2));
    writeFileSync(join(out, "capture.json"), JSON.stringify({ shots: report.shots, facts: report.facts }, null, 2));
    return { report, ...o };
  };
  const problems = flowProblems(flow);
  if (problems.length) { report.stopped = { code: "FLOW_INVALID", why: problems.join("; ") }; return finish(); }
  const change = changedScreens({ changed, files, appDir: flow.app_dir ?? null });
  if (change.stop) { report.stopped = { code: "CHANGED_SCREENS_UNMAPPED", why: change.stop }; return finish(); }
  const origin = new URL(target).origin;
  const browser = await (chromium ?? (await import("@playwright/test")).chromium).launch();
  const notes = { blocked: new Set(), external: new Set(), noRole: [], unnamed: [], paths: new Set() };
  const ctx = { notes, swept: new Set(), budget: { left: SWEEP_PER_RUN }, failures: report.failures, taps: { n: 0 }, out: null };
  const sweepSheet = async (name, shots) => {
    const f = await sheet(browser, shots, join(out, `sweep-sheet-${slug(name)}.png`)).catch(() => null);
    if (f) report.shots.push({ label: f.split("/").pop(), file: f.split("/").pop() });
    return f;
  };
  const reached = new Map(); // "<journey>:<id>" → { ok, text }
  const leftOver = [];
  try {
    // PREVIEW_DOWN: the preview must answer and draw something before anything is judged.
    {
      const probe = await openContext(browser, { flow, origin, scheme: "light", video: null, notes });
      const r = await load(probe.page, joinUrl(target, flow.journeys[0].start), flow, flow.journeys[0].storage);
      const st = r?.status?.() ?? 0;
      await probe.page.waitForFunction(() => (document.body?.innerText ?? "").trim().length > 2, null, { timeout: 20_000 }).catch(() => {});
      const blank = (await screenText(probe.page)).trim().length < 3;
      await probe.ctx.close();
      if (!st || st >= 400 || blank) { report.stopped = { code: "PREVIEW_DOWN", why: `${target} answered ${st || r?.err || "nothing"}${blank && st && st < 400 ? " with a blank screen" : ""}; nothing was tapped or judged` }; return finish(); }
    }
    let n = 0;
    for (const scheme of schemes) {
      const dark = scheme === "dark";
      for (const j of flow.journeys) {
        const vdir = join(out, "video-tmp", `${scheme}-${j.name}`);
        const c = await openContext(browser, { flow, origin, scheme, video: vdir, notes });
        await load(c.page, joinUrl(target, j.start), flow, j.storage);
        const jr = { name: j.name, scheme, steps: [] }, darkShots = [];
        let broken = null;
        for (const [i, s] of j.steps.entries()) {
          const label = `${dark ? "dark-" : ""}${String(++n).padStart(2, "0")}-${j.name}-${slug(s.id ?? s[actionOf(s)] ?? actionOf(s))}.png`;
          if (broken) { jr.steps.push({ n: i + 1, status: "not reached", why: `step ${broken} failed` }); continue; }
          let r;
          if ("sweep" in s) {
            if (dark) { n--; continue; }
            ctx.out = join(out, "sweep-tmp", `${slug(j.name)}-${i + 1}`); mkdirSync(ctx.out, { recursive: true });
            const sw = await sweep(browser, flow, target, origin, j, i, c, ctx);
            const sh = await sweepSheet(`${j.name}-step-${i + 1}`, sw.shots);
            report.sweeps.push({ journey: j.name, step: i + 1, results: sw.results, left: sw.left, sheet: sh?.split("/").pop() ?? null });
            if (sw.left.length) leftOver.push(`${j.name} step ${i + 1}: ${sw.left.join(", ")}`);
            // A swept screen with nothing a person can tap is a broken or wrong screen, never "0 controls, ok".
            r = sw.found ? { ok: true, what: `sweeps ${sw.results.length} controls` } : { ok: false, code: "STEP_UNREACHABLE", what: "the sweep found no control a person can tap on this screen (a broken or wrong screen)" };
          } else r = await doStep(c, s, flow, target);
          notes.paths.add(pathOf(c.page.url()));
          if (r.tapped) ctx.taps.n++;
          await c.page.waitForTimeout(350);
          const where = `${j.name} step ${i + 1}${dark ? " (dark)" : ""}`;
          const err = r.ok ? await errorScreen(c.page, flow) : null;
          const cons = c.errors.splice(0).filter((e) => !consoleOk(flow, e)); // errors since the last step, the page's load included
          const file = join(out, label);
          await c.page.screenshot({ path: file, fullPage: true, animations: "disabled", timeout: 60_000 }).catch(() => {});
          const shot = existsSync(file);
          if (shot && !dark) report.shots.push({ label, file: label });
          if (shot && dark) darkShots.push(file);
          if (!r.ok) { report.failures.push({ code: r.code, where, what: r.what, shot: shot ? label : null }); broken = i + 1; }
          if (err) { report.failures.push({ code: "ERROR_SCREEN", where, what: `shows ${err}`, shot: shot ? label : null }); broken ??= i + 1; }
          for (const e of cons) report.failures.push({ code: "CONSOLE_ERROR", where, what: e, shot: shot ? label : null });
          if (s.id && !dark) reached.set(`${j.name}:${s.id}`, { ok: r.ok && !err, text: await screenText(c.page) });
          jr.steps.push({ n: i + 1, label: shot ? label : null, status: r.ok && !err ? "ok" : r.code ?? "ERROR_SCREEN", what: r.what, console: cons });
        }
        const v = c.page.video();
        await c.ctx.close();
        const vfile = v ? await v.path().catch(() => null) : null;
        if (vfile && existsSync(vfile)) {
          const dest = join(out, `video-${scheme}-${j.name}.webm`);
          writeFileSync(dest, readFileSync(vfile));
          report.videos.push({ journey: j.name, scheme, file: dest.split("/").pop() });
        }
        if (dark && darkShots.length) {
          const f = await sheet(browser, darkShots, join(out, `dark-sheet-${j.name}.png`));
          if (f) report.shots.push({ label: f.split("/").pop(), file: f.split("/").pop() });
        }
        report.journeys.push(jr);
      }
    }
    if (change.given) await changedPass({ browser, flow, target, origin, change, ctx, report, sweepSheet, out });
  } finally { await browser.close(); for (const d of ["video-tmp", "sweep-tmp"]) rmSync(join(out, d), { recursive: true, force: true }); }
  report.taps = ctx.taps.n;
  report.failures.push(...promiseFailures(flow, reached));
  const f = report.facts;
  f.push(`tap-through of ${flow.app} at ${target}: ${flow.journeys.length} journeys in ${schemes.join(" and ")} at 390 px, ${report.taps} taps, ${report.videos.length} videos (one per journey per scheme, red rings mark each tap)`);
  for (const j of report.journeys.filter((x) => x.scheme === schemes[0])) f.push(`journey ${j.name}: ${j.steps.map((s) => `${s.n} ${s.status === "ok" ? "ok" : s.status}`).join(", ")}`);
  for (const s of report.sweeps) f.push(`sweep at ${s.journey} step ${s.step}: ${s.results.map((r) => `"${r.name}" ${r.result === "DEAD" ? "DEAD" : "live"}`).join(", ") || "no controls"}`);
  if (leftOver.length) f.push(`NOT swept (budget ${SWEEP_PER_RUN} taps): ${leftOver.join("; ")}`);
  if (!change.given) f.push("no diff given (not a pull request or push): the journeys alone ran; no changed screen was looked for");
  else f.push(`the change: ${change.changedRoutes.length} screen route(s) changed (${change.changedRoutes.map((r) => r.route).join(", ") || "none"}), ${change.shared.length} shared app file(s)${change.everyRoute ? ` (so all ${change.allRoutes.length} routes were opened)` : ""}, ${change.ignored} file(s) not screens`);
  for (const r of report.routes) f.push(`route ${r.route}${r.changed ? " (changed)" : ""}: ${r.result}`);
  f.push(report.failures.length ? `${report.failures.length} named failures: ${report.failures.map((x) => `${x.code} at ${x.where}: ${x.what}`).join(" | ")}` : "no named failures: no dead button, console error, error screen, unreachable step, unbuilt promise, hidden state or unopened changed screen");
  if (notes.blocked.size) f.push(`writes blocked (the tap-through never writes): ${[...notes.blocked].slice(0, 8).join(", ")}`);
  if (notes.external.size) f.push(`opens outside the app (not followed): ${[...notes.external].slice(0, 10).join(", ")}`);
  const lookOnly = report.sweeps.flatMap((s) => s.results.filter((r) => r.result === LOOK_ONLY).map((r) => `${s.journey}: "${r.name}"`));
  if (lookOnly.length) f.push(`chosen by its look alone (the web build hides the state from a screen reader; the phone build reads accessibilityState): ${lookOnly.slice(0, 8).join("; ")}`);
  if (notes.noRole.length) f.push(`tappable with no role (a screen reader does not call it a button): ${notes.noRole.slice(0, 6).join("; ")}`);
  if (notes.unnamed.length) f.push(`controls with no name: ${notes.unnamed.slice(0, 6).join("; ")}`);
  for (const nf of flow.native_only ?? []) f.push(`NOT RUN ON THE WEB PREVIEW (native only): ${nf.feature}: ${nf.why}${nf.simulator ? `; the iOS-simulator capture is ${nf.simulator}` : "; no iOS-simulator capture exists yet"}`);
  for (const p of flow.promises ?? []) {
    const shown = reached.get(p.on);
    f.push(`price-screen promise "${p.text}" (on ${p.on}) → ${p.native_only ? `native only (${p.native_only})` : p.built ? `${p.built} ${reached.get(p.built)?.ok ? "reached" : "NOT reached"}` : "NO screen mapped"}${shown ? "" : " (price screen not reached)"}`);
  }
  for (const id of new Set((flow.promises ?? []).map((p) => p.on))) { const t = reached.get(id)?.text; if (t) f.push(`everything the price screen ${id} says: "${t.replace(/\s+/g, " ").slice(0, 900)}"`); }
  return finish();
}

/**
 * The screens this change touched that the journeys did not sweep: each is opened by its URL and every
 * control on it tapped (a changed route gets the full per-screen budget; with a shared file changed,
 * every other route gets SWEEP_PER_ROUTE). A changed screen the run cannot open fails UNMAPPED_SCREEN.
 */
async function changedPass({ browser, flow, target, origin, change, ctx, report, sweepSheet, out }) {
  const base = pathOf(target) === "/" ? "" : pathOf(target);
  const local = (p) => (base && p.startsWith(base) ? p.slice(base.length) || "/" : p);
  const reached = () => [...ctx.notes.paths].map(local);
  const isChanged = (r) => change.changedRoutes.some((x) => x.route === r.route);
  const list = change.everyRoute ? [...change.changedRoutes, ...change.allRoutes.filter((r) => !isChanged(r))] : change.changedRoutes;
  const budget = { left: ROUTE_SWEEP_PER_RUN };
  for (const r of list) {
    const ch = isChanged(r), url = r.url ?? flow.routes?.[r.route] ?? null;
    const row = { route: r.route, file: r.file, changed: ch, result: "" };
    report.routes.push(row);
    if (!url) {
      const hit = reached().find((p) => r.re.test(p));
      if (hit) { row.result = `reached by the journeys at ${hit}`; continue; }
      row.result = "NOT opened: its path takes a value and no journey reached it";
      if (ch) ctx.failures.push({ code: "UNMAPPED_SCREEN", where: `changed screen ${r.route}`, what: `${r.file} changed, no journey reached it and its path takes a value: add a journey that reaches it, or "routes": { "${r.route}": "<a test URL>" } to the flow` });
      continue;
    }
    if (budget.left <= 0) { row.result = `NOT opened (budget ${ROUTE_SWEEP_PER_RUN} taps)`; if (ch) ctx.failures.push({ code: "UNMAPPED_SCREEN", where: `changed screen ${r.route}`, what: `${r.file} changed and the run's tap budget ran out before it was opened; split the change` }); continue; }
    // A screen only one kind of person can open (a paid adult, one door) gets its own storage: one flow-wide
    // route_storage cannot be two people at once (PBS /own-night is mindset-only, /grief faith-only, 27 Nov 2026).
    const j = { name: `route ${r.route}`, start: url.replace(/^\//, ""), steps: [], storage: flow.route_storage_for?.[r.route] ?? flow.route_storage ?? flow.journeys[0]?.storage };
    const c = await openContext(browser, { flow, origin, scheme: "light", video: null, notes: ctx.notes });
    try {
      await load(c.page, joinUrl(target, j.start), flow, j.storage);
      await c.page.waitForTimeout(500);
      const landed = local(pathOf(c.page.url()));
      const where = `changed screen ${r.route}`;
      if (!r.re.test(landed) && !(flow.routes?.[r.route] && landed === local(pathOf(joinUrl(target, j.start))))) {
        row.result = `opening it went to ${landed} (it needs sign-in or data first)`;
        if (ch) ctx.failures.push({ code: "UNMAPPED_SCREEN", where, what: `${r.file} changed and opening ${url} went to ${landed}: add a journey that reaches it (with test values), or route_storage (route_storage_for { "${r.route}": {…} } for this screen alone) to the flow` });
        continue;
      }
      const err = await errorScreen(c.page, flow);
      const cons = c.errors.splice(0).filter((e) => !consoleOk(flow, e));
      const file = join(out, `route-${slug(r.route) || "home"}.png`);
      await c.page.screenshot({ path: file, fullPage: true, animations: "disabled", timeout: 60_000 }).catch(() => {});
      if (existsSync(file)) report.shots.push({ label: file.split("/").pop(), file: file.split("/").pop() });
      if (err) ctx.failures.push({ code: "ERROR_SCREEN", where: `route ${r.route}`, what: `opening it shows ${err}` });
      for (const e of cons) ctx.failures.push({ code: "CONSOLE_ERROR", where: `route ${r.route}`, what: e });
      if (err) { row.result = `ERROR_SCREEN: ${err}`; continue; }
      ctx.out = join(out, "sweep-tmp", slug(j.name)); mkdirSync(ctx.out, { recursive: true });
      const sw = await sweep(browser, flow, target, origin, j, 0, c, ctx, ch ? SWEEP_PER_SCREEN : SWEEP_PER_ROUTE, budget);
      const sh = await sweepSheet(j.name, sw.shots);
      report.sweeps.push({ journey: j.name, step: 0, results: sw.results, left: sw.left, sheet: sh?.split("/").pop() ?? null });
      const dead = sw.results.filter((x) => x.result === "DEAD" || x.result === "STATE_HIDDEN").length;
      row.result = `opened; ${sw.results.length} controls tapped here${dead ? ` (${dead} failed)` : ""}, ${sw.found - sw.results.length - sw.left.length} already swept by the journeys${sw.left.length ? `, ${sw.left.length} over the budget` : ""}`;
      if (!sw.found && ch) ctx.failures.push({ code: "STEP_UNREACHABLE", where, what: "the changed screen opened with no control a person can tap (a broken or wrong screen)" });
    } finally { await c.ctx.close().catch(() => {}); }
  }
}

// ─── Self-test: the broken-fixture proof ─────────────────────────────────────────────────────────

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "tap-through");
/** A flow file as the run reads it: a file that is not JSON comes back carrying why, so FLOW_INVALID says so. */
export function readFlow(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch (e) { return { journeys: [], error: e.message.split("\n")[0] }; }
}
const readList = (path) => (path ? readFileSync(path, "utf8").split("\n").map((s) => s.trim()).filter(Boolean) : null);

function serve(dir, { spa = false } = {}) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" };
  const writes = [];
  const srv = createServer((req, res) => {
    if (!["GET", "HEAD"].includes(req.method)) writes.push(`${req.method} ${req.url}`);
    const p = join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/$/, "/index.html"));
    // spa: every path is the app (as an expo-router web build serves it); else a missing file is a 404.
    const f = p.startsWith(dir) && existsSync(p) && !p.endsWith("/") ? p : spa ? join(dir, "index.html") : null;
    if (!f) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": types[extname(f)] ?? "application/octet-stream" }); res.end(readFileSync(f));
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r({ url: `http://127.0.0.1:${srv.address().port}/`, writes, close: () => srv.close() })));
}

/** Each fixture must end exactly as expected, or the self-test fails (and with it the PR). */
export async function selfTest({ chromium = null, log = console.log, keep = null } = {}) {
  const srv = await serve(FIXTURES), app = await serve(join(FIXTURES, "routes"), { spa: true });
  const tmp = keep ? resolve(keep) : join(tmpdir(), `tap-self-${Date.now()}`);
  const flowOf = (n) => readFlow(join(FIXTURES, n));
  // The path-routed fixture app's repo (expo-router layout); each change case names the files it changed.
  const files = readList(join(FIXTURES, "routes", "files.txt"));
  const routes = { flow: "routes/routes.flow.json", target: app.url, files };
  const cases = [
    { name: "a working app passes", flow: "good.flow.json", target: srv.url, exit: 0 },
    { name: "a write the flow did not mock is blocked, never sent", flow: "good.flow.json", target: srv.url, exit: 0, blocked: "POST" },
    { name: "a dead button and an unbuilt paywall promise fail by name", flow: "broken.flow.json", target: srv.url, exit: 1, codes: ["DEAD_BUTTON", "PROMISE_UNBUILT", "CONSOLE_ERROR", "STEP_UNREACHABLE"],
      // each planted sweep defect by its own control: a dead "Buy now" with a :focus style is DEAD (not "its look
      // changed"), a tap that draws and then throws is a CONSOLE_ERROR, a hidden-state radio is STATE_HIDDEN not DEAD
      has: [["DEAD_BUTTON", "Buy now"], ["CONSOLE_ERROR", "planted crash after tap"], ["STATE_HIDDEN", "Monthly, chosen"]], lacks: [["DEAD_BUTTON", "Monthly, chosen"]], sheets: 1 },
    { name: "a swept screen with nothing to tap is unreachable, never ok", flow: "no-controls.flow.json", target: srv.url, exit: 1, has: [["STEP_UNREACHABLE", "no control"]] },
    { name: "a flow file that is not JSON is a named stop that says why", flow: "invalid.flow.json", target: srv.url, exit: 9, stop: "FLOW_INVALID", says: "could not be read" },
    { name: "a changed screen the journeys reach and sweep passes", ...routes, changed: ["app/plans.tsx", "tests/plans.test.ts"], exit: 0, routes: ["/plans"] },
    { name: "a changed screen no journey reached is opened and swept", ...routes, changed: ["app/settings/index.tsx"], exit: 1, has: [["DEAD_BUTTON", "Reset"]], lacks: [["DEAD_BUTTON", "Contact"]], routes: ["/settings"] },
    { name: "a changed shared component opens and sweeps every route", ...routes, changed: ["components/Card.tsx"], exit: 1, has: [["DEAD_BUTTON", "Reset"], ["DEAD_BUTTON", "Contact"]] },
    { name: "a changed screen only a member can open, with no storage for it, fails by name", ...routes, changed: ["app/vault.tsx"], exit: 1, has: [["UNMAPPED_SCREEN", "went to /"]] },
    { name: "a changed member-only screen with its own route_storage_for is opened and swept", ...routes, flow: "routes/routes-member.flow.json", changed: ["app/vault.tsx"], exit: 1, has: [["DEAD_BUTTON", "Unlock all"]], lacks: [["UNMAPPED_SCREEN", "vault"]], routes: ["/vault"] },
    { name: "route_storage_for with a key that is no route is an invalid flow", flow: "routes/routes-bad-storage.flow.json", target: srv.url, exit: 9, stop: "FLOW_INVALID", says: "route_storage_for" },
    { name: "a changed screen whose path takes a value, never reached, fails by name", ...routes, changed: ["app/item/[id].tsx"], exit: 1, has: [["UNMAPPED_SCREEN", "item/[id]"]] },
    { name: "screen files changed with no route that maps them is a named stop", ...routes, files: ["src/Screen.tsx", "package.json"], changed: ["src/Screen.tsx"], exit: 9, stop: "CHANGED_SCREENS_UNMAPPED" },
    { name: "a flow that taps nothing is a named stop", flow: "taps-nothing.flow.json", target: srv.url, exit: 9, stop: "FLOW_TAPS_NOTHING" },
    { name: "a preview that is down is a named stop", flow: "good.flow.json", target: "http://127.0.0.1:9/", exit: 9, stop: "PREVIEW_DOWN" },
    { name: "a flow file with no journeys is a named stop", flow: "empty.flow.json", target: srv.url, exit: 9, stop: "FLOW_INVALID" },
  ];
  const bad = [];
  try {
    for (const [i, c] of cases.entries()) {
      const r = await run({ flow: flowOf(c.flow), target: c.target, out: join(tmp, String(i)), schemes: ["light"], chromium, changed: c.changed ?? null, files: c.files ?? [] });
      const codes = new Set(r.report.failures.map((f) => f.code));
      const named = (code, text) => r.report.failures.some((f) => f.code === code && `${f.where} ${f.what}`.includes(text));
      const ok = r.exit === c.exit && (c.codes ?? []).every((k) => codes.has(k)) && (!c.stop || r.line.includes(`[${c.stop}]`));
      for (const [code, text] of c.has ?? []) if (!named(code, text)) bad.push(`${c.name}: no ${code} for "${text}" (${r.report.failures.map((f) => `${f.code} ${f.what}`).join(" | ").slice(0, 400)})`);
      for (const [code, text] of c.lacks ?? []) if (named(code, text)) bad.push(`${c.name}: "${text}" was named ${code}, wrongly`);
      if (c.says && !r.line.includes(c.says)) bad.push(`${c.name}: the stop does not say "${c.says}" (${r.line})`);
      for (const rt of c.routes ?? []) if (!r.report.routes.some((x) => x.route === rt && x.result.startsWith("opened"))) bad.push(`${c.name}: the changed screen ${rt} was not opened and swept`);
      // every sweep tap is on a sheet the reviewer opens (review of #509: sweeps left no capture)
      const sheets = r.report.shots.filter((s) => s.file.startsWith("sweep-sheet-") && existsSync(join(tmp, String(i), s.file)));
      if (c.sheets && sheets.length < c.sheets) bad.push(`${c.name}: ${sheets.length} sweep sheets, expected ${c.sheets}`);
      if (JSON.stringify(r.report).includes("[object Object]")) bad.push(`${c.name}: the report says "[object Object]"`);
      if (c.exit === 0 && !r.report.taps) bad.push(`${c.name}: passed having tapped nothing`);
      if (c.blocked && !r.report.facts.some((f) => f.startsWith("writes blocked") && f.includes(c.blocked))) bad.push(`${c.name}: the delete's POST was not recorded as blocked`);
      if (c.blocked && srv.writes.length) bad.push(`${c.name}: the fixture server received ${srv.writes.join(", ")}`);
      log(`${ok ? "ok  " : "FAIL"} ${c.name}: exit ${r.exit}, ${r.line}`);
      if (!ok) bad.push(`${c.name}: expected exit ${c.exit}${c.codes ? ` with ${c.codes.join(", ")}` : ""}${c.stop ? ` [${c.stop}]` : ""}; got exit ${r.exit} (${r.line})`);
      if (c.flow === "broken.flow.json" && !r.report.videos.length) bad.push("the broken run recorded no video");
    }
  } finally { srv.close(); app.close(); if (!keep) rmSync(tmp, { recursive: true, force: true }); }
  if (bad.length) { for (const b of bad) log(`SELF-TEST FAIL ${b}`); return 1; }
  log(`SELF-TEST PASS ${cases.length} fixtures ended as expected`);
  return 0;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────────────────────────

export async function main(argv = process.argv.slice(2), { print = console.log } = {}) {
  if (argv.includes("--self-test")) { const o = argv.indexOf("--out"); return selfTest({ log: print, keep: o >= 0 ? argv[o + 1] : null }); }
  const a = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) a[argv[i].slice(2)] = argv[++i];
  if (!a.flow || !a.target || !a.out) { print("usage: tap-through.mjs --flow <tap-through.json> --target <preview URL> --out <dir> [--schemes light,dark] [--changed <changed.txt> --files <files.txt>]"); return 64; }
  if (a.changed && !a.files) { print("NAMED STOP [FLOW_INVALID] --changed needs --files (the repo's file list) to map screens"); return 9; }
  const out = resolve(a.out);
  const flow = readFlow(a.flow);
  const r = await run({ flow, target: a.target, out, schemes: (a.schemes ?? "light,dark").split(",").filter(Boolean), changed: readList(a.changed), files: readList(a.files) ?? [] });
  for (const f of r.report.failures) print(`${f.code} ${f.where}: ${f.what}`);
  print(r.line);
  print(`OUTPUT ${r.report.taps} taps, ${r.report.shots.length} captures, ${r.report.videos.length} videos in ${out}`);
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, [`### Tap-through: ${flow?.app ?? "?"}`, "", r.line, "", ...r.report.failures.map((f) => `- **${f.code}** ${f.where}: ${f.what}`), "", ...r.report.facts.map((x) => `- ${x.slice(0, 400)}`), ""].join("\n"), { flag: "a" });
  return r.exit;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then((code) => process.exit(code), (e) => { console.error(e.stack ?? e.message); process.exit(9); });
}
