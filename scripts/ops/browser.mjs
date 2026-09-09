#!/usr/bin/env node
/**
 * A BROWSER ANY EMPLOYEE CAN USE, AND A SEPARATE ONE FOR EACH OF THEM.
 *
 * ─── Her words, 9 September 2026 ───────────────────────────────────────────
 *
 *   "why cant all employees have the rights simone now has"
 *
 * She is right, and the honest answer is that nothing was ever stopping them. Simone got a real
 * Chrome because she was the first employee who needed one, and the launch logic ended up inside
 * `kdp-browser.mjs` where only she could reach it. Nothing about it is KDP-specific and nothing
 * about it is Simone-specific. Every other employee has been told, in effect, that anything behind a
 * login is impossible — which turned a missing capability into a standing excuse.
 *
 * ─── What makes this work, and each part is load-bearing ───────────────────
 *
 * 1. HER OWN CHROME (`channel: "chrome"`), not Playwright's bundled build. Sites fingerprint the
 *    browser; a session established in real Chrome and reused by a different binary is a challenge
 *    waiting to happen — and on a publishing or banking account a challenge is an account lock.
 * 2. A PERSISTENT PROFILE DIRECTORY. Cookies and local storage live on her Mac between runs, so a
 *    scheduled job at 07:00 with nobody present is signed in because she signed in once, weeks ago.
 * 3. HEADLESS BY DEFAULT, HEADED ONLY FOR SIGN-IN. The one moment a human is required is the one
 *    moment a window appears.
 * 4. NO PASSWORD ANYWHERE IN THIS SYSTEM. There is no credential read, no field filled, no vault
 *    key involved. `signin` opens a window and waits for her. That is not an inconvenience to be
 *    optimised away: an automation that CAN type her password is an automation that can be made to
 *    type it somewhere else.
 *
 * ─── ONE PROFILE PER EMPLOYEE, AND THIS IS THE PART THAT MATTERS MOST ──────
 *
 * The obvious build is one shared browser for everybody. It is also the one that would eventually
 * cost her something real: `~/.boss-os/kdp-profile` holds a live authenticated Amazon PUBLISHING
 * session, and a shared browser means any employee's run — a research sweep, a link check, anything
 * — is one bad navigation away from acting on her KDP account.
 *
 * So each employee gets `~/.boss-os/browser/<name>/`, authenticated only to what that employee
 * actually needs, and an employee who never signs into anything simply has an empty profile that can
 * still read the open web. It is the same isolation already drawn between her two businesses, and
 * between her local credentials and the Worker: separation by default, sharing only where somebody
 * decided to share.
 *
 * ─── EVERY OUTCOME IS NAMED, AND THEY DO NOT SHARE A SENTENCE ─────────────
 *
 * The prompt this replaces said "if the browser is unreachable her laptop is shut" — one sentence
 * mapping every possible failure onto one harmless explanation, which is exactly how a permanent
 * structural absence survived for weeks. These are five different facts and they get five different
 * messages and five different exit codes:
 *
 *   BROWSER_OK           — a browser started and the page looked the way it should.
 *   SESSION_EXPIRED      — the browser works; the saved sign-in is gone. ONE named act fixes it.
 *   BROWSER_UNAVAILABLE  — Playwright or Chrome is not on this machine. A bug, not bad luck.
 *   SITE_UNREACHABLE     — the network refused or the page timed out. Transient, and says so.
 *   WOKE_LATE            — the machine was asleep at the scheduled moment. Benign, and reported as
 *                          an EXTRA line beside the real outcome rather than instead of it, because
 *                          "late" and "broken" are not the same news.
 *
 * ─── Rule 0 ────────────────────────────────────────────────────────────────
 *
 * It may not exit 0 having established nothing. Every path prints exactly one `BROWSER:` outcome
 * line and exits non-zero for anything but BROWSER_OK.
 *
 *   npm run browser:signin -- --profile camille --url https://example.com/login
 *   npm run browser:read   -- --profile camille --url https://example.com/page
 *   npm run browser:where  -- --profile camille
 */

import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const COMMAND = args[0] && !args[0].startsWith("--") ? args[0] : "doctor";
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 || i + 1 >= args.length ? fallback : args[i + 1];
};

