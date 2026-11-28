#!/usr/bin/env node
/**
 * THE AI ANSWERS SESSION'S POSTTOOLUSE HOOK (27 Nov 2026). Claude Code runs this after every OpenSEO call
 * in scripts/ops/ai-visibility.sh's session (the hook entry in ai-visibility-permissions.json; matcher: the
 * OpenSEO plugin's tools only). It is code of ours on the Mac, not the model's: the session itself still has
 * no shell, file or web tool.
 *
 *   1. Appends the raw result to the run's stash, `$AI_VISIBILITY_STASH` (one JSON line: tool, input,
 *      response). The stash lives in the run's work dir and dies with it; the post step builds the week
 *      from it (scripts/ops/lib/ai-visibility-digest.mjs `weekFromStash`).
 *   2. Replaces what the model sees with `digestFor` (only what its next step needs).
 *
 * FAILURE IS LOUD, NEVER QUIET. No stash path, or a stash that cannot be written: the model is told
 * NAMED STOP [OPENSEO_STASH_FAILED] in place of the result (so it can say so), and the post step, finding
 * no stash rows for a site, records that site as not read. A digest that throws hands the model the raw
 * result unchanged (more tokens, never less truth). Exit 0 always: a hook failure must not look like an
 * OpenSEO failure.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { TOOL_PREFIX, digestFor } from "./lib/ai-visibility-digest.mjs";

export const STASH_FAILED = "NAMED STOP [OPENSEO_STASH_FAILED] this run could not keep OpenSEO's result for code to read; print this site's block as {\"site\":\"<host>\",\"stop\":\"OPENSEO_UNREACHABLE\"}";

/** Pure: the hook's input event → { stashLine, output } (output is the JSON Claude Code reads on stdout). */
export function handle(event, { stash = process.env.AI_VISIBILITY_STASH, append = appendFileSync } = {}) {
  const tool = String(event?.tool_name ?? "");
  if (!tool.startsWith(TOOL_PREFIX)) return { output: null };
  const replace = (value) => ({ hookSpecificOutput: { hookEventName: "PostToolUse", updatedMCPToolOutput: value } });
  try {
    // No path (unset or empty) throws here too: one way to fail, and it is loud.
    if (!stash) throw new Error("AI_VISIBILITY_STASH is not set");
    append(stash, JSON.stringify({ tool, input: event.tool_input ?? {}, response: event.tool_response ?? null }) + "\n");
  } catch {
    return { output: replace([{ type: "text", text: STASH_FAILED }]) };
  }
  let digest;
  try { digest = digestFor(tool, event.tool_response); } catch { return { output: null }; }
  return { output: replace([{ type: "text", text: JSON.stringify(digest) }]) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  let event = null;
  try { event = JSON.parse(readFileSync(0, "utf8")); } catch { /* not an event: nothing to replace */ }
  const { output } = handle(event);
  if (output) process.stdout.write(JSON.stringify(output));
  process.exit(0);
}
