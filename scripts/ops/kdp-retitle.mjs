#!/usr/bin/env node
/**
 * SIMONE CHANGES ONE TITLE'S SUBTITLE AND RESUBMITS — Amazon's "Option 1" for a repetitive-terms flag.
 *
 * ─── Why this exists ───────────────────────────────────────────────────────
 *
 * 12 and 14 Sep 2026: Amazon's content review flagged The Gift Letter because "gift letter" appeared
 * in both title and subtitle, and offered Option 1: edit the details and resubmit within five days.
 * Nothing did it; on 21 Sep Amazon wrote it will not make the book available. The fix is a metadata
 * edit — unambiguous and reversible — and the ONE thing that is her decision is the wording, which
 * Simone proposes by email and executes here on her "approved".
 *
 * ─── What it does, and does not ────────────────────────────────────────────
 *
 *   - Opens the title's DETAILS page in Simone's own Chrome profile (`~/.boss-os/browser/simone/`).
 *   - Changes ONLY the subtitle. Title, author, description, keywords, categories: untouched, and the
 *     page's values for title and author are checked against `kdp-register.json` first — a title
 *     that no longer reads as the register says is a NAMED STOP, not an edit onto whatever is there.
 *   - Saves through content and pricing, presses Publish, and reads the BOOKSHELF for the state.
 *     `RETITLE: live|in_review|blocked` comes from the shelf, never from the click.
 *   - Writes nothing to Amazon in her name: no email, no case, no reply. Option 1 needs none.
 *   - NO VAULT. The run that calls this (`claude -p`) has none; the browser profile is the credential.
 *
 * Rule 0: every path prints exactly one `RETITLE:` line and a non-zero exit names why.
 *
 *   npm run kdp:retitle -- --ref A1EYXUFGFV7CN6 --subtitle "A Template for Documenting Family Funds Toward a Home Purchase"
 *   npm run kdp:retitle -- --ref … --subtitle "…" --dry-run      # everything except Save/Publish
 */
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openProfile } from "./browser.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTER = process.env.BOSS_OS_KDP_REGISTER ?? join(HERE, "kdp-register.json");
const BOOKSHELF = "https://kdp.amazon.com/en_US/bookshelf";
const TIMEOUT_MS = Number(process.env.KDP_BROWSER_TIMEOUT_MS ?? 60_000);
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const DRY_RUN = args.includes("--dry-run");
const HEADED = args.includes("--headed");
const PROFILE = flag("profile") ?? "simone";

function out(state, detail, code = 0) { console.log(`RETITLE: ${state} — ${detail}`); process.exitCode = code; }

