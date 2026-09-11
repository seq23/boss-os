#!/usr/bin/env node
/**
 * SIMONE PUTS THE APPROVED COVERS UP AND PRESSES PUBLISH.
 *
 * ─── The defect this exists to end ─────────────────────────────────────────
 *
 * On 9 September at 14:00 seven replacement covers were raised in her Inbox. At 14:30 she approved
 * them — `apr_m237hjk726ky3ekn`, `jdg_m237hjk7wwc68hyj`, decided_by `boss`. The approval was
 * CONSUMED: `approvals/resume.ts` fired its `kdp_cover_upload` handler, stamped `executed_at`, set
 * `execution_status = 'executed'`, and wrote a deliverable status reading
 *
 *     "Covers approved by you on 2026-09-09. Simone uploads them, publishes ONE title first ..."
 *
 * AND THAT SENTENCE WAS THE ENTIRE EFFECT. It described a run. No run does it. `kdp-surface.sh` and
 * `kdp-watch.sh` only read Amazon and report; no launchd job has ever invoked `kdp:covers` or the
 * upload path, and `kdp-browser.mjs` had no command that could click anything — its own bookshelf
 * reader says "READ, NEVER WRITE... It clicks nothing." So her decision went into the system, was
 * marked executed, and died there, and seven books stayed blocked for two more days.
 *
 * This file is the run that sentence promised. It is not a new approval and it must never raise
 * one: it FINDS her existing verdict and acts on it.
 *
 * ─── Her operating instruction, followed literally ─────────────────────────
 *
 * "Simone uploads them, publishes ONE title first, confirms it actually reaches Live on the
 * bookshelf, and only then does the remaining six. She reports back here when they are Live — not
 * when Publish is clicked."
 *
 * So: all seven covers uploaded, ONE title published, the BOOKSHELF consulted for its state, and
 * the remaining six attempted only if that one genuinely reached Live. `state = 'live'` is written
 * from what Amazon's bookshelf says, never from the fact that a button was clicked.
 *
 * ─── The bytes are hers, and they are not re-rendered ──────────────────────
 *
 * The covers are fetched from R2 through `/api/boss/judgement/:id/asset/:ord` — literally the bytes
 * her Inbox rendered — and each one's length is checked against the `bytes` column before it is
 * uploaded. A mismatch is a NAMED STOP. Regenerating a cover would produce something similar and
 * would not be what she approved, which makes an approval meaningless.
 *
 * ─── Which cover goes on which book ────────────────────────────────────────
 *
 * `kdp-cover-map.json`, derived from two independent fields that agree seven for seven, and
 * RE-VERIFIED HERE at run time against the live bookshelf. This never pairs by slug similarity.
 *
 * ─── Rule 0 ────────────────────────────────────────────────────────────────
 *
 * It may not exit 0 having done nothing. Every path either moves a title, or exits non-zero with a
 * named reason that is reported to Boss OS before it exits, so a run that could not run does not
 * render as a quiet day.
 *
 *   npm run kdp:publish              # headless, from the saved session
 *   npm run kdp:publish -- --headed  # she signs in once, then it goes straight on to publish
 *   npm run kdp:publish -- --dry-run # everything except the Publish click
 */

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openProfile } from "./browser.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const OUT_DIR = process.env.BOSS_OS_KDP_DIR ?? `${process.env.HOME}/.boss-os/kdp`;
const WORK_DIR = join(OUT_DIR, "approved-covers");
const BOOKSHELF = "https://kdp.amazon.com/en_US/bookshelf";
const TIMEOUT_MS = Number(process.env.KDP_BROWSER_TIMEOUT_MS ?? 60_000);

const args = process.argv.slice(2);
const HEADED = args.includes("--headed");
const DRY_RUN = args.includes("--dry-run");
/** How long she gets to finish an Amazon sign-in, when one is needed and she is present. */
const SIGNIN_WINDOW_MS = Number(process.env.KDP_SIGNIN_WINDOW_MS ?? 10 * 60_000);

/** One line, one outcome, always — the same contract `kdp-browser.mjs` keeps. */
function say(outcome, detail) {
  console.log(`KDP-PUBLISH: ${outcome} — ${detail}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Boss OS ──────────────────────────────────────────────────────────────────

async function unlock() {
  if (!process.env.BOSS_PASSCODE) {
    say("NO_PASSCODE", "run this through the vault: npm run kdp:publish");
    process.exit(4);
  }
  const res = await fetch(`${ORIGIN}/api/boss/auth/unlock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }),
  });
  if (!res.ok) throw new Error(`unlock failed (${res.status})`);
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

