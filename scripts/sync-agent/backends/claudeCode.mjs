/**
 * Stage 2 — the Claude Code backend adapter.
 *
 * The first `agent_executed` backend: migration 0173's `bk_claude_code` row, made real. It turns an
 * approved envelope into one non-interactive `claude --print` invocation on the owner's Mac and
 * turns its output back into the fields backend_runs stores.
 *
 * NO API KEY EXISTS AND NONE IS REQUESTED. This was verified on the machine rather than assumed:
 * `claude` (2.1.263, /opt/homebrew/bin/claude) authenticates through the owner's own logged-in
 * session, held in the macOS keychain as the item "Claude Code-credentials"; there is no
 * ANTHROPIC_API_KEY in the environment and no ~/.claude/.credentials.json on disk. So the cloud half
 * of Boss OS holds no coding credential — nothing to leak, nothing to spend — and that is a property
 * to preserve rather than an accident: buildArgs() never adds an auth flag, and childEnv() strips
 * every variable that looks like a credential before the process starts. If a future envelope ever
 * arrives carrying a key, the runner refuses it (REFUSAL.CREDENTIAL_NOT_LOCAL) rather than using it.
 *
 * THE DENY FLAGS BELOW ARE THE OUTER LAYER, NOT THE ENFORCEMENT. `--disallowedTools` is a request to
 * the CLI, and a request is exactly the thing this design refuses to depend on. The forbidden list is
 * enforced by the runner: the child's environment carries no credentials, every command is scanned
 * before it runs, and the repository's git state is compared before and after so a commit is
 * detected however it was spelled. These flags simply mean the common case never starts.
 *
 * spawnImpl IS INJECTED, defaulting to the real one — the repository's own convention for services
 * that reach outside the process. Tests pass a fake, so the whole of this adapter is exercised
 * without invoking the CLI, calling a model, or spending anything.
 */
import { childEnv } from "../runner.mjs";

/** Tools this backend may never use, spelled the way the CLI spells them. */
export const DENIED_TOOLS = [
  "Bash(git commit:*)",
  "Bash(git merge:*)",
  "Bash(git rebase:*)",
  "Bash(git push:*)",
  "Bash(gh pr create:*)",
  "Bash(gh pr merge:*)",
  "Bash(npm publish:*)",
  "Bash(npm run deploy:*)",
  "Bash(wrangler deploy:*)",
  "Bash(wrangler publish:*)",
  "Bash(wrangler secret:*)",
  "Bash(security find-generic-password:*)",
  "Bash(security find-internet-password:*)",
];

/**
 * The argv for one run.
 *
 * THE PROMPT GOES ON STDIN, NOT IN ARGV. A task's text is untrusted and may be long, may contain
 * anything, and appears in `ps` output if it is an argument — which would put a task's contents in
 * front of every process on the machine. stdin has none of those properties.
 */
export function buildArgs(envelope, { model } = {}) {
  const args = [
    "--print",
    "--output-format", "json",
    /*
     * acceptEdits, with --permission-prompts none.
     *
     * The run is unattended: there is nobody to answer a prompt, and "nobody answers" must mean
     * DENIED rather than "hangs until the timeout". acceptEdits lets it write files — which is the
     * work — while anything that would have prompted is refused automatically.
     */
    "--permission-mode", "acceptEdits",
    "--permission-prompts", "none",
    "--disallowedTools", ...DENIED_TOOLS,
    // No session on disk. An unattended run must not leave a resumable context that a later
    // interactive session could pick up and continue with the untrusted text still in it.
    "--no-session-persistence",
  ];
  /*
   * WEB TOOLS ARE GRANTED EXPLICITLY OR NOT AT ALL.
   *
   * The first live report run reported "WebSearch denied — session has no approval surface", which
   * is correct: `--permission-prompts none` means nobody can say yes, so a tool needing permission
   * is a tool that is off. For a research run that is the difference between reading the news and
   * inventing it.
   *
   * ENUMERATED BY THE RUNNER, NOT BY THE ENVELOPE'S FREE TEXT. `validateEnvelope` refuses any value
   * outside WebSearch and WebFetch before this is reached, so `--allowedTools` can never be handed a
   * tool nobody reviewed. Both are read-only: they fetch, they do not act, and the deny list above
   * is untouched by this.
   */
  const web = Array.isArray(envelope?.web_tools) ? envelope.web_tools : [];
  if (web.length) args.push("--allowedTools", ...web);

  if (model ?? envelope?.model) args.push("--model", String(model ?? envelope.model));
  return args;
}

