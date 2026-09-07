/**
 * Put today's computed sky in the report's workspace, so it never scrapes for it.
 *
 * WHY THIS EXISTS. The first real Executive Intelligence Report filed three gaps that read like
 * this: "astro-seek.com (403), astrosofa.com (403), astrolibrary.org (404) and cafeastrology (404)
 * all failed retrieval... Positions carry ±1°." It was refusing to invent arcminutes, which is
 * exactly right — and it was going to the open web for a number this system already computes to
 * about one arcminute from Standish elements with IAU 2006 precession.
 *
 * The report was scraping what the machine it runs on already knows. Nothing was wrong with its
 * reasoning; it simply had no way to ask.
 *
 * WHAT IT WRITES. `SKY.json` in the report workspace: every body's longitude, sign and degree for
 * the moment it runs, plus her natal chart and today's transits. Written BEFORE the run starts, so
 * the file is already sitting in the working directory and needs no material, no credential and no
 * network access on the run's part.
 *
 * IT FAILS SOFT AND SAYS SO. A missing SKY.json must not stop the report — the sky is one section
 * of twenty. The run finds no file, files a gap for the section it could not source, and everything
 * else still arrives. That is the behaviour the spec already asks for.
 */

const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const WORKSPACE = process.env.BOSS_OS_REPORT_WORKSPACE ?? `${process.env.HOME}/.boss-os/reports`;
const SOURCING_DIR = process.env.BOSS_OS_SOURCING_WORKSPACE ?? `${process.env.HOME}/.boss-os/sourcing`;

async function main() {
  if (!process.env.BOSS_PASSCODE) {
    console.error("BOSS_PASSCODE is not set; no sky snapshot written.");
    process.exitCode = 0; // Soft: the report still runs.
    return;
  }

  const unlock = await fetch(`${ORIGIN}/api/boss/auth/unlock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }),
  });
  if (!unlock.ok) {
    console.error(`unlock failed (${unlock.status}); no sky snapshot written.`);
    return;
  }
  const cookie = (unlock.headers.get("set-cookie") ?? "").split(";")[0];

  /*
   * BOTH ENDPOINTS, BECAUSE THEY ANSWER DIFFERENT QUESTIONS. `/astro/at` is where everything is in
   * the sky right now; `/astro/natal` is her chart and what is touching it. A report that had only
   * the first could say where Mars is and not what it means for her.
   */
  const [at, natal] = await Promise.all([
    fetch(`${ORIGIN}/api/boss/spirit/astro/at`, { headers: { cookie } }).then((r) => (r.ok ? r.json() : null)),
    fetch(`${ORIGIN}/api/boss/spirit/astro/natal`, { headers: { cookie } }).then((r) => (r.ok ? r.json() : null)),
  ]);

  if (!at?.data) {
    console.error("the sky endpoint returned nothing usable; no snapshot written.");
    return;
  }

  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  await mkdir(WORKSPACE, { recursive: true });

  const snapshot = {
    // A snapshot is only as good as its timestamp, and a report that quotes positions without one
    // is quoting a number with no claim attached.
    computed_at: new Date().toISOString(),
    method: at.data.method ?? null,
    source: "Boss OS — computed locally, not retrieved from any site.",
    sky: at.data,
    natal: natal?.data ?? null,
  };

  await writeFile(join(WORKSPACE, "SKY.json"), JSON.stringify(snapshot, null, 2));
  console.log(`SKY.json written to ${WORKSPACE}`);

  /*
   * KNOWN.json — the firms already on her list, so the daily buyer hunt looks for what is NEW.
   *
   * WITHOUT THIS THE DAILY RUN RE-FINDS THE SAME INSTITUTIONS, which is both why it cost $2 a day
   * and why the list repeated itself. She said the hunt should be daily; making it incremental is
   * what makes daily affordable, and a run that skips what she already has is also just a better
   * run.
   *
   * NAMES ONLY. This is a do-not-repeat list, not a briefing — the thesis, source and verdict for
   * each firm are already in the database where she reviews them.
   */
  const cands = await fetch(`${ORIGIN}/api/boss/wealth/sourcing`, { headers: { cookie } })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const names = Array.isArray(cands?.data?.candidates)
    ? cands.data.candidates.map((c) => c.name).filter(Boolean)
    : null;

  if (names) {
    await mkdir(SOURCING_DIR, { recursive: true });
    await writeFile(join(SOURCING_DIR, "KNOWN.json"), JSON.stringify({
      computed_at: new Date().toISOString(),
      note: "Firms already on her list. Do not deliver these again — find what is new.",
      count: names.length,
      names,
    }, null, 2));
    console.log(`KNOWN.json — ${names.length} firms already on the list.`);
  } else {
    // Soft: a missing KNOWN.json costs a duplicated candidate, not a lost run.
    console.error("Could not read the candidate list; KNOWN.json not written.");
  }
}

// NEVER THROWS INTO THE LAUNCH AGENT. This runs immediately before the report; a crash here that
// took the whole job down would trade three gaps for no report at all.
main().catch((err) => {
  console.error(`sky snapshot failed: ${err?.message ?? err}`);
});
