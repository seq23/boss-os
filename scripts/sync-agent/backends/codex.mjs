/**
 * The Codex CLI backend adapter — rung 0b, migration 0256.
 *
 * The SECOND `agent_executed` backend, and the reason it exists is Addendum §1: no critical
 * capability may depend permanently on one external provider. Rung 0 of the ladder was ONE
 * subscription seat. If her Claude plan is exhausted, or the Mac is busy with her own work, every
 * duty fell straight past $0 and into the cloud. Two seats at $0 is the first real continuity this
 * tier has had, and it is the cheapest continuity available anywhere in this system — a plan she
 * already pays for, with no marginal cost per run.
 *
 * ─── NO API KEY EXISTS AND NONE IS REQUESTED ────────────────────────────────────────────────────
 *
 * Verified on the machine on 17 September 2026 rather than assumed, which is the same standard
 * `claudeCode.mjs` held itself to: `/opt/homebrew/bin/codex`, `@openai/codex` 0.135.0, and
 * `~/.codex/auth.json` carrying `auth_mode: "chatgpt"` with `OPENAI_API_KEY: null`. It authenticates
 * against her ChatGPT session, so the cloud half of Boss OS holds no credential for this lane —
 * nothing to leak, nothing to spend. `describeAuth()` below refuses to call that an improvement if a
 * key ever appears in the environment, for the same reason its sibling does.
 *
 * `childEnv()` strips everything credential-shaped before the process starts, so even a key present
 * in the parent environment does not reach the child.
 *
 * ─── THREE TRAPS, ALL CONFIRMED BY RUNNING IT ───────────────────────────────────────────────────
 *
 * Each of these was observed, not read about, and each would have produced a lane that looked
 * registered and then failed on its first real run — the exact failure mode this migration exists
 * to end.
 *
 *   1. WITHOUT `--skip-git-repo-check` IT REFUSES AND RESETS THE WORKING DIRECTORY. Runs happen in a
 *      scratch workspace that is not a git repository, so this flag is not optional here.
 *   2. WITHOUT STDIN CLOSED IT BLOCKS FOREVER. `codex exec` reads stdin when it is a pipe, so an
 *      unattended run hangs until the timeout and holds the single work slot. The prompt goes in
 *      argv for this CLI and stdin is closed immediately — see the note on that trade below.
 *   3. IT WRITES A LOUD NON-FATAL ERROR TO STDERR: "failed to refresh available models: unknown
 *      variant `max`". The process still exits 0 and still answers. Anything that treated stderr as
 *      failure would mark every successful run as broken, so `isBenignStderr()` names this one
 *      pattern explicitly and nothing else is forgiven.
 *
 * ─── WHY THE PROMPT IS IN ARGV HERE AND ON STDIN THERE ──────────────────────────────────────────
 *
 * `claudeCode.mjs` puts the prompt on stdin precisely so a task's untrusted text does not appear in
 * `ps` output. That reasoning is correct and it is not available to us: this CLI takes its
 * instruction as a positional argument and blocks if stdin is a pipe. The trade is recorded rather
 * than hidden, and it is bounded two ways — the prompt is passed as a single argv element through
 * `spawn` with no shell, so nothing in it can be interpreted as a command, and this backend is the
 * SECOND seat rather than the default, so the ordinary run still goes to the one with the better
 * property. If that ever stops being true, this is the paragraph to revisit.
 */
import { childEnv } from "../runner.mjs";

/**
 * The stderr line this CLI always emits and which means nothing.
 *
 * NARROW ON PURPOSE. A broad "ignore stderr" would swallow the real failures — an expired session,
 * a rate limit, a refusal — and those are exactly what a continuity lane must report. One pattern,
 * matched against a line, and everything else is kept.
 */
export const BENIGN_STDERR = /failed to refresh available models/i;

export function isBenignStderr(stderr) {
  const lines = String(stderr ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l !== "codex");
  if (lines.length === 0) return true;
  return lines.every((l) => BENIGN_STDERR.test(l));
}

/**
 * The argv for one run.
 *
 * `--sandbox read-only` IS THE OUTER LAYER, NOT THE ENFORCEMENT, and the distinction is the same one
 * `claudeCode.mjs` draws about its deny flags: a flag is a request to the CLI, and a request made to
 * the party being constrained is not a control. The forbidden list is enforced by the runner — the
 * child carries no credentials, every command it proposes is scanned before it runs, and the git
 * state is compared before and after so a commit is detected however it was spelled. The flag means
 * the common case never starts.
 *
 * READ-ONLY IS ALSO A NARROWER GRANT THAN THE CLAUDE CODE LANE HAS. That adapter runs `acceptEdits`
 * because its work is writing files. This seat is registered for research, documents, summarising
 * and classifying — reading work — so it is given the sandbox that matches, and a future envelope
 * that genuinely needs to write is a deliberate change with a diff behind it rather than an
 * authority it already had.
 */