/**
 * What the CLI's JSON envelope tells us, reduced to the fields the packet needs.
 *
 * DEFENSIVE BECAUSE THE OUTPUT IS DOWNSTREAM OF UNTRUSTED TEXT. A malformed or hostile stdout must
 * produce a packet that says so, not an exception that produces no packet at all — a run that
 * vanishes is worse than a run that failed, because only one of them gets looked at.
 */
export function parseCliJson(stdout) {
  let parsed = null;
  try {
    parsed = JSON.parse(String(stdout ?? ""));
  } catch {
    return { summary: "", is_error: true, cost_micros: 0, parse_error: "stdout was not JSON" };
  }
  const cost = Number(parsed?.total_cost_usd ?? 0);
  return {
    summary: typeof parsed?.result === "string" ? parsed.result : "",
    is_error: parsed?.is_error === true || parsed?.subtype === "error_during_execution",
    // ZERO ON A SUBSCRIPTION SESSION, and that is honest rather than missing: this backend spends
    // through the owner's own plan, so there is no per-run charge to attribute. The field stays so a
    // future keyed backend fills it without a schema change.
    cost_micros: Number.isFinite(cost) ? Math.round(cost * 1_000_000) : 0,
    session_id: parsed?.session_id ?? null,
    num_turns: parsed?.num_turns ?? null,
  };
}

/**
 * Run the CLI once.
 *
 * Returns the adapter half of an evidence packet. It never decides the run's status — executeRun()
 * does that, from things it observed itself — because a backend grading its own homework is the
 * failure this whole design is arranged to avoid.
 */