/**
 * Where a named profile lives.
 *
 * KDP KEEPS ITS ORIGINAL DIRECTORY. She signed into Amazon there by hand and that session is worth
 * more than a tidy path; moving it would silently sign Simone out and the failure would arrive on a
 * Friday. The alias is written down here rather than remembered.
 */
const LEGACY = { kdp: `${process.env.HOME}/.boss-os/kdp-profile` };

export function profilePath(name) {
  const clean = String(name ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(clean)) return null;
  return LEGACY[clean] ?? `${process.env.HOME}/.boss-os/browser/${clean}`;
}

/**
 * Does this page look signed in, signed out, or like something else?
 *
 * DECIDED FROM THE URL AND THE PAGE, NOT FROM THE ABSENCE OF AN ERROR. Every site answers a
 * signed-out request with a perfectly successful sign-in page, so "the navigation worked" says
 * nothing whatever about whether the session survived.
 *
 * Both tests are overridable per surface, because "what a signed-in page looks like" is the one
 * thing that genuinely differs between them and the one thing a generic harness cannot guess.
 */
const DEFAULT_SIGNED_OUT = /\/(ap\/signin|ap\/mfa|signin|login|sign-in|log-in|auth|sso)\b|[?&](redirect_uri|returnUrl|next)=/i;

export function classify(url, text, { signedOutWhen, signedInWhen } = {}) {
  const out = signedOutWhen ? new RegExp(signedOutWhen, "i") : DEFAULT_SIGNED_OUT;
  if (out.test(url)) return "signed_out";
  if (signedInWhen) return new RegExp(signedInWhen, "i").test(text) ? "signed_in" : "unknown";
  // With no marker to look for, a page that loaded and is not a sign-in form is as much as this can
  // honestly claim. It says `reachable`, not `signed_in` — the distinction is the point.
  return "reachable";
}

/** One line, one outcome, always. Callers parse this and nothing else. */
function say(outcome, detail, exitCode) {
  console.log(`BROWSER: ${outcome} — ${detail}`);
  process.exitCode = exitCode;
}

/**
 * Was this run supposed to happen a while ago?
 *
 * `--due HH:MM` lets a scheduled caller say when its slot was. A machine that was asleep at 07:00
 * and ran at 11:12 is not a broken job, and saying so IN ITS OWN LINE is what stops "late" from
 * being read as "failed" — or, worse, from being the excuse that covers a real bug.
 */
export function lateness(due, now = new Date()) {
  if (!due) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(due));
  if (!m) return null;
  const slot = new Date(now);
  slot.setHours(Number(m[1]), Number(m[2]), 0, 0);
  const minutes = Math.round((now - slot) / 60_000);
  return minutes >= 30 ? minutes : null;
}

export async function openProfile(name, { headed = false } = {}) {
  const dir = profilePath(name);
  if (!dir) throw new Error(`"${name}" is not a usable profile name (letters, digits, dash, underscore)`);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true });
  const { chromium } = await import("playwright");
  const context = await chromium.launchPersistentContext(dir, {
    channel: "chrome",
    headless: !headed,
    viewport: { width: 1440, height: 900 },
  });
  return { context, dir };
}