export function buildArgs(envelope, prompt, { model } = {}) {
  const args = [
    "exec",
    "--sandbox", "read-only",
    // Runs happen in a scratch workspace, not a repository. Without this the CLI refuses and
    // relocates the working directory out from under the run.
    "--skip-git-repo-check",
  ];
  if (model ?? envelope?.model) args.push("--model", String(model ?? envelope.model));
  // Last, and as ONE argv element. spawn() is called without a shell, so nothing inside it is
  // interpreted; it is text handed to a process, the same as a file would be.
  args.push(String(prompt ?? ""));
  return args;
}

/**
 * The answer is the LAST non-empty line of stdout.
 *
 * `codex exec` streams its reasoning and its tool activity to stdout and finishes with the reply.
 * There is no `--output-format json` on this CLI, so unlike the Claude Code adapter there is no
 * envelope to parse and no `total_cost_usd` to read.
 *
 * IT NEVER THROWS. Output here is downstream of untrusted text, and a malformed stdout must produce
 * a packet that says so rather than an exception that produces no packet at all — a run that
 * vanishes is worse than a run that failed, because only one of them gets looked at.
 */
export function parseCodexStdout(stdout) {
  const lines = String(stdout ?? "")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { summary: "", parse_error: "stdout was empty" };
  return { summary: lines[lines.length - 1].trim(), parse_error: null };
}

/**
 * Run the CLI once.
 *
 * Returns the adapter half of an evidence packet, in the same shape `claudeCodeExecutor` returns so
 * `executeRun()` needs no branch. It never decides the run's status — a backend grading its own
 * homework is the failure this whole design is arranged to avoid.
 */
