#!/usr/bin/env node
/**
 * WHAT THE sr-fix WORKER WAS REFUSED (23 Nov 2026). The worker runs `claude -p --permission-mode
 * dontAsk` with sr-fix-permissions.json as its whole allow list. A command outside the list is refused
 * quietly: the model reads "Permission to use Bash has been denied because Claude Code is running in
 * don't ask mode", works around it or gives up, and the pass ended 0 with the fix half done (17-22 Nov
 * passes: `git -C`, `git worktree list`, `curl -s`, `grep`, `gh run list`, `gh pr diff` all refused).
 * This reads the pass's own transcript (ahrefs-audit-fix.sh names the session with --session-id) and
 * returns each refused call with the command it tried, so the pass ends as a NAMED STOP instead.
 *
 *   node scripts/ops/lib/permission-denials.mjs <transcript.jsonl>
 *     prints `denied=<n>` then one `DENIED <tool>: <command>` line per refusal; exit 0.
 *     A transcript that cannot be read prints `denied=unknown` and exits 2 (never "0 denied").
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Three wordings: dontAsk's "Permission to use Bash has been denied because …", a deny rule's
// "Permission to use Bash with command gh api user has been denied." (24 Nov 2026, a real locked run:
// the second read as 0 refusals), and a Read/Edit deny rule's "<tool_use_error>File is in a directory that
// is denied by your permission settings." (27 Nov 2026, sr-fix-permissions-probe: Read of ~/.ssh read as 0).
const REFUSED = /^(?:<tool_use_error>)?(?:Permission to use \S+(?: with [\s\S]*?)? has been denied|File is in a directory that is denied by your permission settings)/;

/** The refused tool calls in a Claude Code transcript (JSONL text), as `{ tool, command }`. */
export function permissionDenials(jsonl) {
  const uses = new Map();
  const out = [];
  const counted = new Set(); // a transcript can carry the same tool_result twice: one refusal is one
  for (const line of String(jsonl).split("\n")) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    const content = rec?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c?.type === "tool_use") uses.set(c.id, { tool: c.name, command: c.input?.command ?? c.input?.file_path ?? JSON.stringify(c.input ?? {}) });
      if (c?.type === "tool_result" && c.is_error) {
        const text = typeof c.content === "string" ? c.content : Array.isArray(c.content) ? c.content.map((x) => x?.text ?? "").join("") : "";
        if (!REFUSED.test(text) || counted.has(c.tool_use_id)) continue;
        counted.add(c.tool_use_id);
        out.push(uses.get(c.tool_use_id) ?? { tool: text.split(" ")[3] ?? "?", command: "(call not found)" });
      }
    }
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let text;
  try { text = readFileSync(process.argv[2], "utf8"); } catch { console.log("denied=unknown"); process.exit(2); }
  const d = permissionDenials(text);
  console.log(`denied=${d.length}`);
  for (const x of d) console.log(`DENIED ${x.tool}: ${String(x.command).replace(/\s+/g, " ").slice(0, 200)}`);
}
