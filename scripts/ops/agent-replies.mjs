#!/usr/bin/env node
/** `npm run agent-replies`: the agent_replies morning section, alone (scripts/ops/lib/agent-replies.mjs). */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { syncAgentReplies } from "./lib/agent-replies.mjs";
import { localConfig, senderClient } from "./pnp-corporate-outreach.mjs";
import { outputLine } from "../../src/shared/boss/alarms/rules.mjs";

export async function main() {
  const result = await syncAgentReplies({ client: senderClient(localConfig()) });
  console.log(`${result.read} stored replies read, ${result.cards} real ${result.cards === 1 ? "reply" : "replies"} in Decide${result.unread ? `, ${result.unread} with an unreadable copy (still shown)` : ""}.`);
  console.log(outputLine(result.cards, "reply cards"));
  return result;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(String(e?.message ?? e).startsWith("NAMED STOP") ? e.message : `NAMED STOP [AGENT_REPLIES_UNREAD] ${String(e?.message ?? e).slice(0, 200)}`); process.exitCode = 1; });
}
