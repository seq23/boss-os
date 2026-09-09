#!/usr/bin/env node
/**
 * A BROWSER OF SIMONE'S OWN, SO NOTHING DEPENDS ON A TAB THE OWNER LEFT OPEN.
 *
 * ─── The two facts this exists between ─────────────────────────────────────
 *
 * 1. PROVEN, 9 September 2026: a `claude -p` process invoked the way `kdp-watch.sh` invokes it has
 *    NO Chrome tools at all. Asked to `ToolSearch` for `mcp__claude-in-chrome__tabs_context_mcp`,
 *    a detached run answered:
 *
 *        CHROME-PROBE: TOOLS=no CALL=not-attempted DETAIL=no browser MCP available
 *
 *    `TOOLS=no` is not "the browser did not answer". There is nothing to answer: those tools come
 *    from an extension that attaches to an INTERACTIVE session, and a scheduled run is not one. So
 *    the watcher could never have uploaded a cover, on any Friday, with any tab open.
 *
 * 2. Her requirement, the same day: "yea id rather it work regardless if my tab is open and if my
 *    laptop is open or shut."
 *
 * A capability that depends on her leaving a particular tab open is a trap she springs the first
 * time she tidies her browser, and it then fails on a Friday with no explanation. So the dependency
 * is designed out rather than documented: this launches its OWN Chrome against its OWN profile
 * directory, which nothing else touches and no tab is needed for.
 *
 * ─── The profile is the whole trick ────────────────────────────────────────
 *
 * `launchPersistentContext` keeps cookies and local storage in a directory on her Mac. She signs
 * into KDP in it ONCE, by hand, in a visible window — and every scheduled run afterwards reuses that
 * session with nothing open and nobody present.
 *
 * NO PASSWORD EVER PASSES THROUGH THIS FILE. There is no credential to read, no field to fill, and
 * no vault key involved: `signin` opens a window and waits for her to finish. That is deliberate and
 * it is not an inconvenience to be optimised away — an automation that could type her Amazon
 * password is an automation that can be made to type it somewhere else.
 *
 * ─── Every outcome is NAMED, and only one of them is benign ────────────────
 *
 * The prompt this replaces said "if the browser is unreachable her laptop is shut, and that is
 * reported rather than treated as a finding" — one sentence mapping every possible failure onto one
 * harmless explanation, which is precisely why a permanent structural absence went unnoticed for as
 * long as it did. These do not share a message:
 *
 *   BROWSER_OK            — a browser started and KDP recognised the session.
 *   KDP_SESSION_EXPIRED   — the browser works and the saved session is gone. ONE named act fixes it.
 *   BROWSER_UNAVAILABLE   — Playwright or Chrome is not on this machine. A bug, not bad luck.
 *   KDP_UNREACHABLE       — the network refused. Transient, and says so.
 *
 * ─── Rule 0 ────────────────────────────────────────────────────────────────
 *
 * It may not exit 0 having established nothing. Every path prints exactly one `KDP-BROWSER:` line
 * and exits non-zero for anything but BROWSER_OK, so a caller cannot mistake silence for a healthy
 * session.
 */

const PROFILE = process.env.BOSS_OS_KDP_PROFILE ?? `${process.env.HOME}/.boss-os/kdp-profile`;
const BOOKSHELF = "https://kdp.amazon.com/en_US/bookshelf";
const COMMAND = process.argv[2] ?? "doctor";
/** Sign-in is the one mode a human is present for, so it is the one mode with a visible window. */
const HEADED = COMMAND === "signin" || process.argv.includes("--headed");
const TIMEOUT_MS = Number(process.env.KDP_BROWSER_TIMEOUT_MS ?? 60_000);

/** One line, one outcome, always. The caller parses this and nothing else. */
function say(outcome, detail, exitCode) {
  console.log(`KDP-BROWSER: ${outcome} — ${detail}`);
  process.exitCode = exitCode;
}

async function openBrowser() {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(PROFILE, { recursive: true });
  const { chromium } = await import("playwright");
  /*
   * `channel: "chrome"` uses HER installed Google Chrome rather than Playwright's bundled build.
   * Amazon fingerprints browsers on a publishing account, and a session established in real Chrome
   * that is then reused by a differently-fingerprinted binary is a challenge waiting to happen.
   */
  return chromium.launchPersistentContext(PROFILE, {
    channel: "chrome",
    headless: !HEADED,
    viewport: { width: 1440, height: 900 },
  });
}