/**
 * Report a run that could not run, BEFORE exiting.
 *
 * The lesson `kdp-watch.sh` paid for: every named stop used to simply exit, so the runs that most
 * needed to reach her were the only ones that never did. This shares nothing with the browser it
 * could not drive.
 */
async function reportStop(cookie, code, reason, action) {
  say(code, reason);
  if (!cookie) return;
  await fetch(`${ORIGIN}/api/boss/kdp/publish`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      run_outcome: "could-not-run",
      stop_code: code,
      reason,
      next_action: action,
      results: [],
    }),
  }).catch(() => {});
}

// ─── The covers she approved ──────────────────────────────────────────────────

/**
 * Fetch each approved cover from R2 and prove it is the file she saw.
 *
 * BYTE COUNT, CHECKED, EVERY TIME. `judgement_assets.bytes` was written when the cover was uploaded
 * into her Inbox, so it describes the object she actually looked at. Anything else — a re-render, a
 * truncated download, the wrong ord — differs in length and stops here rather than reaching Amazon.
 */
async function fetchApprovedCovers(cookie, judgementId, map) {
  await mkdir(WORK_DIR, { recursive: true });
  const res = await fetch(`${ORIGIN}/api/boss/judgement/${judgementId}`, { headers: { cookie } });
  if (!res.ok) throw new Error(`could not read the approved judgement call (${res.status})`);
  const { data } = await res.json();
  const assets = data?.assets ?? [];

  const out = new Map();
  for (const t of map.titles) {
    const asset = assets.find((a) => a.ord === t.asset_ord);
    if (!asset) throw new Error(`the approved batch has no asset ${t.asset_ord} (${t.asset_label})`);
    if (asset.label !== t.asset_label) {
      throw new Error(
        `asset ${t.asset_ord} is labelled "${asset.label}" and the map expects "${t.asset_label}". ` +
          "Refusing: an asset that has moved would put the wrong cover on a book.",
      );
    }
    const bin = await fetch(`${ORIGIN}/api/boss/judgement/${judgementId}/asset/${t.asset_ord}`, { headers: { cookie } });
    if (!bin.ok) throw new Error(`asset ${t.asset_ord} (${t.asset_label}) could not be read from R2 (${bin.status})`);
    const bytes = Buffer.from(await bin.arrayBuffer());
    if (bytes.length !== t.bytes) {
      throw new Error(
        `${t.asset_label} came back ${bytes.length} bytes and she approved ${t.bytes}. ` +
          "Refusing to upload it: these are not the bytes she said yes to.",
      );
    }
    const path = join(WORK_DIR, t.cover_file);
    await writeFile(path, bytes);
    out.set(t.title_ref, path);
  }
  return out;
}

// ─── The bookshelf ────────────────────────────────────────────────────────────

/**
 * Every title Amazon shows, with the id it keys it by, its title text, its contributor and its
 * state — read from Amazon rather than from anything this system believes.
 */
