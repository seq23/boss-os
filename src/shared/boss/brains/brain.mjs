/**
 * BRAINS (owner, 31 Oct 2026: "time to work"). One markdown document per business — the single
 * source of truth every employee reads first. This module is the ONE definition of what a brain is:
 * the eight businesses, the eight sections in order, the skeleton, how gaps and private spans are
 * written, and who reads which brain. The Worker (routes, prompts, mail edits, the Monday check),
 * the screen and the Mac scripts (the morning email, the local copy) all import it, so there is no
 * second list to drift.
 *
 * The repo is public: nothing here, and nothing seeded, carries real brain content. Real content
 * lives only in D1 (and in her private local copy, ~/Brains).
 */

/** The eight businesses, in the order the screen and the scoreboard list them. */
export const BRAINS = Object.freeze([
  { slug: "west-peek-ventures", title: "West Peek Ventures" },
  { slug: "west-peek-events", title: "West Peek Events (TLC & Rooms)" },
  { slug: "porch-and-party", title: "Porch & Party 901" },
  { slug: "time-2-read", title: "Time-2-Read" },
  { slug: "industry-guides", title: "Industry Guides" },
  { slug: "spry", title: "Spry" },
  { slug: "westpeek-live", title: "westpeek.live" },
  { slug: "friends", title: "Friends' businesses" },
  // Not a business (coordinator, 31 Oct 2026): Boss OS itself, Spirit, gates, coaching, her schedule.
  { slug: "personal", title: "Personal" },
  // A plain document, not a business (coordinator, 31 Oct 2026): the roster of West Peek OS and Boss
  // OS employees. No sections, no skeleton; every employee reads a short excerpt to route work.
  { slug: "team", title: "Who's who — your AI teams" },
]);
export const BRAIN_SLUGS = Object.freeze(BRAINS.map((b) => b.slug));
/** Brains that are businesses. The scoreboard and "all" (every business) read only these. */
export const NOT_A_BUSINESS = Object.freeze(["personal", "team"]);
/** Brains that are one plain document rather than the eight sections. */
export const PLAIN_DOCS = Object.freeze(["team"]);
export const TEAM_SLUG = "team";
export const TEAM_PLACEHOLDER_LINE = "Write the roster here in Boss OS: each West Peek OS and Boss OS employee, what they own, and who to send what to.";
export const BUSINESS_SLUGS = Object.freeze(BRAIN_SLUGS.filter((s) => !NOT_A_BUSINESS.includes(s)));

/** The sections, in order. Every brain has all eight. */
export const SECTIONS = Object.freeze([
  "Company", "Numbers", "Priorities", "People", "Voice", "Settled decisions", "Open questions", "Who does what",
]);

export const MISSING = "[MISSING]";
export const NUMBERS_HEADER = "| Metric | Definition | Source | Value | Last updated |";
export const NUMBERS_RULE = "|---|---|---|---|---|";
/** A brain not touched in this many days is "stale": said calmly, never red. */
export const STALE_DAYS = 90;
const DAY_MS = 86_400_000;

/** The seed for any brain: the skeleton, or for a plain doc its title and one placeholder line. */
export function seedFor(slug, title) {
  return PLAIN_DOCS.includes(slug) ? `# ${title}\n\n${TEAM_PLACEHOLDER_LINE}\n` : skeleton(title);
}

/** A new brain: every section present, every gap written [MISSING]. The migration seeds exactly this. */
export function skeleton(title) {
  const parts = [`# ${title}`, ""];
  for (const s of SECTIONS) {
    parts.push(`## ${s}`);
    if (s === "Numbers") parts.push(NUMBERS_HEADER, NUMBERS_RULE, `| ${MISSING} | | | ${MISSING} | |`);
    else parts.push(MISSING);
    parts.push("");
  }
  return parts.join("\n");
}

/**
 * A gap is a LINE that still says [MISSING] (a Numbers row with two is one gap: one metric to fill).
 * So a fresh brain has eight gaps, one per section, and "N gaps to fill" means N things to write.
 */
export function missingCount(md) {
  return String(md ?? "").split("\n").filter((l) => l.includes(MISSING)).length;
}

