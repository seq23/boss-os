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

import { PAGE_PATH } from "../openLoops/openLoops.mjs";
import SCHEDULE from "../schedule/manifest.json" with { type: "json" };
import { slotWords } from "../schedule/clock.mjs";

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

/**
 * HER ONE ACTION, BY WHAT HOLDS THE WORK (23 Nov 2026 live read: the morning banner said "Nothing went
 * out this run: 10 books are waiting." and nothing on what moves them). Keyed by the blocker's words,
 * which `stallFrom` writes into the title ("… stuck behind <blocker>"), so the alert email and the
 * morning banner both carry it, and an Open Loops row written before this line existed still gets it.
 * A blocker with no entry here is the team's to clear, never hers.
 *
 * The KDP session lives in the job's own Chrome profile on her Mac, so a sign-in in any other browser
 * (a link in this email, her phone) does not move the books, and a line to type at a terminal is never
 * hers (plain.mjs drops it). What moves them is her answer to the sign-in email during the next run, so
 * the line names when that run is, read from the Schedule manifest (the launchd job's own slots).
 */
const runWhen = (id) => {
  const slots = SCHEDULE.rows.find((r) => r.id === id)?.slots ?? [];
  return slots.length ? ` (${slots.map(slotWords).join(" and ")} CT)` : "";
};
export const HER_ACTIONS = Object.freeze({
  "the KDP sign-in": `To move them, be near your Mac for the next Kindle run${runWhen("kdp-publish")}: when Amazon's sign-in email comes, sign in to Amazon in the Chrome window it opens there. The books go out in that run.`,
});
/** Her action for a stall title, or null. Pure. */
export const herActionFor = (title) => HER_ACTIONS[/stuck behind (.+)$/u.exec(String(title ?? "").trim())?.[1] ?? ""] ?? null;

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
  fix = fix ?? HER_ACTIONS[behind] ?? null;
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

/**
 * An open Open Loops row of a stall, as the morning email's red banner (rows from GET /open-loops).
 * Her action comes from the title (HER_ACTIONS), never only from the stored next_step, which may
 * predate it; the button opens that row on the Open Loops page.
 */
export function stallBanners(loops, { origin = "" } = {}) {
  const page = /^https:\/\//.test(origin) ? `${origin}${PAGE_PATH}` : null;
  // A failed read is unknown, never "nothing stalled": an empty top of the email would say all is well.
  if (!Array.isArray(loops)) return [{ tone: "red", title: "Stopped jobs could not be checked this morning", lines: ["The Open Loops list did not load, so a job that stopped would not show here. The Open Loops page lists every one."], ...(page ? { button: { label: "See Open Loops", url: page } } : {}) }];
  return loops
    .filter((l) => l?.status === "open" && /#STALLED_[A-Z0-9_]+$/.test(String(l?.source_key ?? "")))
    .map((l) => {
      const title = String(l.title ?? "").replace(/^🔴\s*/u, "");
      const act = herActionFor(title);
      const said = act ? String(l.next_step ?? "").replace(act, "").trim() : String(l.next_step ?? "").trim();
      const url = page ? `${page}${l.id ? `&loop=${encodeURIComponent(l.id)}` : ""}` : null;
      return { tone: "red", title, lines: [said, act].filter(Boolean), ...(url ? { button: { label: "See it on Open Loops", url } } : {}) };
    });
}
