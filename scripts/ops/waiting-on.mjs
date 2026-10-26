#!/usr/bin/env node
/**
 * ZORA: NOTHING THAT WAITS GOES UNOWNED (owner-approved 26 Oct 2026). Daily 07:00 Central, launchd
 * com.seq.boss-waiting-on through duty-run.sh → duty_waiting_on.
 *
 * Reads the one register (`waiting_on`, Team → Zora). An item due today with an owner and an action:
 * the action is opened as a task for that owner, the item marked actioned, and a measurement gets one
 * line in Simone's morning email. An item with no owner, or a passed date with nothing set to happen:
 * a repair for Danielle the same day (fix first; never a Decide for her).
 */
import { bossApi } from "./lib/duty-kit.mjs";
import { addMorningLines } from "../../src/shared/boss/mail/morning.mjs";
import { zoraPass } from "../../src/shared/boss/waiting/register.mjs";

/** The morning line for a measurement opened today (pure). */
export const measuringLine = (i) => `Measuring today: ${i.what}. If it is missed, the fix starts the same day.`;

async function main() {
  const api = await bossApi();
  const { items } = await api.get("/waiting-on");
  const { act, repair } = zoraPass(items ?? []);
  const lines = [];
  for (const i of act) {
    const t = await api.post("/tasks", { title: i.what.slice(0, 120), lane: "ops", employee_id: i.owner, input: { origin: "waiting_on", waiting_on: i.id, prompt: i.action } });
    await api.post(`/waiting-on/${i.id}`, { state: "actioned", task_id: t?.id ?? t?.task_id ?? null });
    if (i.kind === "measurement") lines.push(measuringLine(i));
    console.log(`waiting-on: opened "${i.what.slice(0, 60)}" for ${i.owner}`);
  }
  for (const { item, why } of repair) {
    const t = await api.post("/tasks", { title: `Zora's register: "${item.what.slice(0, 60)}" ${why}`, lane: "ops", employee_id: "emp_repo", input: { origin: "repair", repair_kind: "self_repair", prompt: `seq23/boss-os — Zora's waiting-on register item ${item.id} ("${item.what}") ${why}. Give it an owner and an action on its date (the waiting_on row), or close it with the reason.` } });
    await api.post(`/waiting-on/${item.id}`, { state: "repair", task_id: t?.id ?? t?.task_id ?? null });
    console.log(`waiting-on: repair opened — ${item.what.slice(0, 60)} (${why})`);
  }
  if (lines.length) addMorningLines("notices", { lines });
  console.log(`WAITING-ON: ${(items ?? []).length} on the register; ${act.length} acted on today; ${repair.length} repair(s) opened.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`waiting-on failed: ${e?.message ?? e}`); process.exit(1); });
}
