/**
 * HER REPLY TO SIMONE, IN PLAIN WORDS (owner, 18 Nov 2026; personal brain, Settled decisions: "Simone's
 * morning email is steerable in prose"). Read by the inbound mail lane (src/worker/boss/intake/
 * morningReply.ts) on her own words only (the quoted email is already taken off). Pure.
 *
 * EXACT AND WHOLE-LINE. A line is a command only when the whole line is one of these; anything else is
 * left for the ordinary path. Nothing here can send outreach, send a held reply or approve a draft:
 * the commands drop items, tick the morning gate, keep a gratitude line, mark a company public, or keep
 * a standing rule. Each is confirmed back to her in one line.
 *
 *   drop 2 · drop Ron Brooks          the item(s) leave every morning and Today for good
 *   gate done                         today's morning gate is ticked
 *   grateful for <anything>           kept in the personal brain; it joins the gratitude rotation
 *   <Company> is public               on the one list of public companies (no deals, matches, questions)
 *   don't … / never … / always … / stop … / from now on … / that wasn't … / be harder on me
 *                                     a standing rule, kept in the personal brain; a known one is
 *                                     confirmed as already the rule; one the emails cannot follow yet
 *                                     becomes a repair job (who and when said in the reply)
 */
import { publicFromReply } from "../deals/publicCompanies.mjs";
import { vetoOf, quoteStands } from "../text/wholeSentence.mjs";

const PRONOUN = /^(?:it|that|this|them|those|these|the item|everything|all)$/i;

/** The commands in her own words, in order, and the lines that were not commands. */
export function morningCommands(text) {
  const commands = [];
  const rest = [];
  for (const raw of String(text ?? "").split(/\n+/)) {
    const line = raw.trim().replace(/^[-*•]\s*/, "");
    if (!line) continue;
    const c = commandOf(line);
    if (c) commands.push(c); else rest.push(raw);
  }
  return { commands, rest: rest.join("\n").trim() };
}

/*
 * THE SHARED JUDGE (19 Nov 2026). These keywords are the last resort, after the first read; even then a line that is
 * conditioned ("drop 2 if he hasn't answered"), reported ("Ann said drop it") or asked ("drop Ron Brooks?") is not a
 * command. A rule is negative by nature ("don't …", "never …") and may carry its own "when", so it is judged only for
 * reporting and asking. Pure.
 */
const JUDGED = Object.freeze({ rule: ["REPORTS", "ASKS"], gate: ["NEGATES", "CONDITIONS", "REPORTS", "ASKS"], drop: ["NEGATES", "CONDITIONS", "REPORTS", "ASKS"] });
export function commandOf(line) {
  const c = keywordCommandOf(line);
  return c && !vetoOf(String(line ?? "").trim(), null, JUDGED[c.kind] ?? ["CONDITIONS", "REPORTS", "ASKS"]) ? c : null;
}

/*
 * FROM THE FIRST READ (19 Nov 2026): her commands as the first read gave them, each quoting her. The quoted words are
 * read by the same exact parser when they carry the shape ("drop Ron Brooks"); a drop the read numbered, a gate, a
 * gratitude or a company the read named is taken as the read said. Pure.
 */
export function commandsFromRead(readCommands, words) {
  const out = [];
  for (const c of readCommands ?? []) {
    // The same judge as the keywords, on her whole sentence: a conditioned, reported or asked command never acts.
    const shapes = JUDGED[c.kind] ?? ["NEGATES", "CONDITIONS", "REPORTS", "ASKS"];
    const stands = c.text ? quoteStands(words, c.text, shapes) : c.kind === "gate" && morningCommands(words).commands.some((k) => k.kind === "gate");
    if (!stands) continue;
    const parsed = keywordCommandOf(c.text);
    // A drop must be her drop: a number the read gave from words that say drop, or words the drop parser reads.
    if (c.kind === "drop") { if (parsed?.kind === "drop") out.push(c.n && !parsed.number ? { kind: "drop", number: c.n } : parsed); else if (c.n && /\b(?:drop|remove|dismiss|lose|get rid of|take off)\b/i.test(c.text)) out.push({ kind: "drop", number: c.n }); }
    else if (c.kind === "gate") out.push({ kind: "gate" });
    else if (c.kind === "grateful") out.push(parsed?.kind === "grateful" ? parsed : { kind: "grateful", what: String(c.text).trim() });
    else if (c.kind === "public") out.push(parsed?.kind === "public" ? parsed : { kind: "public", company: String(c.text).replace(/\s+is\s+(?:now\s+)?public\b.*$/i, "").trim() });
    else if (c.kind === "rule") out.push({ kind: "rule", words: String(c.text).trim() });
  }
  return out.filter((c) => c.kind !== "drop" || c.number || (c.name && c.name.length >= 2 && !PRONOUN.test(c.name)));
}

