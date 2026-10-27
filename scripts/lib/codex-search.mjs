/*
 * A DELIBERATE COPY of West Peek OS's Codex half of scripts/lib/seat-search.mjs (1 Oct 2026): the two repos share
 * no package, and this file has no dependencies. A change to the rule goes to both.
 *
 * COUNTING WHAT THE CODEX SEAT ACTUALLY DID. The briefing's research run was graded on a file the model wrote
 * (`delivers.json`) and on the last line of stdout — neither says whether a single web search ran. A report written
 * from memory, with citations the model never opened, is indistinguishable from one written from twenty pages. The
 * CLI's own event stream is the only record that is not the model's account of itself, so it is read here.
 *
 * `codex exec --json -c web_search=live` writes one `item.completed` of type `web_search` per search AND per page it
 * opens or searches inside. The fixture tests/fixtures/codex-search-probe.jsonl is verbatim from the owner's Mac
 * (captured 1 Oct 2026 by West Peek OS's probe); this parser is tested against it.
 *
 * PURE: text in, numbers out. It does not judge the answer, only whether searching happened.
 */

const MAX_QUERIES = 60;

function jsonLines(stdout) {
  return String(stdout ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{"))
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((o) => o && typeof o === "object");
}

/**
 * @param {string} stdout the JSONL stream from `codex exec --json`
 * @returns {{ events: number, queries: string[], answer: string, errorText: string, terminal: "completed" | "failed" | null, jsonl: boolean }}
 */
export function parseCodexSearch(stdout) {
  let events = 0;
  const queries = [];
  let answer = "";
  let errorText = "";
  // `turn.completed` is a finish, `turn.failed` a failure, neither a cut-off stream. A bare `error` event is NOT
  // terminal: Codex emits them for retries and reconnects before a turn that then completes.
  let terminal = null;
  const rows = jsonLines(stdout);
  for (const o of rows) {
    if (o.type === "item.completed" && o.item?.type === "web_search") {
      events += 1;
      const q = typeof o.item.query === "string" ? o.item.query : "";
      if (q && queries.length < MAX_QUERIES) queries.push(q.slice(0, 300));
    } else if (o.type === "item.completed" && o.item?.type === "agent_message" && typeof o.item.text === "string") {
      // The answer is the LAST agent message; earlier ones are the model narrating what it is about to do.
      answer = o.item.text;
    } else if (o.type === "error" && typeof o.message === "string") {
      errorText = o.message;
    } else if (o.type === "turn.completed") {
      terminal = "completed";
    } else if (o.type === "turn.failed") {
      terminal = "failed";
      errorText = String(o.error?.message ?? errorText ?? "");
    }
  }
  return { events, queries, answer: answer.trim(), errorText: errorText.trim(), terminal, jsonl: rows.length > 0 };
}

/**
 * What a RESEARCH run's stream says about whether the run may be believed.
 *
 *   { ok: true,  searches }        the turn finished and at least one search is on the record
 *   { ok: false, reason }          it did not — and `reason` is a sentence a person can read on the Today screen
 *
 * A stream with no JSON rows at all is NOT judged here (`ok: true, searches: null`): that is a CLI that ignored
 * `--json`, and refusing every briefing on a format change would be a worse fault than the one this exists for. The
 * caller records that nothing was counted.
 *
 * ZERO SEARCHES SPLITS ON AN OBSERVED FACT, NEVER ON KEYWORD-READING THE MODEL'S WORDS (27 Oct 2026).
 * `researchWasSeen` once told her a report "made up a figure" even when the run produced no deliverable
 * at all — a refusal, not a fabrication, and the wrong fix went looking in this file twice because the
 * sentence read like a grade of the model's prose rather than an observation. `delivered` is the one
 * fact that tells the two apart: whether a `delivers.json` is actually on disk, read by the caller
 * before this is called, never guessed from the model's words here. The run FAILS either way.
 *
 * @param {ReturnType<typeof parseCodexSearch>} parsed
 * @param {{ delivered?: boolean }} [opts] whether a deliverable file was found on disk; defaults to
 *   `true` so every existing caller and pin keeps today's sentence until it says otherwise.
 */
export function researchWasSeen(parsed, { delivered = true } = {}) {
  if (!parsed.jsonl) return { ok: true, searches: null };
  if (parsed.terminal === "failed") {
    return { ok: false, reason: `Codex reported an error before it finished its turn: ${parsed.errorText.slice(0, 300) || "no reason given"}.` };
  }
  if (parsed.events < 1) {
    if (!delivered) {
      const lastMessage = (parsed.answer || parsed.errorText || "").trim().slice(0, 300) || "(no message)";
      return { ok: false, reason: `Codex produced no report and ran no search. Its own account: ${lastMessage}` };
    }
    return {
      ok: false,
      reason:
        "Codex answered without running a single web search, so what it wrote was not used: a research report is believed only " +
        "with searches counted in the CLI's own record, and a figure it could not have read is a figure it made up.",
    };
  }
  return { ok: true, searches: parsed.events };
}