export async function codexExecutor(
  { envelope, prompt, cwd },
  { spawnImpl, binary = "codex", readDelivers } = {},
) {
  const spawn = spawnImpl ?? (await import("node:child_process")).spawn;
  const args = buildArgs(envelope, prompt);
  const timeoutMs = Math.max(1, Number(envelope?.max_seconds ?? 900)) * 1000;

  const child = spawn(binary, args, {
    cwd,
    env: childEnv(typeof process === "undefined" ? {} : process.env),
    // stdin is a PIPE that is closed immediately. "ignore" would leave the CLI reading from the
    // runner's own stdin on some platforms; an explicit, immediately-ended pipe is the unambiguous
    // way to say "there is no input and there never will be".
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (c) => { stdout += c; });
  child.stderr?.on("data", (c) => { stderr = (stderr + c).slice(-8000); });
  // TRAP 2. Closing stdin before anything is written is what stops the run blocking for ever.
  child.stdin?.end();

  const outcome = await new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    // A hard timeout, because an unattended run that hangs holds the single work slot for ever and
    // looks identical to one that is thinking.
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
      finish({ exit_code: 124, timed_out: true });
    }, timeoutMs);
    child.on?.("close", (code) => { clearTimeout(timer); finish({ exit_code: code ?? -1, timed_out: false }); });
    child.on?.("error", (err) => { clearTimeout(timer); finish({ exit_code: -1, timed_out: false, spawn_error: String(err) }); });
  });

  /*
   * THE RECORDED INVOCATION ELIDES THE PROMPT, and this is the same class of bug the sibling
   * adapter hit with its deny flags. The prompt is a task's untrusted text; recording it verbatim
   * into `backend_runs.commands` would put it through the runner's forbidden-command scanner, so any
   * task whose text happened to contain "git push" would convict itself. The flags are a constant a
   * reviewer can read; the prompt is already stored as the envelope's instruction.
   */
  const shown = `${binary} ${args.slice(0, -1).join(" ")} <prompt ${String(prompt ?? "").length} chars>`;

  const parsed = parseCodexStdout(stdout);
  const benign = isBenignStderr(stderr);

  const risks = [];
  if (outcome.timed_out) risks.push(`The run was killed after ${timeoutMs / 1000}s; its answer is missing or partial.`);
  if (parsed.parse_error) risks.push("Codex produced no output on stdout, so there is no answer to read; the observed facts below still stand.");
  if (outcome.spawn_error) risks.push(`Codex CLI could not be started: ${outcome.spawn_error}`);
  if (stderr && !benign) risks.push(`Codex wrote to stderr: ${stderr.slice(-500)}`);

  /*
   * THE DELIVERABLE IS READ FROM A FILE, for the reason `claudeCode.mjs` gives at length: everything
   * in `summary` is the CLI's own account, and fishing JSON out of prose would mean this process
   * INTERPRETING that claim. A file the run wrote and this process read is the same class of
   * evidence as an exit code — observed here, not asserted there.
   *
   * The reader is the sibling's, imported lazily rather than copied, so there is ONE statement of
   * where a deliverable lives and what the cap on it is. Two adapters each keeping their own idea of
   * that is the defect this repository names most often.
   */
  const read = readDelivers ?? (await import("./claudeCode.mjs")).defaultReadDelivers;
  let delivers = null;
  try {
    const raw = await read(cwd);
    if (raw === null) {
      // The ordinary case for every kind of run that is not contracted to produce structure.
    } else if (raw.length > 1_000_000) {
      risks.push(`delivers.json is ${raw.length} bytes, past the 1MB cap; nothing was delivered from it.`);
    } else {
      const obj = JSON.parse(raw);
      if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
        risks.push("delivers.json did not contain a JSON object; nothing was delivered from it.");
      } else {
        delivers = obj;
      }
    }
  } catch (err) {
    risks.push(`delivers.json could not be read: ${err?.code ?? err?.message ?? "unreadable"}`);
  }

  const claimed = typeof delivers?.status === "string" ? delivers.status : null;
  const delivery = delivers === null
    ? { present: false, status: null }
    : {
        present: true,
        status:
          claimed === "complete" ? "complete"
          : claimed === "partial" || claimed === "failed" ? claimed
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

  const deliveredWhole = delivery.present && delivery.status === "complete";

  return {
    summary: parsed.summary || (stderr && !benign ? `No answer. stderr tail: ${stderr}` : "No answer was produced."),
    delivers,
    delivery,
    exit_code: outcome.exit_code,
    commands: [{ cmd: shown, exit_code: outcome.exit_code }],
    /*
     * ALWAYS ZERO, AND THAT IS A FACT RATHER THAN A GAP. This lane runs on her ChatGPT Plus
     * subscription: no money leaves the account per run, and there is no figure the CLI could
     * report that would be a charge. 0239's lesson is that a number which looks like a bill and is
     * not one had her reading a fake invoice for a week — so the honest entry is 0, with
     * `execution_backends.cost_basis = 'plan_equivalent'` carrying the explanation next to it.
     */
    cost_micros: 0,
    remaining_risks: risks,
    error:
      deliveredWhole
        ? null
        : outcome.exit_code !== 0 || parsed.parse_error
          // TRAP 3. The benign "failed to refresh available models" line must never become the
          // reported error of a run that exited 0 and answered.
          ? ((!benign && stderr) || parsed.parse_error || `exit ${outcome.exit_code}`)
          : null,
    session_id: null,
  };
}

/**
 * Is this backend usable on this machine, and what does it authenticate as?
 *
 * A backend that cannot run must say WHICH thing is missing rather than failing obscurely.
 *
 * IT READS THE ENVIRONMENT, NOT `auth.json`. Whether the session on disk is still valid is a fact
 * only the CLI can establish, and guessing at it from a file would be a second opinion that goes
 * stale. What this answers is the question the Stage 1 acceptance sentence asks: is there a
 * credential here that should not be.
 */
export function describeAuth(source = typeof process === "undefined" ? {} : process.env) {
  if (source.OPENAI_API_KEY) {
    return {
      mode: "api_key",
      ok: false,
      // NOT AN IMPROVEMENT, and the same refusal `claudeCode.mjs` makes about ANTHROPIC_API_KEY. A
      // key here would be a credential this design says must not exist, and it would be billed
      // separately from the seat she already pays for. Name it; do not quietly use it.
      detail: "OPENAI_API_KEY is set. This backend is designed to run on the owner's own ChatGPT session; remove the key or register a separate keyed backend deliberately.",
    };
  }
  return {
    mode: "owner_session",
    ok: true,
    detail: "Codex CLI authenticates as the owner via her ChatGPT session (~/.codex/auth.json, auth_mode \"chatgpt\", OPENAI_API_KEY null). No API key is held here or in the cloud half.",
  };
}