export async function claudeCodeExecutor({ envelope, prompt, cwd }, { spawnImpl, binary = "claude", readDelivers = defaultReadDelivers } = {}) {
  const spawn = spawnImpl ?? (await import("node:child_process")).spawn;
  const args = buildArgs(envelope);
  const timeoutMs = Math.max(1, Number(envelope?.max_seconds ?? 900)) * 1000;

  const child = spawn(binary, args, {
    cwd,
    env: childEnv(typeof process === "undefined" ? {} : process.env),
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (c) => { stdout += c; });
  child.stderr?.on("data", (c) => { stderr = (stderr + c).slice(-8000); });
  child.stdin?.end(prompt);

  const outcome = await new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    // A HARD TIMEOUT, because an unattended run that hangs holds the single work slot for ever and
    // looks identical to one that is thinking.
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
      finish({ exit_code: 124, timed_out: true });
    }, timeoutMs);
    child.on?.("close", (code) => { clearTimeout(timer); finish({ exit_code: code ?? -1, timed_out: false }); });
    child.on?.("error", (err) => { clearTimeout(timer); finish({ exit_code: -1, timed_out: false, spawn_error: String(err) }); });
  });

  /*
   * THE RECORDED INVOCATION ELIDES THE DENY FLAGS, and this is a real bug found by the runner's own
   * scanner rather than a cosmetic choice. `--disallowedTools "Bash(git commit:*)"` contains the
   * literal text "git commit", so recording the argv verbatim made every single run trip the
   * command scan and fail as a forbidden-action violation — the deny list convicting itself. The
   * scan must stay pattern-based (it is the layer that catches a command however it was spelled), so
   * the fix belongs here: report the flag by count, and leave the exact list in DENIED_TOOLS, which
   * is a constant a reviewer can read.
   */
  const shown = args
    .filter((a) => !DENIED_TOOLS.includes(a))
    .join(" ")
    .replace("--disallowedTools", `--disallowedTools <${DENIED_TOOLS.length} denied tools>`);

  const parsed = parseCliJson(stdout);
  const risks = [];
  if (outcome.timed_out) risks.push(`The run was killed after ${timeoutMs / 1000}s; the working tree may hold a partial change.`);
  if (parsed.parse_error) risks.push("The backend's output could not be parsed, so its own summary is unavailable; the observed facts below still stand.");
  if (outcome.spawn_error) risks.push(`Claude Code could not be started: ${outcome.spawn_error}`);

  /*
   * THE DELIVERABLE IS READ FROM A FILE, NOT PARSED OUT OF THE SUMMARY.
   *
   * Some runs are contracted to produce structured output — the Executive Intelligence Report is
   * sections, gaps, sources and corrections, which the cloud half stores as columns rather than
   * prose. The instruction tells the run to write that as JSON to `delivers.json` in its own
   * workspace, and this reads the file.
   *
   * WHY A FILE AND NOT THE SUMMARY. Everything in `summary` is the CLI's own account — a claim,
   * kept as a claim, per this module's whole design. Fishing a JSON block out of prose would mean
   * this process INTERPRETING that claim, and a summary that happened to quote some JSON would
   * become a delivered report. A file the run wrote and this process read is the same class of
   * evidence as an exit code: observed here, not asserted there.
   *
   * IT IS BOUNDED AND IT NEVER THROWS. A missing file is the ordinary case for every other kind of
   * run. A malformed or enormous one is recorded as a risk and delivers nothing, because the
   * alternative is losing the run's real evidence over a bad payload.
   */
  let delivers = null;
  try {
    const raw = await readDelivers(cwd);
    if (raw === null) {
      // The ordinary case for every other kind of run. Says nothing and reports nothing.
    } else if (raw.length > 1_000_000) {
      risks.push(`delivers.json is ${raw.length} bytes, past the 1MB cap; nothing was delivered from it.`);
    } else {
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        risks.push("delivers.json did not contain a JSON object; nothing was delivered from it.");
      } else {
        delivers = parsed;
      }
    }
  } catch (err) {
    risks.push(`delivers.json could not be read: ${err?.code ?? err?.message ?? "unreadable"}`);
  }

  /*
   * ── THE DELIVERABLE IS THE FILE. THE EXIT CODE IS NOT THE VERDICT. ─────────
   *
   * WHAT THIS COST HER, on 9 September 2026. The Executive Intelligence Report ran for 313.6s
   * against a 300s leash, was killed (exit 124), and the CLI never got to print its closing JSON —
   * so `parseCliJson` returned "stdout was not JSON". On that basis the run was recorded FAILED and
   * the Today screen read "Today's research run failed. Nothing below is a finding."
   *
   * A COMPLETE REPORT WAS SITTING ON DISK. Sections, sources with read_at timestamps, three named
   * gaps and a real correction — and `delivers.json` said `"status": "complete"` in its own words.
   * The prompt asks every run to rewrite that file AS IT GOES precisely so a kill leaves content
   * behind, and then an unparseable stdout outranked it.
   *
   * That is the two-lists defect exactly: the backend graded the run on stdout while the product it
   * was contracted to produce is a file the grade never consulted.
   *
   * SO THE FILE IS ASKED FIRST, AND THE PROCESS SECOND.
   *
   *   file parses and says complete  → complete. The kill is noted in remaining_risks and is not
   *                                    an error, because the work it was killed during was done.
   *   file parses, says partial, or the process was killed → PARTIAL, and shown. Three verified
   *                                    sections beat a blank screen saying nothing is a finding.
   *   file missing or unparseable    → failed, and the existing message is the correct one.
   *
   * `delivery` is what the runner grades on. It never invents a status the file did not claim: an
   * absent `status` on a killed run is partial, never complete, because "it wrote something" is not
   * the same claim as "it finished".
   */
  const claimed = typeof delivers?.status === "string" ? delivers.status : null;
  const delivery = delivers === null
    ? { present: false, status: null }
    : {
        present: true,
        status:
          claimed === "complete" ? "complete"
          : claimed === "partial" || claimed === "failed" ? claimed
          // Unnamed: a killed run delivered part of something; an unkilled one delivered something
          // whole enough to stop on its own. Neither is upgraded past what it can support.
          : outcome.timed_out ? "partial" : "complete",
      };

  if (delivery.present && delivery.status === "complete" && outcome.timed_out) {
    risks.push(
      "The process was killed on its timeout AFTER the deliverable was complete. The report stands; " +
      "the leash is short, not the work.",
    );
  }
  if (delivery.present && delivery.status === "partial") {
    risks.push("This deliverable reports itself as partial. Read it as an incomplete answer, not as a finished one.");
  }

  /*
   * A COMPLETE DELIVERY IS NOT AN ERROR, WHATEVER THE PROCESS DID ON ITS WAY OUT. Everything else
   * about the exit code is preserved and reported: `exit_code` is unchanged, the kill is in
   * `remaining_risks`, and nothing here hides a crash. It only stops the crash from deleting a
   * finished report.
   */
  const deliveredWhole = delivery.present && delivery.status === "complete";

  return {
    // The CLI's own account of what it did — a claim, kept as a claim. executeRun() supplies the
    // file list and the check results from what it observed.
    summary: parsed.summary || (stderr ? `No summary. stderr tail: ${stderr}` : "No summary was produced."),
    delivers,
    delivery,
    exit_code: outcome.exit_code,
    commands: [{ cmd: `${binary} ${shown}`, exit_code: outcome.exit_code }],
    cost_micros: parsed.cost_micros,
    remaining_risks: risks,
    error:
      deliveredWhole
        ? null
        : parsed.is_error || outcome.exit_code !== 0
          ? (stderr || parsed.parse_error || `exit ${outcome.exit_code}`)
          : null,
    session_id: parsed.session_id,
  };
}