/**
 * Is this a signed-in bookshelf, a sign-in page, or something else entirely?
 *
 * DECIDED FROM THE URL AND THE PAGE, NOT FROM THE ABSENCE OF AN ERROR. Amazon answers a signed-out
 * request with a perfectly successful sign-in page, so "the navigation worked" says nothing at all.
 */
async function classify(page) {
  const url = page.url();
  if (/\/ap\/signin|\/ap\/mfa|signin\?/.test(url)) return "signed_out";
  if (!/kdp\.amazon\.com/.test(url)) return "elsewhere";
  const bookshelf = await page.locator('text=/Bookshelf|Your Books/i').count().catch(() => 0);
  return bookshelf > 0 ? "signed_in" : "unknown";
}

async function main() {
  if (COMMAND === "where") {
    // No browser needed, and it still establishes something: where the session lives.
    say("BROWSER_OK", `profile directory is ${PROFILE}`, 0);
    return;
  }

  let context;
  try {
    context = await openBrowser();
  } catch (err) {
    const why = String(err?.message ?? err).slice(0, 300);
    say(
      "BROWSER_UNAVAILABLE",
      `Chrome could not be started for Simone's own profile: ${why}. ` +
        "This is a bug on this machine, not a closed laptop — Playwright and Google Chrome both need to be present.",
      4,
    );
    return;
  }

  const page = context.pages()[0] ?? (await context.newPage());
  try {
    await page.goto(BOOKSHELF, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  } catch (err) {
    await context.close();
    say(
      "KDP_UNREACHABLE",
      `kdp.amazon.com did not answer within ${TIMEOUT_MS / 1000}s: ${String(err?.message ?? err).slice(0, 200)}. ` +
        "This one is transient — the next run tries again.",
      5,
    );
    return;
  }

  if (COMMAND === "signin") {
    /*
     * SHE SIGNS IN. NOTHING HERE DOES.
     *
     * The window is visible and this waits for the bookshelf to appear. There is no password field
     * filled, no credential read, and no vault involved — and the wait is bounded, so leaving the
     * window open by accident does not hold a process for ever.
     */
    console.log("A Chrome window is open on KDP. Sign in there; this waits and then saves the session.");
    const deadline = Date.now() + Number(process.env.KDP_SIGNIN_WINDOW_MS ?? 10 * 60_000);
    let state = await classify(page);
    while (state !== "signed_in" && Date.now() < deadline) {
      await page.waitForTimeout(2000);
      state = await classify(page);
    }
    await context.close();
    if (state === "signed_in") {
      say("BROWSER_OK", `signed in, and the session is saved in ${PROFILE}. Scheduled runs reuse it with nothing open.`, 0);
    } else {
      say("KDP_SESSION_EXPIRED", "the sign-in window closed without reaching the bookshelf, so nothing was saved. Run it again.", 6);
    }
    return;
  }

  const state = await classify(page);

  if (COMMAND === "bookshelf" && state === "signed_in") {
    /*
     * READ, NEVER WRITE. This command exists so a scheduled run can establish what is actually true
     * on the bookshelf rather than taking a support agent's word for it — the same scepticism the
     * prompt already applies to email. It clicks nothing.
     */
    const text = await page.locator("body").innerText().catch(() => "");
    const { mkdir, writeFile } = await import("node:fs/promises");
    const outDir = process.env.BOSS_OS_KDP_DIR ?? `${process.env.HOME}/.boss-os/kdp`;
    await mkdir(outDir, { recursive: true });
    await writeFile(`${outDir}/bookshelf.txt`, text);
    await context.close();
    say("BROWSER_OK", `bookshelf read, ${text.length} characters written to ${outDir}/bookshelf.txt`, 0);
    return;
  }

  await context.close();

  if (state === "signed_in") {
    say("BROWSER_OK", "Simone's own Chrome profile is signed into KDP. No tab of yours is needed and none was used.", 0);
    return;
  }
  if (state === "signed_out") {
    say(
      "KDP_SESSION_EXPIRED",
      "the browser works; the saved KDP session is gone. Sign in ONCE in Simone's own profile: " +
        "`npm run kdp:signin`. Nothing else is needed and no password goes near this system.",
      6,
    );
    return;
  }
  say(
    "KDP_UNREACHABLE",
    `the page loaded but did not look like a bookshelf or a sign-in (${page.url().slice(0, 120)}). Worth a look by hand.`,
    5,
  );
}

main().catch((err) => {
  // Even the unexpected path names itself rather than exiting 0 with a stack trace nobody reads.
  say("BROWSER_UNAVAILABLE", `unexpected failure: ${String(err?.message ?? err).slice(0, 300)}`, 4);
});
