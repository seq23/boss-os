/**
 * MONIQUE'S PRE-SEED WATCH — the pure half (owner-approved 26 Oct 2026). Two lists side by side:
 * "Crossed your desk" (pre-seed and seed companies in her mailboxes) and "Funded in the market"
 * (pre-seed rounds announced this week, from public news headlines), then the comparison. Fixed
 * rules, no model: nothing is invented, and a figure from the news is marked "reported".
 */

/** Her sectors, then the mandate's. The first rule a text matches is its sector. */
export const SECTORS = [
  ["Defense tech", /\b(defen[cs]e|dual[- ]use|national security|military|drones?|counter-?uas)\b/i],
  ["AI", /\b(ai|a\.i\.|artificial intelligence|llms?|machine learning|genai|generative|agents?|agentic)\b/i],
  ["Fintech", /\b(fintech|payments?|banking|neobank|lending|credit|insurtech|insurance|crypto|stablecoins?|wealth|treasury)\b/i],
  ["Future of work", /\b(future of work|workforce|hiring|recruit\w*|hr tech|payroll|productivity|remote work|freelanc\w*|upskill\w*)\b/i],
  ["Deeptech", /\b(deep ?tech|quantum|robotics?|semiconductors?|chips?|materials|fusion|space|satellites?|photonics|batter(y|ies))\b/i],
  ["Health tech", /\b(health ?tech|healthcare|health|clinical|medical|patients?|biotech|therapeutics|care)\b/i],
  ["Ed tech", /\b(ed ?tech|education|learning|students?|schools?|tutor\w*)\b/i],
  ["Consumer", /\b(consumer|d2c|dtc|brand|marketplace|social app|creator|e-?commerce)\b/i],
];
export const sectorOf = (text) => SECTORS.find(([, re]) => re.test(String(text ?? "")))?.[0] ?? null;

const ROUND = /\b(pre[- ]?seed|seed)\b/i;
const MONEY = /\$\s?(\d+(?:\.\d+)?)\s?(m|mm|million|k|thousand)\b/i;

/** "$2M pre-seed", "seed", or null. */
export function roundOf(text) {
  const t = String(text ?? "");
  const r = ROUND.exec(t);
  if (!r) return null;
  const m = MONEY.exec(t);
  const size = m ? `$${m[1]}${/^k|thousand/i.test(m[2]) ? "K" : "M"} ` : "";
  return `${size}${/pre/i.test(r[1]) ? "pre-seed" : "seed"}`;
}

const FREE_MAIL = /^(gmail|googlemail|yahoo|outlook|hotmail|icloud|me|aol|proton|protonmail|hey)$/i;

/** The company a pitch is about: from the subject ("Acme — pre-seed", "Intro: Acme"), else the sender's domain. */
const NOT_A_NAME = /^(pre|seed|re|fwd?|fw|intro|the|our|a|an|new|update|hello|hi)$/i;
export function companyOf({ subject, from }) {
  const c = companyOf0({ subject, from });
  return c && !NOT_A_NAME.test(c) ? c : null;
}
function companyOf0({ subject, from }) {
  const s = String(subject ?? "").replace(/^(re|fwd?|fw):\s*/gi, "").trim();
  let m = /^(?:intro(?:duction)?|meet|introducing)\s*[:\-–—]?\s*([A-Z][\w.&'-]*(?:\s[A-Z][\w.&'-]*){0,2})/i.exec(s);
  if (m) return m[1].trim();
  m = /^([A-Z][\w.&'-]*(?:\s[A-Z][\w.&'-]*){0,2})\s*[|:\-–—]\s*.*\b(pre[- ]?seed|seed|raising|round|deck)\b/i.exec(s);
  if (m) return m[1].trim();
  const dom = /@([a-z0-9-]+)\.[a-z.]+/i.exec(String(from ?? ""))?.[1];
  if (dom && !FREE_MAIL.test(dom)) return dom.charAt(0).toUpperCase() + dom.slice(1);
  return null;
}

/** One mailbox message → a "Crossed your desk" row, or null when it is not a pitch in her sectors. */
export function crossedRow(msg) {
  if (msg.newsletter) return null;
  const text = `${msg.subject ?? ""} ${msg.snippet ?? ""}`;
  if (!ROUND.test(text)) return null;
  const sector = sectorOf(text);
  const company = companyOf(msg);
  if (!sector || !company) return null;
  return { company, sector, round: roundOf(text), from: msg.from_name || msg.from || null, date: msg.date, url: msg.url ?? null };
}

const RAISES = /^(.{2,60}?)\s+(?:raises|secures|lands|closes|bags|nabs|announces|gets)\s+(.*)$/i;

/** One news headline → a "Funded in the market" row, or null. Figures are as reported. */
export function fundedRow(item) {
  const title = String(item.title ?? "").replace(/\s+-\s+[^-]+$/, "").trim(); // drop " - Publisher"
  if (!/\bpre[- ]?seed\b/i.test(title)) return null;
  const m = RAISES.exec(title);
  if (!m) return null;
  const rest = m[2];
  const lead = /\bled by\s+([^,;]+?)(?:\s+to\b|\s+for\b|,|$)/i.exec(rest)?.[1]?.trim() ?? null;
  const what = /\b(?:to|for)\s+(.{6,140})$/i.exec(rest)?.[1]?.replace(/\.$/, "") ?? null;
  const sector = sectorOf(title);
  if (!sector) return null;
  const round = roundOf(rest) ?? "pre-seed";
  // "Saudi fintech Vrtx", "Startup insurtech Delegance": the name is what follows the descriptors.
  const lead0 = m[1].trim();
  const abroad = /^(?:[A-Z][a-z]+(?:n|an|ian|ese|ish|i|ch)|[A-Z][a-z]+-based|UK|EU|Indian|African|Nigerian|Kenyan)\b/.test(lead0) && !/^(American|US)\b/.test(lead0);
  const company = lead0.replace(/^(?:[A-Z][a-z]+(?:-based)?\s+)?(?:(?:startup|fintech|healthtech|health ?tech|e-health|insurtech|edtech|ed ?tech|ai|proptech|deeptech|defen[cs]e ?tech|climate ?tech|legaltech|biotech|saas|b2b|consumer)\s+)+(?:startup\s+)?/i, "").trim() || lead0;
  return { company, round: `${round} (reported)`, lead, what, sector, us: !abroad, url: item.url ?? null, date: item.date ?? null };
}

/** The comparison (pure): market rounds that look like what crossed her desk, and the gaps. */
export function compareLists(crossed, funded) {
  const bySector = (rows) => rows.reduce((m, r) => m.set(r.sector, [...(m.get(r.sector) ?? []), r]), new Map());
  const desk = bySector(crossed);
  const market = bySector(funded);
  const alike = [...market.entries()].filter(([s]) => desk.has(s)).map(([sector, rows]) => ({ sector, market: rows.map((r) => r.company), desk: desk.get(sector).map((r) => r.company) }));
  const gaps = [...market.entries()].filter(([s]) => !desk.has(s)).map(([sector, rows]) => ({ sector, market: rows.map((r) => r.company) }));
  return { alike, gaps };
}

/** The Monday line for her (plain words). */
export function preseedLine(crossed, funded, cmp) {
  const gap = cmp.gaps.length ? ` Not reaching you: ${cmp.gaps.map((g) => g.sector).join(", ")}.` : "";
  return `Pre-seed watch: ${crossed.length} ${crossed.length === 1 ? "company" : "companies"} crossed your desk; ${funded.length} pre-seed ${funded.length === 1 ? "round was" : "rounds were"} announced in the market.${gap}`;
}
