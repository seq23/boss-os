#!/usr/bin/env node
/**
 * THE TAIL CANNOT END WITHOUT ITS REPORT, AND NEVER LOSES WORK (owner incident, 1 Nov 2026).
 *
 * The 17:48Z tail run found the real friction, handed the fix to a background subagent, and ended
 * its own turn ("I'll write the records once the fix lands"). The harness stops background tasks
 * 10 minutes after the last turn; both tasks were killed, the process exited rc=0, and
 * boss-mail-tail-run.sh wrote INCOMPLETE with nothing recovered. These are the pure pieces of the
 * recovery: which session a log belongs to, whether a report is real, and what to try next — read
 * by boss-mail-tail-run.sh and tested without a live `claude` process.
 *
 *   node tail-report.mjs session-id <log-file>          → prints the session id, or nothing
 *   node tail-report.mjs state <report-file>             → prints "complete" or "missing"
 *   node tail-report.mjs plan <state> <sessionId> <tried-csv>  → prints "<action> [sessionId]"
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The session id a stream-json tail log was written under, or null. Pure. */
export function sessionIdIn(log) {
  const m = /"session_id"\s*:\s*"([0-9a-fA-F-]{8,})"/.exec(String(log ?? ""));
  return m ? m[1] : null;
}

/** Whether a report file's text is real (carries its sentinel) or missing one. Pure. */
export function reportState(text) {
  const t = String(text ?? "").trim();
  if (!t) return "missing";
  return /FRICTION_FIXED\s*:/.test(t) ? "complete" : "missing";
}

/**
 * What the run script does next, given the report's state, the session id read from the log, and
 * what it has already tried this run (so a session is resumed once, never looped). Pure.
 *   { action: "none" }               — already complete, nothing to do
 *   { action: "resume", sessionId }  — ask that same session, once, to write its report
 *   { action: "salvage" }            — no session to resume, or resuming did not produce one;
 *                                       salvage any uncommitted worktree instead of losing it
 */
export function recoveryPlan({ state, sessionId = null, tried = [] } = {}) {
  if (state === "complete") return { action: "none" };
  if (sessionId && !tried.includes("resume")) return { action: "resume", sessionId };
  return { action: "salvage" };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "session-id") {
    const [file] = rest;
    process.stdout.write(sessionIdIn(file ? readFileSync(file, "utf8") : "") ?? "");
  } else if (cmd === "state") {
    const [file] = rest;
    let text = "";
    try { text = readFileSync(file, "utf8"); } catch { text = ""; }
    process.stdout.write(reportState(text));
  } else if (cmd === "plan") {
    const [state, sessionId, triedCsv] = rest;
    const tried = String(triedCsv ?? "").split(",").filter(Boolean);
    const plan = recoveryPlan({ state, sessionId: sessionId || null, tried });
    process.stdout.write(`${plan.action}${plan.sessionId ? ` ${plan.sessionId}` : ""}`);
  } else {
    console.error("usage: tail-report.mjs session-id|state|plan ...");
    process.exit(2);
  }
}
