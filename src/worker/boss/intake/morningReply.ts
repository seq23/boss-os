/**
 * HER REPLY TO SIMONE'S MORNING EMAIL, IN PLAIN WORDS (owner, 18 Nov 2026; personal brain, Settled
 * decisions). The commands are read by `morningCommands` (src/shared/boss/mail/morningReply.mjs):
 * exact whole lines only. This lane drops items, ticks the morning gate, keeps a gratitude line or a
 * standing rule in the personal brain, or marks a company public. NOTHING HERE SENDS, AND NOTHING
 * APPROVES: no outreach, no held reply, no draft. Each command is confirmed in one line.
 *
 * Only on a reply to the morning email (its `yd_` ref), except "gate done" and "X is public", which
 * are unambiguous wherever she writes them to Simone.
 *
 * THE FIRST READ DECIDES (owner ruling, 19 Nov 2026): when the email's first read gave a DECISION, its commands are the
 * commands, and the keywords only sit beside it in the log. Without one, the exact whole-line keywords act, judged by
 * the shared whole-sentence judge, logged "first read absent: keyword fallback".
 */
import type { Env } from "../env";
import { audit } from "../lib/audit";
import { admitTask } from "../tasks/admit";
import { dayIdInZone } from "../../../shared/boss/timezone";
import { appendToSection } from "../../../shared/boss/brains/brain.mjs";
import { morningCommands, commandsFromRead, missedByRead, commandWords, dropTargets, knownRule, brainLine } from "../../../shared/boss/mail/morningReply.mjs";
import { logReplyDecision, type ReplyDecision } from "./firstRead";
import { oneBrain, saveBrain } from "../brains/store";
import { markPublic } from "../capital/publicCompanies";
import { dropItems } from "../routes/morning";
import { logEvent } from "../lib/log";
import { AppError } from "../lib/http";
import { closeMorningGate } from "../routes/today";
import { morningDayOf } from "../lp/decideReply";

export interface MorningReplyResult { note: string; onlyCommands: boolean; acted: number }

async function keepInPersonal(env: Env, lines: string[], now: number) {
  if (!lines.length) return;
  const brain = await oneBrain(env, "personal");
  const md = appendToSection(brain.body_md, "Settled decisions", lines);
  await saveBrain(env, "personal", md, "Sequoia", "by email (her reply to Simone)", now);
}

const MORNING_KINDS = new Set(["drop", "gate", "grateful", "public", "rule"]);

export async function morningReplyFromMail(env: Env, a: { text: string; refs: string[]; mailId: string; now?: number; read?: ReplyDecision | null; readHasWork?: boolean }): Promise<MorningReplyResult | null> {
  const now = a.now ?? Date.now();
  const keyword = morningCommands(a.text);
  const fromRead = a.read ? commandsFromRead(a.read.commands.filter((c) => MORNING_KINDS.has(c.kind)), a.text) : null;
  // The read decides; with no read, the judged keywords (the logged last resort). Where they disagree, ask once.
  const commands = fromRead ?? keyword.commands;
  const unsure = fromRead ? missedByRead(fromRead, keyword.commands) : [];
  const morningDay = morningDayOf(a.refs);
  const usable = commands.filter((c: any) => morningDay || c.kind === "gate" || c.kind === "public");
  const kinds = (cs: any[]) => cs.map((c) => c.kind).join(", ") || "none";
  if (fromRead || usable.length) {
    await logReplyDecision(env, { mailId: a.mailId, what: "her morning commands", firstRead: fromRead ? kinds(fromRead) : null, keyword: kinds(keyword.commands) });
  }
  if (unsure.length) {
    await logEvent(env.DB, { level: "warn", scope: "intake", event: "meaning_disagrees", lane: "ops", entityId: a.mailId, detail: { what: "her morning commands", first_read: fromRead ? kinds(fromRead) : null, keyword: kinds(unsure), line: "the read and her exact words disagree: unknown, asked once, nothing done" } }).catch(() => undefined);
  }
  const askOnce = unsure.length
    ? `I was not sure you meant ${unsure.map((c: any) => `"${commandWords(c)}"`).join(", ")}, so I did nothing with ${unsure.length === 1 ? "it" : "them"}. Reply with just that line if you did.`
    : "";
  if (!usable.length) return askOnce ? { note: askOnce, onlyCommands: !(fromRead && a.readHasWork === false ? "" : keyword.rest), acted: 0 } : null;
  // Only commands → done here. With the first read: the keywords found nothing else in it, or the read found no work.
  const rest = fromRead && a.readHasWork === false ? "" : keyword.rest;
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
      try {
        await closeMorningGate(env, { via: "email", day_id: today });
        said.push("Morning gate recorded.");
      } catch (error) {
        if (!(error instanceof AppError) || error.status !== 409) throw error;
        said.push("Your morning gate was already recorded.");
      }
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
  if (askOnce) said.push(askOnce);
  return { note: said.join("\n"), onlyCommands: !rest && usable.length === commands.length, acted: usable.length };
}