/** The rule Amazon applied: no word of 4+ letters shared between title and subtitle (case-insensitive). Pure, for the test. */
export function repeatedTerms(title, subtitle) {
  const words = (s) => new Set(String(s).toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const a = words(title); const b = words(subtitle);
  return [...a].filter((w) => b.has(w) && !["with", "your", "from", "that", "this", "when"].includes(w));
}

/**
 * WHERE THE TITLE AND SUBTITLE LIVE, PER FORMAT.
 *
 * 27 Sep 2026 this script stopped at `no_fields` on The Gift Letter: it only knew the PRINT book's
 * ids (`data-print-book-*`), and the title is a Kindle eBook, whose details step names them
 * `data-title` / `data-subtitle`. The owner was then asked to make the edit by hand, and the edit
 * went to Zora, who cannot open a browser. So: eBook ids first, print ids second, and the visible
 * label ("Book Title", "Subtitle") last, so a renamed id degrades to the label instead of a stop.
 */
export const FIELD_SELECTORS = Object.freeze({
  title: ['#data-title', 'input[name="data[title]"]', '#data-print-book-title', 'input[name="data[print_book][title]"]', 'input[id*="book-title"]'],
  subtitle: ['#data-subtitle', 'input[name="data[subtitle]"]', '#data-print-book-subtitle', 'input[name="data[print_book][subtitle]"]', 'input[id*="book-subtitle"]'],
});
const FIELD_LABELS = { title: /^\s*Book Title\s*$/i, subtitle: /^\s*Subtitle/i };

async function findField(page, which) {
  for (const sel of FIELD_SELECTORS[which]) {
    const el = page.locator(sel).first();
    if (await el.count().catch(() => 0)) return el;
  }
  const byLabel = page.getByLabel(FIELD_LABELS[which]).first();
  if (await byLabel.count().catch(() => 0)) return byLabel;
  return null;
}

async function main() {
  const ref = flag("ref"); const subtitle = (flag("subtitle") ?? "").trim();
  if (!ref || !subtitle) return out("usage", "--ref <title_ref> --subtitle \"<wording>\" are both required. Nothing was opened.", 2);
  const register = JSON.parse(await readFile(REGISTER, "utf8"));
  const entry = (register.titles ?? []).find((t) => t.title_ref === ref);
  if (!entry) return out("unknown_title", `${ref} is not in kdp-register.json. Nothing was opened.`, 3);
  const repeats = repeatedTerms(entry.title, subtitle);
  if (repeats.length) return out("still_repetitive", `the subtitle repeats "${repeats.join('", "')}" from the title "${entry.title}" — Amazon would flag it again. Nothing was opened.`, 4);

  let context;
  try { ({ context } = await openProfile(PROFILE, { headed: HEADED })); }
  catch (err) { return out("browser_unavailable", `${String(err?.message ?? err).slice(0, 200)}`, 5); }
  const page = context.pages()[0] ?? (await context.newPage());
  try {
    await page.goto(`https://kdp.amazon.com/en_US/title-setup/kindle/${ref}/details`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
    await page.waitForTimeout(7000);
    if (/\/ap\/signin|\/ap\/mfa/.test(page.url())) return out("reauth_required", `Amazon wants a fresh sign-in before it lets anything edit ${ref}. Simone signs in herself: npm run kdp:signin:auto (through the vault); the headed window is the last resort.`, 6);
    if (/\/bookshelf/.test(page.url())) {
      /*
       * A BLOCKED TITLE IS NOT EDITABLE ON KDP. Proven 21 Sep 2026: the bookshelf offers
       * digital_edit_details-<ref> for every title except the blocked one, whose row offers only
       * Archive; its title-setup URLs bounce here. Option 1 cannot be done from the bookshelf; the
       * door is Amazon's review thread, and a reply on it is hers to approve.
       */
      const others = await page.locator('a[id^="digital_edit_details-"]').count().catch(() => 0);
      const mine = await page.locator(`a[id="digital_edit_details-${ref}"]`).count().catch(() => 0);
      if (others > 0 && mine === 0) return out("blocked_not_editable", `${ref} has no Edit eBook details entry on the bookshelf (${others} other titles do) — a BLOCKED title cannot be edited by the publisher. The door is a reply on Amazon's review thread, which is hers to approve; see kdp-register.json facts_about_kdp.`, 13);
      return out("elsewhere", `landed on the bookshelf instead of the details page and it offers no edit entries at all — the session cannot edit.`, 7);
    }
    if (!/kdp\.amazon\.com/.test(page.url())) return out("elsewhere", `landed on ${page.url().slice(0, 120)} instead of the details page.`, 7);

    // The Kindle eBook ids first, the print ids second, then the visible label. See FIELD_SELECTORS.
    const titleField = await findField(page, "title");
    const subtitleField = await findField(page, "subtitle");
    if (!titleField || !subtitleField) {
      const ids = await page.evaluate(() => [...document.querySelectorAll("input[id], input[name]")].map((e) => e.id || e.getAttribute("name")).filter((x) => /title/i.test(x)).slice(0, 12).join(", ")).catch(() => "");
      return out("no_fields", `the details page has no title/subtitle fields where expected (${page.url().slice(0, 100)}); title-like inputs on the page: ${ids || "none"} — nothing was edited.`, 8);
    }
    const liveTitle = (await titleField.inputValue()).trim();
    if (liveTitle !== entry.title) return out("title_mismatch", `the page's title is "${liveTitle}" and the register says "${entry.title}" — refusing to edit a book that is not the one recorded.`, 9);
    const before = (await subtitleField.inputValue()).trim();
    await subtitleField.fill(subtitle);
    if (DRY_RUN) return out("dry_run", `would change the subtitle of "${entry.title}" from "${before}" to "${subtitle}"; Save and Publish deliberately not clicked.`, 0);

    // Save & Continue: details → content → pricing.
    for (let step = 0; step < 2; step += 1) {
      const save = page.locator('#save-and-continue-announce, button:has-text("Save and Continue"), text=/Save and Continue/i').first();
      if (!(await save.count())) return out("no_save", `no Save and Continue on ${page.url().slice(0, 100)} — the subtitle was typed and not saved.`, 10);
      await save.click({ timeout: 15_000 });
      await page.waitForTimeout(9000);
      if (/\/ap\/signin|\/ap\/mfa/.test(page.url())) return out("reauth_required", `the session lost edit access mid-save. Fix: npm run browser:signin -- --profile ${PROFILE} --url ${BOOKSHELF}`, 6);
    }
    let clicked = false;
    for (const s of ['text=/Publish Your Kindle eBook/i', '#save-and-publish-announce', 'text=/^Publish$/i']) {
      const el = page.locator(s).first();
      if (await el.count().catch(() => 0)) { await el.click({ timeout: 15_000 }).catch(() => {}); clicked = true; break; }
    }
    if (!clicked) {
      const msg = await page.evaluate(() => [...document.querySelectorAll('[class*="error"], [class*="alert"], [role="alert"]')].map((e) => (e.innerText || "").trim()).filter(Boolean).join(" | ").slice(0, 400)).catch(() => "");
      return out("no_publish", `saved the subtitle but found no Publish control on ${page.url().slice(0, 100)} (${msg || "no message"}).`, 11);
    }
    await page.waitForTimeout(12_000);
    await page.goto(BOOKSHELF, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
    await page.waitForTimeout(6000);
    const state = await page.evaluate((id) => {
      const a = document.querySelector(`a[href*="/${id}/"]`);
      let el = a; for (let i = 0; i < 12 && el; i += 1) { el = el.parentElement; if (el && (el.innerText || "").length > 120) break; }
      const lines = (el?.innerText || "").split("\n").map((s) => s.trim());
      return (lines.find((l) => /^(Draft|Live|In Review|Publishing|Blocked)$/i.test(l)) || "").toLowerCase();
    }, ref).catch(() => "");
    const norm = state === "live" ? "live" : state === "in review" || state === "publishing" ? "in_review" : state === "draft" ? "draft" : "blocked";
    return out(norm, `"${entry.title}" — subtitle changed from "${before}" to "${subtitle}", Publish pressed, bookshelf says ${state || "nothing readable"}.`, norm === "live" || norm === "in_review" ? 0 : 12);
  } finally {
    await context.close().catch(() => {});
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => out("failed", String(err?.message ?? err).slice(0, 300), 1));
}
