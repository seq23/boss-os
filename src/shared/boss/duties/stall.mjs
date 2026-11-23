/**
 * ONE STUCK ITEM NEVER HALTS A LIST, AND A STALLED JOB IS SAID OUT LOUD (owner's coordinator, 18 Nov 2026).
 *
 * The Kindle publisher stopped its whole run on the first title Amazon had blocked, so ten approved
 * books waited behind one for a week and nobody was told in words that mattered. Two rules, one module:
 *
 *  1. `eachItem` works a list one item at a time. An item that fails is set aside with a NAMED STOP
 *     line, and the next item goes. Only a stop the caller names as run-level (`endsRun`: no sign-in,
 *     the account's limit, the window gone) ends the run, and what was left is returned, never lost.
 *  2. `stallFrom` turns "work is waiting and this run moved none of it" into ONE alert: the subject
 *     "🔴 STOPPED: <job> — <N things> stuck behind <the blocker>", a red banner for the top of the
 *     morning email, and the words of the Open Loops row that holds it (the named-stop path,
 *     POST /open-loops/intake, upsert by repo#STOP). The Mac side (scripts/ops/lib/stall-report.mjs)
 *     emails it only when that row is opened or reopened, so it is sent once per stall, and clears the
 *     row the run the job moves; the morning email shows the banner while the row is open.
 *
 * Pinned by tests/oneStuckItem.test.ts (behaviour, the stall words, and a sweep of every Mac job for
 * the halting shape). Pure apart from the one console line per item set aside.
 */

/** The run-level codes every job shares; a job adds its own through `endsRun`. */
export const ACCOUNT_STOPS = new Set(["SIGNIN", "SIGNIN_NOT_DONE", "NO_PASSCODE", "UNLOCK_REFUSED", "PROFILE_IN_USE"]);

const codeOf = (e) => String(e?.stop ?? (typeof e?.code === "string" ? e.code : "") ?? "").trim() || "FAILED";
const whyOf = (e) => String(e?.message ?? e ?? "").split("\n")[0].slice(0, 300);

/**
 * Works `items` with `fn(item, index)`. Returns { done: [{item, result}], setAside: [{item, code, why}],
 * stopped: {item, code, why} | null, left: items after the run-level stop }.
 */
export async function eachItem(items, fn, { endsRun = (code) => ACCOUNT_STOPS.has(code), label = (x) => String(x?.title ?? x?.name ?? x?.id ?? x), log = console.error } = {}) {
  const list = [...(items ?? [])];
  const done = [], setAside = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    try {
      done.push({ item, result: await fn(item, i) });
    } catch (e) {
      const code = codeOf(e), why = whyOf(e);
      if (endsRun(code, e)) return { done, setAside, stopped: { item, code, why }, left: list.slice(i + 1) };
      setAside.push({ item, code, why });
      log(`NAMED STOP [ITEM_SET_ASIDE] ${label(item)}: ${code} — ${why}. The run goes on to the next one.`);
    }
  }
  return { done, setAside, stopped: null, left: [] };
}

const count = (n, [one, many]) => `${n} ${n === 1 ? one : many}`;

/**
 * A stall, or null. `waiting` is how many items are still waiting after this run; `moved` how many it
 * moved (published, sent, done). A run that moved something, or left nothing waiting, is not a stall.
 *   job: "kdp-new-title" (the Open Loops key), what: "Kindle publishing", noun: ["book", "books"],
 *   blocker: { count: 1, noun: ["blocked book", "blocked books"], name?, why? } — what holds them.
 */
export function stallFrom({ job, what, noun, waiting, moved = 0, blocker, business = "spry", fix = null }) {
  if (!(Number(waiting) > 0) || Number(moved) > 0 || !blocker) return null;
  const behind = blocker.count ? count(blocker.count, blocker.noun) : blocker.noun?.[0] ?? "one stop";
  const headline = `${what} — ${count(waiting, noun)} stuck behind ${behind}`;
  const subject = `🔴 STOPPED: ${headline}`;
  const named = blocker.name ? `"${blocker.name}"${blocker.why ? ` (${blocker.why})` : ""}` : blocker.why ?? "";
  const lines = [
    `Nothing went out this run: ${count(waiting, noun)} ${Number(waiting) === 1 ? "is" : "are"} waiting${named ? ` behind ${named}` : ""}.`,
    fix ?? "It is on the team's Open Loops list to fix; this line stays at the top of your morning email until the job moves again.",
  ];
  return {
    stop: `STALLED_${String(job).toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`.slice(0, 80),
    subject,
    banner: { tone: "red", title: `STOPPED: ${headline}`, lines },
    finish_line: `${what} moves again: the ${count(waiting, noun)} waiting go out.`.slice(0, 300),
    // The morning banner shows only this line (stallBanners), so a stall she alone can clear carries
    // her one action in it (23 Nov 2026 live read: "Nothing went out this run: 10 books are waiting."
    // with no word on what moves them).
    next_step: (fix ? `${lines[0]} ${fix}` : lines[0]).slice(0, 400),
    business,
    // The red block at the very top of the email (the layout's banners), then one plain line on how
    // she hears about it from here. Nothing for her to do: the team's repair job has it.
    mail: {
      subject,
      layout: { banners: [{ tone: "red", title: `STOPPED: ${headline}`, lines }], details: ["You get this email once per stall. Until the job moves, the same red line sits at the top of your morning email."] },
      owner: { layout: "note", why: `${what} has stopped: ${count(waiting, noun)} ${Number(waiting) === 1 ? "is" : "are"} stuck.`, act: "Nothing to do now" },
    },
  };
}

/** An open Open Loops row of a stall, as the morning email's red banner (rows from GET /open-loops). */
export function stallBanners(loops) {
  return (loops ?? [])
    .filter((l) => l?.status === "open" && /#STALLED_[A-Z0-9_]+$/.test(String(l?.source_key ?? "")))
    .map((l) => ({ tone: "red", title: String(l.title ?? "").replace(/^🔴\s*/u, ""), lines: [l.next_step].filter(Boolean) }));
}
