/**
 * EVERY `claude -p` A NODE JOB RUNS IS LOCKED TO ITS OWN LIST — the node half of lib/claude-lock.sh
 * (read its header for why). `lockedArgs(name)` gives
 *   --permission-mode dontAsk --setting-sources= --settings scripts/ops/<name>-permissions.json
 * and `refusals(streamJson)` the calls dontAsk refused, so a refused run is reported as refused and
 * never as an answer. scripts/validate/claude-runs-locked.mjs fails the build on any other shape.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { permissionDenials } from "./permission-denials.mjs";

const OPS = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The job's permissions file, by name (scripts/ops/<name>-permissions.json). */
export const settingsFile = (name) => join(OPS, `${name}-permissions.json`);

/** The four flags that lock one claude run to its own file. */
export function lockedArgs(name) {
  return ["--permission-mode", "dontAsk", "--setting-sources=", "--settings", settingsFile(name)];
}

/**
 * The refused tool calls in a stream-json run (or a JSONL transcript): each refused tool_result,
 * and, when those were not seen, the `permission_denials` the final result event lists.
 */
export function refusals(text) {
  const seen = permissionDenials(text);
  if (seen.length) return seen;
  const listed = [];
  for (const line of String(text ?? "").split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      const ev = JSON.parse(line);
      if (ev?.type === "result" && Array.isArray(ev.permission_denials)) {
        for (const d of ev.permission_denials) listed.push({ tool: String(d?.tool_name ?? "?"), command: String(d?.tool_input?.command ?? d?.tool_input?.file_path ?? JSON.stringify(d?.tool_input ?? {})) });
      }
    } catch { /* not JSON */ }
  }
  return listed;
}

/** The final `result` event's text in a stream-json run, or "" when it never arrived. */
export function resultText(stream) {
  let out = "";
  for (const line of String(stream ?? "").split("\n")) {
    if (!line.startsWith("{")) continue;
    try { const ev = JSON.parse(line); if (ev?.type === "result") out = String(ev.result ?? ""); } catch { /* not JSON */ }
  }
  return out;
}
