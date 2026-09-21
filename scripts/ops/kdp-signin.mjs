#!/usr/bin/env node
/**
 * SIMONE SIGNS IN TO KDP HERSELF. Headless, under her own profile, with the vault's credentials.
 *
 * ─── Her ruling, 21 Sep 2026 ───────────────────────────────────────────────
 *
 *   "i shouldn't have to approve browser sign in — she should use browser tools and sign in."
 *
 * `kdp-browser.mjs signin` opens a HEADED window for her to type into. That is now the LAST resort.
 * This runs first: the Amazon login under `~/.boss-os/browser/simone/`, the address and password
 * from the vault through the governed launch (KDP_ACCOUNT_EMAIL / KDP_ACCOUNT_PASSWORD — never on a
 * command line, never echoed, never in a log), and Amazon's one-time code read from her Gmail.
 *
 * ─── The code comes from her mailbox, through the connector ────────────────
 *
 * Amazon mails the OTP to the account's address, which is her consumer Gmail; a Google service
 * account cannot impersonate a consumer inbox (migration 0207 says so in as many words), so the
 * only path is the Claude Gmail connector, which is bound to exactly that account. A small
 * `claude -p` (Haiku, on her seat — `seatEnv` strips any API key) searches for a fresh Amazon code
 * and prints only the six digits. Polled for up to ~3 minutes.
 *
 * ─── The one case that stays hers ──────────────────────────────────────────
 *
 * A CAPTCHA, or an "approve the notification on your phone" challenge, cannot be answered here.
 * That is a NAMED STOP with the exact one line: `npm run kdp:signin` (the headed window, once).
 * Everything else — signed out, password, email OTP — is Simone's own job.
 *
 * Output: exactly one `KDP-SIGNIN: <state> — <detail>` line and `~/.boss-os/kdp/signin.json`.
 *   ok | ok_already | no_credentials | challenge_needs_her | otp_not_found | wrong_password |
 *   browser_unavailable | failed
 *
 *   npm run kdp:signin:auto                       # through the vault (the wrapper runs this before every triage)
 *   npm run kdp:signin:auto -- --ref A1EYXUFGFV7CN6
 */
import { writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openProfile } from "./browser.mjs";
import { seatEnv } from "./lib/seat-env.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.BOSS_OS_KDP_DIR ?? `${process.env.HOME}/.boss-os/kdp`;
const OUT = join(OUT_DIR, "signin.json");
const BOOKSHELF = "https://kdp.amazon.com/en_US/bookshelf";
const TIMEOUT_MS = Number(process.env.KDP_BROWSER_TIMEOUT_MS ?? 60_000);
const OTP_WINDOW_MS = Number(process.env.KDP_OTP_WINDOW_MS ?? 180_000);
const OTP_MODEL = process.env.KDP_OTP_MODEL ?? "claude-haiku-4-5-20251001";
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const REF = flag("ref") ?? "A1EYXUFGFV7CN6";
const PROFILE = flag("profile") ?? "simone";
const HEADED_LINE = `npm run kdp:signin   (a Chrome window opens on Amazon; sign in there once — nothing types your password)`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** A URL with its query stripped — Amazon puts tokens in the query. */
const safeUrl = (u) => String(u ?? "").split("?")[0].slice(0, 120);

async function out(state, detail, code = 0) {
  await mkdir(OUT_DIR, { recursive: true }).catch(() => {});
  await writeFile(OUT, JSON.stringify({ state, detail, at: new Date().toISOString(), headed_fallback: HEADED_LINE }, null, 2) + "\n").catch(() => {});
  console.log(`KDP-SIGNIN: ${state} — ${detail}`);
  process.exitCode = code;
}

/**
 * Amazon's challenge kinds, from what is VISIBLE on the page — never from the HTML, which mentions
 * "captcha" in its scripts on every sign-in page (the first run read a plain password page as a
 * CAPTCHA that way). Pure over { url, visible: {...} } so the test can drive it.
 */