async function main() {
  const profile = flag("profile", process.env.BOSS_OS_BROWSER_PROFILE ?? "shared");
  const url = flag("url");
  const dir = profilePath(profile);
  const timeoutMs = Number(flag("timeout", process.env.BOSS_OS_BROWSER_TIMEOUT_MS ?? 60_000));
  const late = lateness(flag("due"));

  if (!dir) {
    say("BROWSER_UNAVAILABLE", `"${profile}" is not a usable profile name. Use letters, digits, dash or underscore.`, 4);
    return;
  }

  if (COMMAND === "where") {
    // No browser needed, and it still establishes something: where this employee's session lives.
    say("BROWSER_OK", `${profile}'s session lives in ${dir}`, 0);
    return;
  }

  if (!url) {
    say("BROWSER_UNAVAILABLE", `--url is required for \`${COMMAND}\`. Nothing was opened.`, 4);
    return;
  }

  let context;
  try {
    ({ context } = await openProfile(profile, { headed: COMMAND === "signin" || args.includes("--headed") }));
  } catch (err) {
    say(
      "BROWSER_UNAVAILABLE",
      `Chrome could not be started for ${profile}: ${String(err?.message ?? err).slice(0, 300)}. ` +
        "This is a bug on this machine, not a closed laptop — Playwright and Google Chrome both need to be present.",
      4,
    );
    return;
  }

  const page = context.pages()[0] ?? (await context.newPage());
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  } catch (err) {
    await context.close();
    say(
      "SITE_UNREACHABLE",
      `${url} did not answer within ${timeoutMs / 1000}s: ${String(err?.message ?? err).slice(0, 200)}. ` +
        "This one is transient — the next run tries again.",
      5,
    );
    return;
  }

  const signedInWhen = flag("signed-in-when");
  const signedOutWhen = flag("signed-out-when");
  const text = await page.locator("body").innerText().catch(() => "");
  let state = classify(page.url(), text, { signedInWhen, signedOutWhen });

  if (COMMAND === "signin") {
    /*
     * SHE SIGNS IN. NOTHING HERE DOES.
     *
     * The window is visible and this waits for the signed-in marker to appear. No password field is
     * filled, no credential is read, and the wait is bounded so a window left open by accident does
     * not hold a process for ever.
     */
    console.log(`A Chrome window is open on ${url} using ${profile}'s own profile.`);
    console.log("Sign in there. This waits, then saves the session so scheduled runs need nobody present.");
    const deadline = Date.now() + Number(process.env.BOSS_OS_SIGNIN_WINDOW_MS ?? 10 * 60_000);
    while (state !== "signed_in" && state !== "reachable" && Date.now() < deadline) {
      await page.waitForTimeout(2000);
      const now = await page.locator("body").innerText().catch(() => "");
      state = classify(page.url(), now, { signedInWhen, signedOutWhen });
    }
    await context.close();
    if (state === "signed_out") {
      say("SESSION_EXPIRED", `the window closed still on a sign-in page, so nothing was saved for ${profile}. Run it again.`, 6);
    } else {
      say("BROWSER_OK", `${profile} is signed in and the session is saved in ${dir}. Scheduled runs reuse it with nothing open.`, 0);
    }
    return;
  }

  if (state === "signed_out") {
    await context.close();
    say(
      "SESSION_EXPIRED",
      `the browser works; ${profile}'s saved session for this site is gone. Sign in ONCE: ` +
        `\`npm run browser:signin -- --profile ${profile} --url ${url}\`. ` +
        "No password goes near this system — the window is for you.",
      6,
    );
    return;
  }

  if (COMMAND === "read") {
    /*
     * READ, NEVER WRITE. This command exists so a scheduled run can establish what is actually true
     * on a page rather than taking somebody's word for it. It clicks nothing and submits nothing.
     */
    const out = flag("out");
    if (out) {
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, text);
    }
    await context.close();
    if (late) console.log(`BROWSER: WOKE_LATE — this ran ${late} minutes after its slot. The read itself is fine.`);
    say("BROWSER_OK", `${text.length} characters read from ${url}${out ? ` and written to ${out}` : ""}`, 0);
    return;
  }

  await context.close();
  if (late) console.log(`BROWSER: WOKE_LATE — this ran ${late} minutes after its slot. The check itself is fine.`);
  say("BROWSER_OK", `${profile}'s own Chrome reached ${url}. No tab of yours is needed and none was used.`, 0);
}

/*
 * ONLY WHEN RUN, NEVER WHEN IMPORTED.
 *
 * `kdp-browser.mjs` imports `openProfile` and `classify` from this file so there is ONE copy of the
 * launch logic. Without this guard that import would open a browser as a side effect of asking a
 * question — the same trap that makes `contacts-sync.mjs` unimportable and forced its cadence rule
 * into a file of its own.
 */
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    // Even the unexpected path names itself rather than exiting 0 with a stack trace nobody reads.
    say("BROWSER_UNAVAILABLE", `unexpected failure: ${String(err?.message ?? err).slice(0, 300)}`, 4);
  });
}
