#!/usr/bin/env node
/**
 * UNITS SOLD, READ BY CODE — once a run, before the model ever runs.
 *
 * ─── Why this exists ────────────────────────────────────────────────────────
 *
 * Until 2 Nov 2026 the only instruction to write `~/.boss-os/kdp/units.json` was one paragraph of
 * English inside `kdp-surface-prompt.md`. Nothing checked that it happened, and nothing read the
 * number back: the 1 Nov run printed `KDP-SURFACE-COMPLETE: quiet` in 39 seconds, derived purely
 * from mail triage, having never opened a browser. A specification no code reads is a wish.
 *
 * This is the read, in code, wired into `kdp-surface.sh` right after Simone's own sign-in and
 * before the model runs — the same place `kdp-open.mjs` and `kdp-signin.mjs` already sit.
 *
 * ─── What it reads, and what it refuses to ──────────────────────────────────
 *
 * It opens Simone's own profile through `openProfile` — never a second launcher
 * (`validate:shared-browser` allows exactly one) — navigates the KDP reports page, and captures the
 * dashboard's own JSON network responses while it loads. `lib/kdp-units.mjs` parses those bodies, or
 * falls back to the rendered page text, into units sold per day. Numbers only: no title, no buyer,
 * no money, matching the rest of this file's rule for anything it touches.
 *
 * A page that cannot be read — signed out, nothing parseable, a timeout — writes
 * `{ at, unread: "<one named reason>" }` instead of a count. `scorecard-readers.mjs` turns that
 * into a NAMED STOP: a page that was not read must never be reported as a true zero sold.
 *
 *   npm run kdp:units
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { openProfile } from "./browser.mjs";
import { parseUnits } from "./lib/kdp-units.mjs";

const OUT_DIR = process.env.BOSS_OS_KDP_DIR ?? `${process.env.HOME}/.boss-os/kdp`;
const OUT = join(OUT_DIR, "units.json");
const REPORTS_URL = "https://kdp.amazon.com/en_US/reports-new";
const PROFILE = process.env.KDP_UNITS_PROFILE ?? "simone";
const TIMEOUT_MS = Number(process.env.KDP_BROWSER_TIMEOUT_MS ?? 60_000);

async function out(result, code = 0) {
  await mkdir(OUT_DIR, { recursive: true }).catch(() => {});
  await writeFile(OUT, JSON.stringify(result, null, 2) + "\n").catch(() => {});
  const line = result.unread
    ? `not read: ${result.unread}`
    : `${Object.keys(result.days).length} day(s) via ${result.source}`;
  console.log(`KDP-UNITS: ${line}`);
  process.exitCode = code;
}

/** A URL with its query stripped, for anything printed. */
const safeUrl = (u) => String(u ?? "").split("?")[0].slice(0, 120);

async function main() {
  const at = new Date().toISOString();
  let context;
  try {
    ({ context } = await openProfile(PROFILE, { headed: false }));
  } catch (err) {
    return out({ at, unread: `browser unavailable: ${String(err?.message ?? err).slice(0, 200)}` }, 4);
  }
  const page = context.pages()[0] ?? (await context.newPage());
  const captured = [];
  page.on("response", async (res) => {
    try {
      if (!/kdp\.amazon\.com/.test(res.url())) return;
      if (!(res.headers()["content-type"] ?? "").includes("application/json")) return;
      captured.push(await res.json());
    } catch {
      // Not JSON, or the body was already consumed elsewhere — skipped, not fatal.
    }
  });
  try {
    await page.goto(REPORTS_URL, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
    await page.waitForTimeout(8000);
    if (/\/ap\/(signin|mfa|cvf)/.test(page.url())) {
      return out({ at, unread: `the session is signed out at ${safeUrl(page.url())}; kdp-signin.mjs runs before this and should have fixed it` }, 6);
    }
    const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    const { days, source } = parseUnits({ captured, text });
    return out({ at, days, source });
  } catch (err) {
    return out({ at, unread: String(err?.message ?? err).slice(0, 300) }, 7);
  } finally {
    await context.close().catch(() => {});
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => out({ at: new Date().toISOString(), unread: String(err?.message ?? err).slice(0, 300) }, 1));
}