export function classifyPage(url, visible) {
  const u = String(url ?? ""); const v = visible ?? {};
  if (/kdp\.amazon\.com\/en_US\/title-setup\//.test(u)) return "editable";
  if (v.captcha) return "captcha";
  if (v.push) return "push_approval";
  if (v.otp) return "otp";
  if (v.password) return "password";
  if (v.email) return "email";
  if (/\/ap\/signin|\/ap\/mfa|\/ap\/cvf/.test(u)) return "other_challenge";
  return "elsewhere";
}

/** The bookshelf offers "Edit eBook details" per title only to a session that can edit. A BLOCKED
 *  title has no such entry at all (A1EYXUFGFV7CN6, 21 Sep 2026), so edit access is judged by ANY
 *  title's entry, never by one title's URL. */
async function canEditOnShelf(page) {
  return (await page.locator('a[id^="digital_edit_details-"]').count().catch(() => 0)) > 0;
}

/** What is actually visible on the page right now. */
async function visibleOn(page) {
  const vis = async (sel) => { try { return await page.locator(sel).first().isVisible({ timeout: 1500 }); } catch { return false; } };
  const text = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  return {
    captcha: (await vis("#auth-captcha-image")) || (await vis('img[src*="captcha"]')) || (await vis("input[name=cvf_captcha_input]")) || (await vis("#captchacharacters")),
    push: /Approve the notification|sent a notification to|approve this sign-in on/i.test(text) && !(await vis("#ap_password")),
    otp: (await vis("#auth-mfa-otpcode")) || (await vis("input[name=otpCode]")) || (await vis("#cvf-input-code")) || (await vis("input[name=code]")),
    password: await vis("#ap_password"),
    email: (await vis("#ap_email")) || (await vis("input[name=email]")),
  };
}

/** The six digits in the connector's answer, or null. Pure. */
export function otpIn(text) {
  const m = /KDP-OTP:\s*(\d{6})\b/.exec(String(text ?? ""));
  return m ? m[1] : null;
}

/** Ask her mailbox, through the connector, for a fresh Amazon code. Polls inside the window. */
async function readOtpFromGmail(sinceIso) {
  const prompt = [
    "Load the Gmail tools with ToolSearch (search_threads, get_thread).",
    `Search: newer_than:1h (from:amazon.com OR from:account-update.amazon.com OR from:no-reply@amazon.com) (OTP OR "One-Time Password" OR "one time password" OR "verification code" OR "sign-in attempt" OR code)`,
    `Read the NEWEST message received after ${sinceIso}. If it contains a 6-digit Amazon sign-in / verification code, print exactly one line: KDP-OTP: <the six digits>.`,
    "If there is no such message yet, print exactly: KDP-OTP: none. Print nothing else. Never print anything but that one line.",
  ].join("\n");
  const deadline = Date.now() + OTP_WINDOW_MS;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    const answer = await new Promise((resolve) => {
      const child = spawn("claude", ["-p", prompt, "--model", OTP_MODEL, "--dangerously-skip-permissions"], { env: seatEnv(process.env), stdio: ["ignore", "pipe", "pipe"] });
      let text = "";
      child.stdout.on("data", (d) => { text += d.toString(); });
      child.stderr.on("data", () => {});
      const t = setTimeout(() => child.kill("SIGTERM"), 120_000);
      child.on("close", () => { clearTimeout(t); resolve(text); });
      child.on("error", () => { clearTimeout(t); resolve(""); });
    });
    const code = otpIn(answer);
    if (code) return { code, attempt };
    if (Date.now() + 25_000 >= deadline) break;
    await sleep(25_000);
  }
  return { code: null, attempt };
}