/**
 * Read the run's structured output, or null when it wrote none.
 *
 * INJECTABLE FOR THE SAME REASON `spawnImpl` IS. The adapter's tests run in workerd, which has no
 * filesystem — and a delivery path that can only be exercised by writing real files is one that
 * gets tested by hand once and then never again.
 *
 * A missing file returns null and is silent: most runs deliver nothing. Every other failure throws
 * and is recorded as a risk, because "could not read it" and "there was nothing to read" are
 * different facts.
 */
export async function defaultReadDelivers(cwd) {
  try {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    return await readFile(join(cwd, "delivers.json"), "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Is this backend usable on this machine, and what does it authenticate as?
 *
 * A backend that cannot run must say WHICH thing is missing rather than failing obscurely — the
 * Stage 1 acceptance sentence, applied to the one backend that has no credential to be missing.
 */
export function describeAuth(source = typeof process === "undefined" ? {} : process.env) {
  if (source.ANTHROPIC_API_KEY) {
    return {
      mode: "api_key",
      ok: false,
      // NOT AN IMPROVEMENT. A key in the environment would be a credential this design says must not
      // exist here, and it would be billed separately from the owner's session; the honest answer is
      // to name it, not to quietly use it.
      detail: "ANTHROPIC_API_KEY is set. This backend is designed to run on the owner's own session; remove the key or register a separate keyed backend deliberately.",
    };
  }
  return {
    mode: "owner_session",
    ok: true,
    detail: "Claude Code authenticates as the owner via her logged-in session (macOS keychain item \"Claude Code-credentials\"). No API key is held here or in the cloud half.",
  };
}