export function isStale(updatedAt, now = Date.now()) {
  return Number.isFinite(Number(updatedAt)) && now - Number(updatedAt) > STALE_DAYS * DAY_MS;
}
export function daysSince(updatedAt, now = Date.now()) {
  return Math.max(0, Math.floor((now - Number(updatedAt)) / DAY_MS));
}
/** "today", "yesterday", "3 days ago", "94 days ago". */
export function updatedWords(updatedAt, now = Date.now()) {
  if (!Number.isFinite(Number(updatedAt)) || !updatedAt) return "never";
  const d = daysSince(updatedAt, now);
  return d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}

/** The brain cut into its sections: [{ name, body }], in document order. Text before the first ## is `head`. */
export function parseSections(md) {
  const lines = String(md ?? "").replace(/\r\n/g, "\n").split("\n");
  const head = [];
  const sections = [];
  let cur = null;
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m && !line.startsWith("###")) {
      cur = { name: canonicalSection(m[1]) ?? m[1].trim(), lines: [] };
      sections.push(cur);
    } else if (cur) cur.lines.push(line);
    else head.push(line);
  }
  return {
    head: head.join("\n").trim(),
    sections: sections.map((s) => ({ name: s.name, body: s.lines.join("\n").trim() })),
  };
}

/** Put the brain back together, the eight sections in their order, any extra ones after. */
export function joinSections(head, sections) {
  const out = [head.trim(), ""];
  const byName = new Map(sections.map((s) => [s.name, s.body]));
  const names = [...SECTIONS.filter((n) => byName.has(n)), ...sections.map((s) => s.name).filter((n) => !SECTIONS.includes(n))];
  for (const n of names) out.push(`## ${n}`, (byName.get(n) ?? "").trim() || MISSING, "");
  return out.join("\n");
}

export function sectionBody(md, name) {
  const want = canonicalSection(name) ?? name;
  return parseSections(md).sections.find((s) => s.name === want)?.body ?? null;
}

/** Replace one section's body (adding the section in its place if it was missing). */
export function replaceSection(md, name, body) {
  const want = canonicalSection(name);
  if (!want) throw new Error(`There is no section called "${name}"`);
  const { head, sections } = parseSections(md);
  const at = sections.findIndex((s) => s.name === want);
  const next = { name: want, body: String(body ?? "").trim() || MISSING };
  if (at >= 0) sections[at] = next; else sections.push(next);
  return joinSections(head, sections);
}

/** Add lines to a section. A section that was only [MISSING] loses the placeholder. */
export function appendToSection(md, name, lines) {
  const want = canonicalSection(name);
  if (!want) throw new Error(`There is no section called "${name}"`);
  const current = sectionBody(md, want) ?? "";
  const kept = current.split("\n").filter((l) => l.trim() && l.trim() !== MISSING && l.trim() !== `- ${MISSING}`);
  return replaceSection(md, want, [...kept, ...lines].join("\n"));
}