async function main() {
  const email = process.env.KDP_ACCOUNT_EMAIL ?? "";
  const password = process.env.KDP_ACCOUNT_PASSWORD ?? "";
  let context;
  try { ({ context } = await openProfile(PROFILE, { headed: false })); }
  catch (err) { return out("browser_unavailable", String(err?.message ?? err).slice(0, 200), 5); }
  const page = context.pages()[0] ?? (await context.newPage());
  const editUrl = `https://kdp.amazon.com/en_US/title-setup/kindle/${REF}/details`;
  try {
    await page.goto(editUrl, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
    await page.waitForTimeout(6000);
    let kind = classifyPage(page.url(), await visibleOn(page));
    if (kind === "editable") return out("ok_already", `the saved session can edit ${REF} (${safeUrl(page.url())}); nothing typed.`);
    if (kind === "elsewhere" && /\/bookshelf/.test(page.url()) && (await canEditOnShelf(page))) return out("ok_already", `the saved session can edit (the bookshelf offers Edit eBook details); ${REF} itself has no edit entry — a BLOCKED title is not editable on KDP. Nothing typed.`);
    if (!email || !password) return out("no_credentials", `the session cannot edit and KDP_ACCOUNT_EMAIL / KDP_ACCOUNT_PASSWORD are not in this launch — run through the vault. Fallback, once: ${HEADED_LINE}`, 3);

    const startedAt = new Date().toISOString();
    for (let step = 0; step < 6; step += 1) {
      kind = classifyPage(page.url(), await visibleOn(page));
      if (kind === "editable") break;
      if (kind === "captcha") return out("challenge_needs_her", `Amazon is showing a CAPTCHA at ${safeUrl(page.url())}; only a person can answer it. Once: ${HEADED_LINE}`, 6);
      if (kind === "push_approval") return out("challenge_needs_her", `Amazon wants the sign-in approved on your phone (${safeUrl(page.url())}). Approve it there, or once: ${HEADED_LINE}`, 6);
      if (kind === "email") {
        const f = page.locator("#ap_email, input[name=email]").first();
        if (await f.count()) { await f.fill(email); }
        const c = page.locator("#continue, input#continue, button:has-text('Continue')").first();
        if (await c.count()) await c.click({ timeout: 10_000 }).catch(() => {});
        else { const s = page.locator("#signInSubmit").first(); if (await s.count()) { const p = page.locator("#ap_password").first(); if (await p.count()) await p.fill(password); await s.click({ timeout: 10_000 }).catch(() => {}); } }
        await page.waitForTimeout(6000);
        continue;
      }
      if (kind === "password") {
        const p = page.locator("#ap_password, input[name=password]").first();
        await p.fill(password);
        const remember = page.locator("#rememberMe, input[name=rememberMe]").first();
        if (await remember.count()) await remember.check({ timeout: 3000 }).catch(() => {});
        await page.locator("#signInSubmit, input#signInSubmit, button:has-text('Sign in')").first().click({ timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(7000);
        const html = await page.content();
        if (/There was a problem|Your password is incorrect|We cannot find an account/i.test(html) && /\/ap\/signin/.test(page.url())) {
          return out("wrong_password", `Amazon refused the vault's credentials at ${safeUrl(page.url())}. Update KDP_ACCOUNT_PASSWORD in the vault, or once: ${HEADED_LINE}`, 7);
        }
        continue;
      }
      if (kind === "otp") {
        const { code, attempt } = await readOtpFromGmail(startedAt);
        if (!code) return out("otp_not_found", `Amazon asked for a one-time code and none arrived in her Gmail within ${Math.round(OTP_WINDOW_MS / 1000)}s (${attempt} read(s)). If Amazon's 2FA is an authenticator app or a phone push rather than email, that is the fallback she needs: ${HEADED_LINE}`, 8);
        const f = page.locator("#auth-mfa-otpcode, input[name=otpCode], #cvf-input-code, input[name=code]").first();
        await f.fill(code);
        const trust = page.locator("#auth-mfa-remember-device, input[name=rememberDevice]").first();
        if (await trust.count()) await trust.check({ timeout: 3000 }).catch(() => {});
        await page.locator("#auth-signin-button, #cvf-submit-otp-button, input[type=submit], button[type=submit]").first().click({ timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(8000);
        continue;
      }
      if (kind === "other_challenge") return out("challenge_needs_her", `Amazon is showing a step this cannot read at ${safeUrl(page.url())}. Once: ${HEADED_LINE}`, 6);
      // elsewhere: go back to the edit page and re-check.
      await page.goto(editUrl, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
      await page.waitForTimeout(6000);
    }
    await page.goto(editUrl, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
    await page.waitForTimeout(6000);
    kind = classifyPage(page.url(), await visibleOn(page));
    if (kind === "editable") return out("ok", `signed in headless as Simone; ${REF}'s details page opens for editing (${safeUrl(page.url())}).`);
    if (/\/bookshelf/.test(page.url()) && (await canEditOnShelf(page))) return out("ok", `signed in headless as Simone; the bookshelf offers Edit eBook details (${REF} itself has none — a BLOCKED title is not editable on KDP).`);
    return out("failed", `after sign-in the edit page still answers ${kind} at ${safeUrl(page.url())}. Once: ${HEADED_LINE}`, 9);
  } catch (err) {
    return out("failed", String(err?.message ?? err).slice(0, 300), 1);
  } finally {
    await context.close().catch(() => {});
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => out("failed", String(err?.message ?? err).slice(0, 300), 1));
}