/*
 * WHERE THE READ AND HER EXACT WORDS DISAGREE (coordinator ruling, 22 Nov 2026): a whole-line command in her words
 * that the read did not give is neither done nor dropped silently: it is "unknown", and she is asked once. Replaces
 * the 20 Nov patch that let the keywords act beside the read. Pure: the keyword commands the read did not give.
 */
export function missedByRead(fromRead, keyword) {
  const key = (c) => c.kind === "gate" ? "gate" : `${c.kind}:${c.number ?? ""}:${String(c.name ?? c.what ?? c.company ?? c.words ?? "").toLowerCase()}`;
  const have = new Set(fromRead.map(key));
  return keyword.filter((k) => !have.has(key(k)));
}

/** Her exact line for a command, said back when she is asked once. */
export function commandWords(c) {
  if (c.kind === "drop") return c.number ? `drop ${c.number}` : `drop ${c.name}`;
  if (c.kind === "gate") return "gate done";
  if (c.kind === "grateful") return `grateful for ${c.what}`;
  if (c.kind === "public") return `${c.company} is public`;
  return String(c.words ?? "");
}

function keywordCommandOf(line) {
  const l = String(line ?? "").trim().replace(/\s+/g, " ");
  let m;
  if ((m = /^drop\s+#?(\d{1,2})\s*[.!]?$/i.exec(l))) return { kind: "drop", number: Number(m[1]) };
  if ((m = /^drop\s+(.{2,60}?)(?:\s+for good)?\s*[.!]?$/i.exec(l)) && !PRONOUN.test(m[1].trim())) return { kind: "drop", name: m[1].trim() };
  if (/^(?:(?:morning\s+)?gate(?:'s| is)?\s+done|done with (?:the|my) (?:morning )?gate|did (?:the|my) (?:morning )?gate)\s*[.!✓✅]*$/i.test(l)) return { kind: "gate" };
  if ((m = /^(?:i(?:'m| am)\s+)?grateful for\s+(.{3,200}?)\s*[.!]?$/i.exec(l))) return { kind: "grateful", what: m[1].trim() };
  const pub = publicFromReply(l);
  if (pub) return { kind: "public", company: pub };
  if (/^(?:please\s+)?(?:don'?t|do not|never|always|stop|no more|from now on|going forward|that (?:wasn'?t|was not|isn'?t|is not)|be (?:harder|tougher|firmer|softer|gentler)|(?:go )?(?:harder|easier) on me)\b/i.test(l) && l.length <= 300) return { kind: "rule", words: l };
  return null;
}

/*
 * RULES THE EMAILS ALREADY FOLLOW, said back as such (18 Nov 2026). `coach` changes the coaching's
 * pressure from tomorrow (read by the morning run from the personal brain).
 */
export const KNOWN_RULES = Object.freeze([
  { re: /\bprep\b.*\b(?:maybe|maybes|tentative|declined?|no)\b|\b(?:maybe|maybes|tentative)\b.*\bprep/i, said: "Already the rule: no prep, and no calendar line, for a meeting you answered maybe or no." },
  { re: /\bscooter\b/i, said: "Already the rule: a catch-up with Scooter prep only when it is you and Scooter alone; anyone else on the invite gets a normal prep." },
  { re: /\b(?:harder|tougher|firmer)\b/i, coach: "harder", said: "Done: from tomorrow the coaching is high-pressure from the first missed day, not the second." },
  { re: /\b(?:softer|gentler|easier)\b/i, coach: "softer", said: "Done: from tomorrow the coaching goes back to a firm line on the first missed day and the call-out from the second." },
  { re: /\bthank you for your patience\b|\bpatience\b/i, said: "Already the rule: no chase ever says \"thank you for your patience\"." },
  { re: /\bout of office|auto-?repl/i, said: "Already the rule: an auto-reply never counts as someone writing back." },
]);
export function knownRule(words) {
  return KNOWN_RULES.find((k) => k.re.test(String(words ?? ""))) ?? null;
}

/** How the coaching should run, from the personal brain's newest "Coaching:" line. "harder" | "softer". */
export function coachPressure(brainMd) {
  const lines = String(brainMd ?? "").split("\n").filter((l) => /—\s*Coaching:\s*be (?:harder|softer)/i.test(l)).sort();
  const last = lines[lines.length - 1] ?? "";
  return /be harder/i.test(last) ? "harder" : "softer";
}

/** Her gratitude list: every "Grateful for: …" line she added by reply, newest last. */
export function gratitudeFromBrain(brainMd) {
  return [...String(brainMd ?? "").matchAll(/^-\s*\d{4}-\d{2}-\d{2}\s*—\s*Grateful for:\s*(.+?)\s*—\s*her reply/gim)].map((m) => m[1].trim());
}

/** The Settled decisions lines each command keeps (the brain's `- YYYY-MM-DD — decision — why` shape). */
export const brainLine = {
  grateful: (day, what) => `- ${day} — Grateful for: ${String(what).replace(/\s*—\s*/g, ", ").slice(0, 200)} — her reply to Simone, added to the gratitude rotation`,
  rule: (day, words) => `- ${day} — Simone's emails: "${String(words).replace(/"/g, "'").slice(0, 280)}" — her reply to Simone (standing rule)`,
  coach: (day, which, words) => `- ${day} — Coaching: be ${which} ("${String(words).replace(/"/g, "'").slice(0, 200)}") — her reply to Simone`,
};

/*
 * WHICH MORNING ITEMS A "drop" MEANS. `n`: the Decide card with that number. A name: every item in
 * that morning whose words carry it (a person on two lines is one person dropped twice). Returns
 * [{ id, label }]. `digest` is the kept morning's payload. Pure.
 */
export function dropTargets(digest, cmd) {
  if (!digest) return [];
  if (cmd.number) {
    const d = (digest.decide ?? [])[cmd.number - 1];
    return d ? [{ id: d.id, label: d.title }] : [];
  }
  const name = String(cmd.name ?? "").toLowerCase().trim();
  if (name.length < 2) return [];
  const all = [
    ...(digest.decide ?? []).map((d) => ({ id: d.id, words: `${d.title} ${d.body ?? ""}`, label: d.title })),
    ...(digest.still_yours ?? []).map((d) => ({ id: d.id, words: `${d.title ?? ""} ${d.line ?? ""}`, label: d.title ?? d.line })),
    ...(digest.deals ?? []).map((d) => ({ id: d.id, words: `${d.company} ${d.from ?? ""}`, label: `${d.company} (${d.side ?? "deal"})` })),
    ...(digest.found_grid ?? []).map((d) => ({ id: d.id, words: `${d.company} ${d.trade ?? ""}`, label: `${d.company} match` })),
    ...(digest.found ?? []).map((d) => ({ id: d.id, words: d.text, label: d.text })),
    ...(digest.done ?? []).map((d) => ({ id: d.id, words: d.text, label: d.text })),
    ...(digest.lines ?? []).map((d) => ({ id: d.id, words: d.text, label: d.text })),
  ];
  const seen = new Set();
  return all.filter((x) => x.id && String(x.words ?? "").toLowerCase().includes(name) && !seen.has(x.id) && seen.add(x.id)).map(({ id, label }) => ({ id, label: String(label ?? "").slice(0, 160) }));
}
