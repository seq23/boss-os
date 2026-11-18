/**
 * HER REPLY TO SIMONE'S MORNING EMAIL, IN PLAIN WORDS (owner, 18 Nov 2026; personal brain, Settled
 * decisions). The commands are read by `morningCommands` (src/shared/boss/mail/morningReply.mjs):
 * exact whole lines only. This lane drops items, ticks the morning gate, keeps a gratitude line or a
 * standing rule in the personal brain, or marks a company public. NOTHING HERE SENDS, AND NOTHING
 * APPROVES: no outreach, no held reply, no draft. Each command is confirmed in one line.
 *
 * Only on a reply to the morning email (its `yd_` ref), except "gate done" and "X is public", which
 * are unambiguous wherever she writes them to Simone.
 */
import type { Env } from "../env";
import { audit } from "../lib/audit";
import { admitTask } from "../tasks/admit";
import { dayIdInZone } from "../../../shared/boss/timezone";
import { appendToSection } from "../../../shared/boss/brains/brain.mjs";
import { morningCommands, dropTargets, knownRule, brainLine } from "../../../shared/boss/mail/morningReply.mjs";
import { oneBrain, saveBrain } from "../brains/store";
import { markPublic } from "../capital/publicCompanies";
import { dropItems } from "../routes/morning";
import { closeMorningGate } from "../routes/today";
import { morningDayOf } from "../lp/decideReply";

export interface MorningReplyResult { note: string; onlyCommands: boolean; acted: number }

async function keepInPersonal(env: Env, lines: string[], now: number) {
  if (!lines.length) return;
  const brain = await oneBrain(env, "personal");
  const md = appendToSection(brain.body_md, "Settled decisions", lines);
  await saveBrain(env, "personal", md, "Sequoia", "by email (her reply to Simone)", now);
}

export async function morningReplyFromMail(env: Env, a: { text: string; refs: string[]; mailId: string; now?: number }): Promise<MorningReplyResult | null> {
  const now = a.now ?? Date.now();
  const { commands, rest } = morningCommands(a.text);
  const morningDay = morningDayOf(a.refs);
  const usable = commands.filter((c: any) => morningDay || c.kind === "gate" || c.kind === "public");
  if (!usable.length) return null;
  const today = dayIdInZone(now);
  const said: string[] = [];
  const brainLines: string[] = [];
  let digest: any = null;
  if (morningDay && usable.some((c: any) => c.kind === "drop")) {
    const r = await env.DB.prepare(`SELECT payload FROM morning_digests WHERE day = ?`).bind(morningDay).first<{ payload: string }>();
    try { digest = r ? JSON.parse(r.payload) : null; } catch { digest = null; }
  }
  for (const c of usable as any[]) {
    if (c.kind === "drop") {
      const items = dropTargets(digest, c);
      if (!items.length) { said.push(`Nothing in that morning's email matches "${c.number ?? c.name}", so nothing was dropped.`); continue; }
      await dropItems(env, items, "reply", now);
      said.push(`Dropped for good: ${items.map((i: any) => i.label).slice(0, 3).join("; ")}${items.length > 3 ? ` and ${items.length - 3} more` : ""}.`);
    } else if (c.kind === "gate") {
      await closeMorningGate(env, { via: "email" });
      said.push("Morning gate ticked for today. Good. Now the first decision.");
    } else if (c.kind === "grateful") {
      brainLines.push(brainLine.grateful(today, c.what));
      said.push(`Kept: grateful for ${c.what}. It joins your gratitude lines.`);
    } else if (c.kind === "public") {
      const added = await markPublic(env, { company: c.company, via: "reply", evidence: "her reply to Simone", since: today }, now);
      said.push(added ? `${c.company} is now on the public list: no more deals, matches or questions about it.` : `${c.company} was already on the public list.`);
    } else if (c.kind === "rule") {
      const known = knownRule(c.words);
      if (known?.coach) {
        brainLines.push(brainLine.coach(today, known.coach, c.words));
        said.push(known.said);
      } else if (known) {
        said.push(known.said);
      } else {
        brainLines.push(brainLine.rule(today, c.words));
        await admitTask(env, {
          title: `Make Simone's emails follow her rule: ${String(c.words).slice(0, 80)}`,
          lane: "ops", employee_id: "emp_repo",
          input: { origin: "repair", repair_kind: "self_repair", prompt: `seq23/boss-os — her standing rule for Simone's emails (kept in the personal brain, ${today}): "${c.words}". Make the morning email and the preps follow it, with one test where the behaviour lives.` },
        }).catch(() => null);
        said.push("Kept as a standing rule in your personal brain; the team is making the emails follow it, and it will show from the next morning it is live.");
      }
    }
  }
  if (brainLines.length) await keepInPersonal(env, brainLines, now);
  await audit(env.DB, { actor: "owner", lane: "ops", entityType: "inbound_mail", entityId: a.mailId, action: "morning_reply", detail: { kinds: usable.map((c: any) => c.kind) } });
  return { note: said.join("\n"), onlyCommands: !rest && usable.length === commands.length, acted: usable.length };
}