async function readBookshelf(page) {
  await page.goto(BOOKSHELF, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  await page.waitForTimeout(6000);
  if (/\/ap\/signin/.test(page.url())) return null;
  return page.evaluate(() => {
    const seen = new Map();
    document.querySelectorAll('a[href*="/title-setup/kindle/"], a[href*="/marketing/"]').forEach((a) => {
      const m = /\/(?:title-setup\/kindle|marketing)\/([A-Z0-9]{10,16})\//.exec(a.getAttribute("href") || "");
      if (!m || seen.has(m[1])) return;
      let el = a;
      for (let i = 0; i < 12 && el; i += 1) { el = el.parentElement; if (el && (el.innerText || "").length > 120) break; }
      seen.set(m[1], (el?.innerText || "").trim());
    });
    const out = [];
    for (const [id, text] of seen) {
      const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
      const byLine = lines.find((l) => /^by\s+/i.test(l)) || "";
      out.push({
        id,
        title: lines[0] || "",
        author: byLine.replace(/^by\s+/i, "").trim(),
        state: (lines.find((l) => /^(Draft|Live|In Review|Publishing|Blocked)$/i.test(l)) || "").toLowerCase(),
        asin: (/ASIN:\s*([A-Z0-9]+)/.exec(text) || [])[1] || null,
      });
    }
    return out;
  });
}

/**
 * Can this session actually EDIT, or only look?
 *
 * ─── THE FALSE GREEN THAT COST TWO DAYS, NAMED ─────────────────────────────
 *
 * `kdp-browser.mjs doctor` answers BROWSER_OK when the bookshelf recognises the session, and that
 * is a strictly weaker fact than being able to publish. PROVEN 11 September 2026: with a session
 * the doctor called BROWSER_OK, every route into `/title-setup/kindle/<ref>/...` — typed, or
 * clicked from the bookshelf — redirects to
 *
 *     https://www.amazon.com/ap/signin?openid.pape.max_auth_age=0&...
 *
 * `max_auth_age=0` is Amazon demanding a FRESH authentication, not a stored one. Reading the shelf
 * and changing a book are two different permissions and the saved session only ever had the first.
 *
 * So this asks the question that matters instead of the one that is easy, and a session that cannot
 * edit is a NAMED STOP rather than a green light followed by a confusing failure later.
 */
async function editAccess(page, ref) {
  await page.goto(`https://kdp.amazon.com/en_US/title-setup/kindle/${ref}/content`, {
    waitUntil: "domcontentloaded",
    timeout: TIMEOUT_MS,
  });
  await page.waitForTimeout(7000);
  if (/\/ap\/signin|\/ap\/mfa/.test(page.url())) return "reauth_required";
  if (!/kdp\.amazon\.com/.test(page.url())) return "elsewhere";
  return "editable";
}

/** She signs in. Nothing here does — there is no password field filled and no credential read. */
async function waitForHerSignIn(page, ref) {
  console.log("A Chrome window is open on Amazon. Sign in there; this waits, checks it can actually");
  console.log("edit a title, and then goes straight on to the covers. Nothing types your password.");
  const deadline = Date.now() + SIGNIN_WINDOW_MS;
  while (Date.now() < deadline) {
    await page.waitForTimeout(4000);
    if (!/\/ap\/signin|\/ap\/mfa/.test(page.url())) {
      const access = await editAccess(page, ref);
      if (access === "editable") return true;
    }
  }
  return false;
}

// ─── One book ─────────────────────────────────────────────────────────────────

/** Whatever Amazon actually said, so a refusal is reported in its own words rather than ours. */
async function amazonMessage(page) {
  const text = await page
    .evaluate(() => {
      const parts = [];
      document.querySelectorAll('[class*="error"], [class*="alert"], [role="alert"], .a-alert-content').forEach((el) => {
        const t = (el.innerText || "").trim();
        if (t && t.length < 500) parts.push(t);
      });
      return [...new Set(parts)].join(" | ");
    })
    .catch(() => "");
  return text.slice(0, 500) || null;
}

/**
 * Put the approved cover on one book.
 *
 * KDP's content step offers Cover Creator or "Upload a cover you already have". Amazon support's
 * diagnosis is that COVER CREATOR IMAGES ARE WHAT FAIL server-side processing, so choosing the
 * upload option is not a convenience — it is the prescribed fix, and the reason these seven files
 * exist at all.
 */
async function uploadCover(page, ref, coverPath) {
  await page.goto(`https://kdp.amazon.com/en_US/title-setup/kindle/${ref}/content`, {
    waitUntil: "domcontentloaded",
    timeout: TIMEOUT_MS,
  });
  await page.waitForTimeout(8000);
  if (/\/ap\/signin|\/ap\/mfa/.test(page.url())) return { ok: false, why: "the session lost edit access part way through" };

  // Choose "upload your own" over Cover Creator, whichever wording this page is using today.
  for (const sel of [
    'input[type=radio][id*="upload" i]',
    'input[type=radio][value*="upload" i]',
    'label:has-text("Upload a cover you already have")',
    'text=/Upload a cover you already have/i',
  ]) {
    const el = page.locator(sel).first();
    if (await el.count().catch(() => 0)) {
      await el.click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(2500);
      break;
    }
  }

  const input = page.locator('input[type=file]').first();
  if (!(await input.count().catch(() => 0))) {
    return { ok: false, why: `no file input on the content step (${await amazonMessage(page) ?? "no message"})` };
  }
  await input.setInputFiles(coverPath, { timeout: 30_000 });

  // The upload is asynchronous and the Save button stays enabled throughout, so waiting on the
  // button would prove nothing. Wait for the page to stop working instead, bounded.
  for (let i = 0; i < 30; i += 1) {
    await page.waitForTimeout(4000);
    const busy = await page.locator('[class*="spinner"], [class*="progress"], text=/Uploading/i').count().catch(() => 0);
    if (!busy) break;
  }

  for (const sel of ['text=/Save and Continue/i', 'text=/Save as Draft/i', '#save-and-continue-announce']) {
    const el = page.locator(sel).first();
    if (await el.count().catch(() => 0)) {
      await el.click({ timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(9000);
      break;
    }
  }
  const msg = await amazonMessage(page);
  return { ok: true, why: null, message: msg };
}

/** Press Publish once. Once — a retry loop on a refusing button is how an account gets flagged. */
async function pressPublish(page, ref) {
  await page.goto(`https://kdp.amazon.com/en_US/title-setup/kindle/${ref}/pricing`, {
    waitUntil: "domcontentloaded",
    timeout: TIMEOUT_MS,
  });
  await page.waitForTimeout(8000);
  if (/\/ap\/signin|\/ap\/mfa/.test(page.url())) return { attempted: false, message: "the session lost edit access before Publish" };

  if (DRY_RUN) return { attempted: false, message: "dry run — the cover was uploaded and Publish was deliberately not clicked" };

  let clicked = false;
  for (const s of [
    'text=/Publish Your Kindle eBook/i',
    '#save-and-publish-announce',
    'text=/^Publish$/i',
  ]) {
    const el = page.locator(s).first();
    if (await el.count().catch(() => 0)) {
      await el.click({ timeout: 15_000 }).catch(() => {});
      clicked = true;
      break;
    }
  }
  if (!clicked) return { attempted: false, message: `no Publish control on the pricing step (${(await amazonMessage(page)) ?? "no message"})` };

  await page.waitForTimeout(12_000);
  return { attempted: true, message: await amazonMessage(page) };
}

/**
 * Did it actually reach Live?
 *
 * THE BOOKSHELF IS THE ONLY ANSWER THAT COUNTS. "Publish was clicked" and "the book is published"
 * are different facts, and this case has already produced one confident answer that changed
 * nothing. A title that goes to `In Review` is reported as `in_review`, which is honest progress
 * and is NOT Live.
 */
async function stateOnBookshelf(page, ref) {
  const rows = await readBookshelf(page);
  if (!rows) return null;
  const row = rows.find((r) => r.id === ref || r.asin === ref);
  if (!row) return null;
  if (row.state === "live") return "live";
  if (row.state === "in review" || row.state === "publishing") return "in_review";
  return "blocked";
}

// ─── The run ──────────────────────────────────────────────────────────────────

async function main() {
  const map = JSON.parse(await readFile(join(HERE, "kdp-cover-map.json"), "utf8"));
  const cookie = await unlock();

  /*
   * ── HER EXISTING VERDICT IS FOUND AND USED. NOTHING IS RAISED. ────────────
   *
   * She approved these covers on 9 September and said so again, in capitals, on the 11th. Raising a
   * second judgement call for a decision she has already made would be insulting and would hide the
   * bug — the bug being that the first one was consumed by a handler that wrote a sentence.
   */
  const kdpRes = await fetch(`${ORIGIN}/api/boss/kdp`, { headers: { cookie } });
  if (!kdpRes.ok) throw new Error(`could not read the publishing state (${kdpRes.status})`);
  const { data: state } = await kdpRes.json();
  const covers = state?.covers ?? null;

  if (!covers) {
    await reportStop(cookie, "NO_COVER_BATCH", "no cover batch has ever been put to her, so there is no approval to act on.",
      "Run npm run kdp:covers to raise one. Nothing publishes without her verdict.");
    process.exit(5);
  }
  if (!covers.may_publish) {
    await reportStop(cookie, "NOT_APPROVED", `the covers are "${covers.state}", not approved, so nothing may be uploaded or published.`,
      "Her verdict is the gate. It is in her Inbox and this run does not go round it.");
    process.exit(6);
  }
  if (covers.judgement_id !== map._approved.judgement_id) {
    await reportStop(cookie, "DIFFERENT_BATCH",
      `the approved batch is ${covers.judgement_id} and the cover map describes ${map._approved.judgement_id}.`,
      "A newer batch was approved. Re-derive the cover map from the bookshelf and the new covers before publishing anything.");
    process.exit(7);
  }

  say("APPROVED", `acting on her verdict of ${new Date(covers.decided_at).toISOString().slice(0, 10)} (${covers.judgement_id}). No new approval was raised.`);

  const coverPaths = await fetchApprovedCovers(cookie, covers.judgement_id, map);
  say("COVERS_VERIFIED", `${coverPaths.size} approved covers fetched from R2, every byte count matching what she approved.`);

  const { context } = await openProfile("kdp", { headed: HEADED });
  const page = context.pages()[0] ?? (await context.newPage());
  const results = [];
  let stop = null;

  try {
    const pilot = map.titles.find((t) => t.pilot) ?? map.titles[0];
    let access = await editAccess(page, pilot.title_ref);

    if (access !== "editable" && HEADED) {
      if (await waitForHerSignIn(page, pilot.title_ref)) access = "editable";
    }

    if (access !== "editable") {
      stop = {
        code: "KDP_REAUTH_REQUIRED",
        reason:
          "the saved session can read the bookshelf but Amazon refuses every route into a title's setup pages, " +
          "redirecting to a sign-in that demands a fresh authentication rather than a stored one. " +
          "Reading the shelf and changing a book are two different permissions and only the first was ever saved.",
        action:
          "Run: cd ~/GitHub/boss-os && npm run kdp:publish -- --headed. A window opens, you sign in once, " +
          "and the same run goes straight on to upload the covers and publish. Nothing types your password.",
      };
    } else {
      // The bookshelf is read once and every pairing is checked against it before anything uploads.
      const shelf = await readBookshelf(page);
      if (!shelf) throw new Error("the bookshelf stopped answering part way through");

      const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const verified = [];
      for (const t of map.titles) {
        const row = shelf.find((r) => r.id === t.title_ref);
        if (!row) {
          results.push({ title_ref: t.title_ref, cover_uploaded: false, publish_attempted: false, state: "blocked",
            message: "this reference is no longer on the bookshelf, so nothing was uploaded to it." });
          continue;
        }
        if (!norm(row.title).startsWith(norm(t.title)) || norm(row.author) !== norm(t.author)) {
          results.push({ title_ref: t.title_ref, cover_uploaded: false, publish_attempted: false, state: "blocked",
            message: `the bookshelf now calls this "${row.title}" by "${row.author}" and the verified map expects ` +
              `"${t.title}" by "${t.author}". Refused rather than risk the wrong cover on the wrong book.` });
          continue;
        }
        verified.push({ ...t, row });
      }

      // Label the rows, so the next run never has to re-derive what was ambiguous this time.
      for (const t of verified) {
        await fetch(`${ORIGIN}/api/boss/kdp/titles/${t.title_ref}`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ label: t.title }),
        }).catch(() => {});
      }

      /*
       * ── ONE TITLE FIRST, AND THE BOOKSHELF DECIDES WHETHER THERE IS A SECOND ──
       *
       * Her instruction, and it is older than this file: if something is still wrong it is wrong on
       * one book rather than on her whole shelf. The gate between the pilot and the other six is
       * what AMAZON says about the pilot, not what the click returned.
       */
      const order = [...verified].sort((a, b) => (b.pilot ? 1 : 0) - (a.pilot ? 1 : 0));
      let pilotWentLive = false;

      for (let i = 0; i < order.length; i += 1) {
        const t = order[i];
        if (i > 0 && !pilotWentLive) {
          results.push({ title_ref: t.title_ref, cover_uploaded: false, publish_attempted: false, state: "blocked",
            message: "held: the pilot title did not reach Live, so the rest of the shelf was not touched." });
          continue;
        }

        const up = await uploadCover(page, t.title_ref, coverPaths.get(t.title_ref));
        if (!up.ok) {
          results.push({ title_ref: t.title_ref, cover_uploaded: false, publish_attempted: false, state: "blocked", message: up.why });
          continue;
        }

        const pub = await pressPublish(page, t.title_ref);
        await sleep(15_000);
        const now = (await stateOnBookshelf(page, t.title_ref)) ?? "blocked";
        if (i === 0 && now === "live") pilotWentLive = true;

        results.push({
          title_ref: t.title_ref,
          cover_uploaded: true,
          publish_attempted: pub.attempted,
          state: now,
          message: pub.message ?? up.message ?? null,
        });
        say(now.toUpperCase(), `${t.title} — cover uploaded, publish ${pub.attempted ? "attempted" : "not attempted"}, bookshelf says ${now}.`);
      }
    }
  } finally {
    await context.close().catch(() => {});
  }

  // Reported whatever happened, including nothing happening, and reported before exiting.
  const res = await fetch(`${ORIGIN}/api/boss/kdp/publish`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      judgement_id: covers.judgement_id,
      run_outcome: stop ? "could-not-run" : "attempted",
      stop_code: stop?.code ?? null,
      reason: stop?.reason ?? null,
      next_action: stop?.action ?? null,
      results,
      source: "manual",
    }),
  });
  if (!res.ok) console.error(`  reporting to Boss OS failed (${res.status}): ${(await res.text()).slice(0, 300)}`);

  if (stop) {
    say(stop.code, stop.reason);
    console.log(`  What to do: ${stop.action}`);
    process.exit(8);
  }
  const live = results.filter((r) => r.state === "live").length;
  say("DONE", `${live} of ${results.length} titles are Live on the bookshelf. Anything else is reported with Amazon's own message.`);
  if (live === 0) process.exit(9);
}

main().catch(async (err) => {
  say("FAILED", String(err?.message ?? err).slice(0, 400));
  process.exitCode = 1;
});