const SECTION_ALIASES = [
  [/^company$|^about$|^the company$/, "Company"],
  [/^numbers?$|^metrics?$|^scoreboard$/, "Numbers"],
  [/^priorit(y|ies)$/, "Priorities"],
  [/^people$|^team$/, "People"],
  [/^voice$|^tone$/, "Voice"],
  [/^settled decisions?$|^decisions?$/, "Settled decisions"],
  [/^open questions?$|^questions?$/, "Open questions"],
  [/^who does what$|^roles?$/, "Who does what"],
];
export function canonicalSection(name) {
  const n = String(name ?? "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  for (const [re, canon] of SECTION_ALIASES) if (re.test(n)) return canon;
  return null;
}

// ─── The Numbers table ───────────────────────────────────────────────────────

const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

/** The Numbers table as rows. Never invents a value: an empty or [MISSING] Value is `null`. */
export function numbersRows(md) {
  const body = sectionBody(md, "Numbers") ?? "";
  const rows = [];
  for (const line of body.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const c = cells(line);
    if (/^metric$/i.test(c[0] ?? "") || /^-+$/.test((c[0] ?? "").replace(/:/g, ""))) continue;
    const metric = c[0] ?? "";
    if (!metric || metric === MISSING) continue;
    const value = (c[3] ?? "").trim();
    rows.push({
      metric,
      definition: c[1] ?? "",
      source: c[2] ?? "",
      value: !value || value === MISSING ? null : value,
      last_updated: (c[4] ?? "").trim() && c[4].trim() !== MISSING ? c[4].trim() : null,
    });
  }
  return rows;
}

/** Set one metric's value (adding the row when it is new), stamped with the day. */
export function setNumber(md, metric, value, day) {
  const body = sectionBody(md, "Numbers") ?? "";
  const lines = body.split("\n").filter((l) => l.trim());
  const table = lines.filter((l) => l.trim().startsWith("|"));
  const rest = lines.filter((l) => !l.trim().startsWith("|"));
  const header = [NUMBERS_HEADER, NUMBERS_RULE];
  const data = table.filter((l) => { const c = cells(l); return !/^metric$/i.test(c[0] ?? "") && !/^-+$/.test((c[0] ?? "").replace(/:/g, "")); })
    .filter((l) => cells(l)[0] !== MISSING);
  const want = metric.trim().toLowerCase();
  let found = false;
  const next = data.map((l) => {
    const c = cells(l);
    if ((c[0] ?? "").toLowerCase() !== want) return l;
    found = true;
    return `| ${c[0]} | ${c[1] ?? ""} | ${c[2] ?? ""} | ${value} | ${day} |`;
  });
  if (!found) next.push(`| ${metric.trim()} | ${MISSING} | ${MISSING} | ${value} | ${day} |`);
  return replaceSection(md, "Numbers", [...header, ...next, ...rest.filter((l) => l.trim() !== MISSING)].join("\n"));
}

/** Scoreboard rows for one brain: every tracked metric, or one "not tracked yet" line. Never a guess. Personal has none. */
export function scoreboardRows(brain) {
  if (NOT_A_BUSINESS.includes(brain.slug)) return [];
  const rows = numbersRows(brain.body_md);
  if (!rows.length) return [{ slug: brain.slug, business: brain.title, metric: null, value: null, words: "not tracked yet", last_updated: null }];
  return rows.map((r) => ({
    slug: brain.slug, business: brain.title, metric: r.metric, value: r.value,
    words: r.value ?? "not tracked yet", last_updated: r.last_updated,
  }));
}

// ─── Private spans ───────────────────────────────────────────────────────────

/**
 * LP names, fund terms, deal terms and investor names are wrapped
 * `<!-- confidential -->…<!-- /confidential -->`. Only the Claude seat may read them. Everywhere
 * else they are cut out by `stripConfidential` — FAIL CLOSED: an opening mark with no close cuts
 * everything after it, and a stray close mark is removed.
 */
export const CONFIDENTIAL_OPEN = "<!-- confidential -->";
export const CONFIDENTIAL_CLOSE = "<!-- /confidential -->";
const OPEN_RE = /<!--\s*confidential\s*-->/i;
const CLOSE_RE = /<!--\s*\/\s*confidential\s*-->/i;
const ANY_MARK_RE = /<!--\s*\/?\s*confidential\s*-->/i;
export const PRIVATE_PLACEHOLDER = "(private part removed)";

export function hasConfidential(text) {
  return ANY_MARK_RE.test(String(text ?? ""));
}

export function stripConfidential(text) {
  let rest = String(text ?? "");
  let out = "";
  for (;;) {
    const open = OPEN_RE.exec(rest);
    if (!open) { out += rest.replace(new RegExp(CLOSE_RE.source, "gi"), ""); break; }
    out += rest.slice(0, open.index).replace(new RegExp(CLOSE_RE.source, "gi"), "") + PRIVATE_PLACEHOLDER;
    const after = rest.slice(open.index + open[0].length);
    const close = CLOSE_RE.exec(after);
    if (!close) break; // unclosed: everything after the mark is private
    rest = after.slice(close.index + close[0].length);
  }
  return out;
}

// ─── Who reads which brain ───────────────────────────────────────────────────

/**
 * Each employee reads the brain(s) of the business(es) they serve, at the top of every job prompt.
 * "all" means every BUSINESS brain, summarised (Company, Priorities, Settled decisions); Simone
 * also reads "personal" (her own life and Boss OS itself), so hers is "all+personal". From the roster
 * (STATUS.md, migration 0175/0192): Simone is chief of staff to everything; Camille runs the
 * Porch & Party briefing and Marketplace; Monique runs relationships and outreach (West Peek's LPs
 * and Rooms, Time-2-Read, Industry Guides); Danielle fixes every grid repo; Zora keeps the archive.
 * Kendra (systems), Toni (the isolated trading lane) and Imani (her own practice) serve no business.
 */
export const EMPLOYEE_BRAINS = Object.freeze({
  emp_chief: "all+personal",
  emp_research: ["porch-and-party"],
  emp_relationship: ["west-peek-ventures", "west-peek-events", "time-2-read", "industry-guides"],
  emp_repo: "all",
  emp_knowledge: "all",
  emp_continuity: [],
  emp_risk: [],
  emp_practice: [],
});

export function brainsFor(employeeId) {
  const v = EMPLOYEE_BRAINS[String(employeeId ?? "")];
  if (v === "all") return { slugs: [...BUSINESS_SLUGS], summarised: true };
  if (v === "all+personal") return { slugs: [...BUSINESS_SLUGS, "personal"], summarised: true };
  return { slugs: Array.isArray(v) ? [...v] : [], summarised: false };
}

const PER_BRAIN_CHARS = 8000;
const SUMMARY_SECTION_CHARS = 500;
const cap = (s, n) => (s.length > n ? `${s.slice(0, n)}\n(… cut for length; the full brain is in Boss OS)` : s);

/**
 * The block an employee reads first. Private spans are kept here ONLY when `keepConfidential` is
 * set (the Claude seat); the router and the dispatch strip them again regardless.
 */
export function brainBlock(brains, { summarised = false, keepConfidential = false } = {}) {
  if (!brains.length) return "";
  const clean = (s) => (keepConfidential ? s : stripConfidential(s));
  const parts = [
    "==================================================",
    summarised ? "THE BUSINESSES YOU SERVE (their brains, summarised — read this first)" : "THE BUSINESS YOU SERVE (its brain — read this first)",
    "==================================================",
    "This is the single source of truth about the business. Where it says [MISSING], nobody has written it yet: never invent it, say it is missing.",
    "",
  ];
  for (const b of brains) {
    const md = clean(String(b.body_md ?? ""));
    if (summarised) {
      parts.push(`### ${b.title}`);
      for (const s of ["Company", "Priorities", "Settled decisions"]) {
        parts.push(`${s}: ${cap((sectionBody(md, s) ?? MISSING).replace(/\n+/g, " "), SUMMARY_SECTION_CHARS)}`);
      }
      parts.push(`Gaps still to fill: ${missingCount(md)}`, "");
    } else {
      parts.push(cap(md.trim(), PER_BRAIN_CHARS), "");
    }
  }
  return parts.join("\n").trim();
}

const WHOS_WHO_CHARS = 1500;
/**
 * The short "who's who" every employee reads so they route work to the right colleague: the team
 * doc's opening, private spans cut unless `keepConfidential`. Empty while it is still the placeholder.
 */
export function whosWhoBlock(teamDoc, { keepConfidential = false } = {}) {
  if (!teamDoc || typeof teamDoc.body_md !== "string") return "";
  const md = (keepConfidential ? teamDoc.body_md : stripConfidential(teamDoc.body_md))
    .replace(/^#\s+.*\n?/, "").trim();
  if (!md || md === TEAM_PLACEHOLDER_LINE) return "";
  return [
    "==================================================",
    "WHO'S WHO (send each piece of work to the colleague who owns it)",
    "==================================================",
    cap(md, WHOS_WHO_CHARS),
  ].join("\n");
}

// ─── Edits by email ──────────────────────────────────────────────────────────

const BRAIN_ALIASES = [
  [/^(p ?& ?p|p ?and ?p|pnp|porch( ?(&|and) ?party)?( ?901)?)$/, "porch-and-party"],
  [/^(time ?-? ?2 ?-? ?read|time ?to ?read|t2r)$/, "time-2-read"],
  [/^(wpv|west ?peek( ?ventures)?|the fund)$/, "west-peek-ventures"],
  [/^(west ?peek ?events|events|tlc|rooms|tlc ?(&|and) ?rooms)$/, "west-peek-events"],
  [/^(industry ?guides|guides|the ?industry ?guides)$/, "industry-guides"],
  [/^(spry|spry ?labs)$/, "spry"],
  [/^(westpeek\.?live|wpl|west ?peek ?live)$/, "westpeek-live"],
  [/^(friends|friends'? ?businesses)$/, "friends"],
  [/^(personal|boss ?os)$/, "personal"],
  [/^(who'?s ?who)$/, "team"],
];
export function brainSlugFor(words) {
  const n = String(words ?? "").toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9&.' -]/g, " ").replace(/\s+/g, " ").trim();
  if (BRAIN_SLUGS.includes(n)) return n;
  for (const [re, slug] of BRAIN_ALIASES) if (re.test(n)) return slug;
  return null;
}

const SECTION_WORDS = "company|numbers?|metrics?|priorit(?:y|ies)|people|voice|settled decisions?|decisions?|open questions?|questions?|who does what";
// "<brain> brain: <rest>"  or  "<brain> <section>: <rest>"
const HEADER_RE = new RegExp(
  `^\\s*(?<brain>[a-z0-9&.'’ -]{2,40}?)\\s+(?:brain\\s*[:\\-—–]\\s*(?<rest>.*)|(?<section>${SECTION_WORDS})\\s*[:\\-—–]\\s*(?<rest2>.*))$`, "i");
const SIGN_OFF = /^(thanks|thank you|thx|ty|best|cheers|sequoia|s|-+|--|sent from my .*)[,.!]?$/i;

/** "1 grow sales 2 hire" → ["1. grow sales", "2. hire"], only when the numbers run 1, 2, 3 in order. */
function numberedItems(text) {
  const t = String(text).trim();
  if (!/^1[.)]?\s/.test(t)) return null;
  const parts = t.split(/(?:^|\s)(\d{1,2})[.)]?\s+/).filter((x) => x !== "");
  const items = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    if (Number(parts[i]) !== items.length + 1) return null;
    items.push(`${items.length + 1}. ${parts[i + 1].trim()}`);
  }
  return items.length >= 2 ? items : null;
}

/**
 * Brain edits in her own words. Each edit: { slug, section, op: "add" | "replace" | "set_number", lines, metric?, value? }.
 * Only edits that name a real brain AND a real section count; anything else is not an edit.
 */
export function parseBrainEdits(text, today = new Date().toISOString().slice(0, 10)) {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    const m = HEADER_RE.exec(line);
    const named = m ? brainSlugFor(m.groups.brain) : null;
    // A plain document (the team's who's who) has no sections: it is edited on its screen, not by a section line.
    const slug = named && !PLAIN_DOCS.includes(named) ? named : null;
    if (m && slug) {
      cur = { slug, section: m.groups.section ?? null, first: (m.groups.rest ?? m.groups.rest2 ?? "").trim(), more: [] };
      blocks.push(cur);
    } else if (cur && line && !SIGN_OFF.test(line)) {
      cur.more.push(line);
    }
  }
  const edits = [];
  for (const b of blocks) {
    let sectionWords = b.section;
    let rest = b.first;
    let op = "replace";
    if (!sectionWords) {
      // "<brain> brain: add settled decision …" / "… brain: priorities: …" / "… brain: set revenue to 9"
      const add = new RegExp(`^(?:add|new)\\s+(?:an?\\s+)?(?<s>${SECTION_WORDS})\\s*[:\\-—–]?\\s*(?<r>.*)$`, "i").exec(rest);
      const sec = new RegExp(`^(?<s>${SECTION_WORDS})\\s*[:\\-—–]\\s*(?<r>.*)$`, "i").exec(rest);
      const set = /^set\s+(?<metric>.+?)\s+(?:to|=|:)\s+(?<value>.+)$/i.exec(rest);
      if (set) { edits.push({ slug: b.slug, section: "Numbers", op: "set_number", metric: set.groups.metric.trim(), value: set.groups.value.trim(), lines: [] }); continue; }
      if (add) { sectionWords = add.groups.s; rest = add.groups.r; op = "add"; }
      else if (sec) { sectionWords = sec.groups.s; rest = sec.groups.r; }
      else continue;
    } else {
      const add = /^(?:add|new)\s*[:\-—–]?\s+(?<r>.*)$/i.exec(rest);
      const set = /^set\s+(?<metric>.+?)\s+(?:to|=|:)\s+(?<value>.+)$/i.exec(rest);
      if (set && canonicalSection(sectionWords) === "Numbers") { edits.push({ slug: b.slug, section: "Numbers", op: "set_number", metric: set.groups.metric.trim(), value: set.groups.value.trim(), lines: [] }); continue; }
      if (add) { rest = add.groups.r; op = "add"; }
    }
    const section = canonicalSection(sectionWords);
    if (!section) continue;
    const textLines = [rest, ...b.more].map((l) => l.trim()).filter(Boolean);
    if (!textLines.length) continue;
    let out;
    if (section === "Settled decisions") {
      out = textLines.map((l) => decisionLine(l, today));
      op = "add";
    } else if (section === "Priorities" && textLines.length === 1 && numberedItems(textLines[0])) {
      out = numberedItems(textLines[0]);
    } else {
      out = textLines;
    }
    edits.push({ slug: b.slug, section, op, lines: out });
  }
  return edits;
}

/** "- YYYY-MM-DD — decision — why". Her "because …" / "— …" becomes the why; no why is [MISSING]. */
export function decisionLine(text, today) {
  const t = String(text).replace(/^[-*•]\s*/, "").trim();
  if (/^\d{4}-\d{2}-\d{2}\s+—/.test(t)) return `- ${t}`;
  const m = /^(?<what>.+?)\s*(?:\s—\s|\s–\s|\s-\s|,?\s+because\s+|;\s*why:?\s*)(?<why>.+)$/i.exec(t);
  const what = (m?.groups.what ?? t).replace(/[.\s]+$/, "");
  const why = (m?.groups.why ?? MISSING).replace(/[.\s]+$/, "");
  return `- ${today} — ${what} — ${why}`;
}

/** Apply one parsed edit to a brain's markdown. */
export function applyEdit(md, edit, today) {
  if (edit.op === "set_number") return setNumber(md, edit.metric, edit.value, today);
  if (edit.op === "add") return appendToSection(md, edit.section, edit.lines);
  return replaceSection(md, edit.section, edit.lines.join("\n"));
}

// ─── The Monday check ────────────────────────────────────────────────────────

const SHORT = { "porch-and-party": "P&P", "west-peek-ventures": "West Peek Ventures", "west-peek-events": "West Peek Events" };
export const shortName = (b) => SHORT[b.slug] ?? b.title;

/**
 * One plain line for Simone's Monday email. Never red: "Brains: all fresh", or what is stale and how
 * many gaps are left, e.g. "P&P brain not updated in 94 days · 6 gaps across 3 brains".
 */
export function cohesionLine(brains, now = Date.now()) {
  const stale = brains.filter((b) => isStale(b.updated_at, now)).sort((a, b) => a.updated_at - b.updated_at);
  const gaps = brains.map((b) => ({ b, n: missingCount(b.body_md) })).filter((x) => x.n > 0);
  const total = gaps.reduce((s, x) => s + x.n, 0);
  const bits = [];
  if (stale.length === 1) bits.push(`${shortName(stale[0])} brain not updated in ${daysSince(stale[0].updated_at, now)} days`);
  else if (stale.length > 1) bits.push(`${stale.length} brains not updated in 90+ days (oldest: ${shortName(stale[0])}, ${daysSince(stale[0].updated_at, now)} days)`);
  if (total > 0) bits.push(`${total} ${total === 1 ? "gap" : "gaps"} across ${gaps.length} ${gaps.length === 1 ? "brain" : "brains"}`);
  return bits.length ? `Brains: ${bits.join(" · ")}` : "Brains: all fresh";
}
