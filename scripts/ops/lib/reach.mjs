/**
 * HOW TO REACH THEM — FROM HER OWN NETWORK, AND NEVER FROM A GUESS.
 *
 * ─── What the hunt was actually producing ──────────────────────────────────
 *
 * Counted on 12 September 2026, not assumed:
 *
 *   - Of the 23 OpenAI SELL-SIDE rows in her ledger, ZERO carry a principal email. One names a
 *     principal, and the name is "U.S. fund".
 *   - Across the whole 2,142-row ledger, 304 rows carry any principal email at all.
 *   - The EDGAR half prints a filer name, a dollar mark, a capacity verdict and a filing URL, and
 *     no address of any kind.
 *
 * So the output was a list of institutions with no way to speak to any of them.
 *
 * ─── The asset that was sitting unused ─────────────────────────────────────
 *
 * `~/.boss-os/sourcing/CONTACTS.json`: 553 correspondents, ALL 553 with an email address, each with
 * `sent`, `received` and `days_since_last`. People she has actually corresponded with.
 *
 * ─── HER STANDING RULE, WHICH IS THE WHOLE DESIGN ──────────────────────────
 *
 *   "if she comes up empty handed its fine. better than giving me trash."
 *
 * So this NEVER synthesises an address. It does not construct `firstname@company.com`, it does not
 * infer a domain from a fund's name and then invent a mailbox at it, and it does not fall back to a
 * "likely" contact. Every line it returns carries `source` — the file it came out of and the row
 * inside that file — and a caller that cannot show a source must print nothing.
 *
 * Where nothing resolves, the honest sentence is the output:
 *
 *     no address for this holder — the filing is the only handle
 *
 * ─── The three things that legitimately resolve ────────────────────────────
 *
 *   1. THE FILER, matched against CONTACTS.json on a distinctive token of the filer's name appearing
 *      in a correspondent's DOMAIN. "T. Rowe Price Blue Chip Growth Fund, Inc." matches a contact at
 *      `troweprice.com` because the run "t rowe price" joins to exactly that label. The token has to
 *      line up with the registrable label — equal to it, or a prefix of it and at least six
 *      characters — and runs made only of words like "fund", "capital", "growth" and "trust", which
 *      are in half of EDGAR, are dropped entirely. Anything looser is a machine for connecting her to
 *      strangers who share a common noun.
 *
 *   2. THE BROKER, from the ledger's own `intermediated_by`, which IS an email address (1,033 of the
 *      2,142 rows carry one). LABELLED AS THE BROKER AND NEVER AS THE PRINCIPAL. Sending a
 *      counterparty's intermediary an email meant for the counterparty is a real compliance problem,
 *      not a cosmetic one, and a line that does not say which is which invites exactly that.
 *
 *   3. THE PRINCIPAL, where the ledger actually carries `principal_email` — 304 rows do.
 *
 * Plain ESM so `scripts/validate` exercises this function rather than a copy of its judgement.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HER_BROKERAGE_DOMAIN } from "../interest-match.mjs";
import { linkedInSearch } from "./adv.mjs";

export const CONTACTS_PATH = process.env.BOSS_OS_CONTACTS
  ?? path.join(os.homedir(), ".boss-os", "sourcing", "CONTACTS.json");

/**
 * Words that appear in so many fund names that matching on them would introduce her to strangers.
 *
 * THE LIST IS THE PRECISION BAR. Without it "Blue Chip GROWTH Fund" matches anybody at a domain
 * containing "growth", and the output stops being her network.
 */
const TOO_COMMON = new Set([
  "fund", "funds", "trust", "trusts", "capital", "partners", "growth", "income", "value", "equity",
  "equities", "global", "international", "series", "portfolio", "portfolios", "advisors", "advisers",
  "management", "investment", "investments", "holdings", "group", "company", "corporation", "index",
  "select", "strategic", "opportunities", "opportunity", "america", "american", "market", "markets",
  "securities", "financial", "asset", "assets", "shares", "class", "master", "venture", "ventures",
  "innovation", "technology", "large", "small", "blue", "chip", "core", "total", "return", "bond",
]);

/**
 * The tokens of a filer's name that are specific enough to match a domain on.
 *
 * RUNS OF CONSECUTIVE WORDS, JOINED — because that is how a company's domain is actually built.
 * "T. Rowe Price Blue Chip Growth Fund, Inc." contains the run "t rowe price", which joins to
 * `troweprice`, which IS the label. Matching on the single word "price" would instead connect her to
 * every pricing company on earth, and matching on a suffix of the label would connect "related" to
 * "notrelated.com".
 *
 * A run made ENTIRELY of words that appear in half of EDGAR is dropped: "blue chip growth fund" is
 * not the name of anything.
 */
export function filerTokens(filer) {
  const words = String(filer ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !["inc", "llc", "lp", "ltd", "plc", "co", "corp", "the", "and", "of"].includes(w));

  const out = new Set();
  for (let i = 0; i < words.length; i += 1) {
    for (let n = 1; n <= 3 && i + n <= words.length; n += 1) {
      const run = words.slice(i, i + n);
      if (run.every((w) => TOO_COMMON.has(w))) continue;
      const token = run.join("");
      if (token.length >= 5) out.add(token);
    }
  }
  return [...out];
}

/** Read her correspondents. Returns `null` when the file is absent — which is a fact, not an error. */
export function loadContacts(file = CONTACTS_PATH) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const contacts = Array.isArray(parsed) ? parsed : (parsed.contacts ?? []);
    return {
      file,
      mailbox: parsed.mailbox ?? null,
      computedAt: parsed.computed_at ?? null,
      contacts: contacts.filter((c) => c && typeof c.email === "string" && c.email.includes("@")),
    };
  } catch {
    return null;
  }
}

/**
 * ─── EVERY LINE STATES ITS CONFIDENCE, AND THE LEVELS ARE NOT INTERCHANGEABLE ──────────────────
 *
 *   "Pattern from 9 known addresses at this domain" is evidence.
 *   "Most common format for US managers" is a guess.
 *   Conflating them is how she emails a stranger by the wrong name.
 *
 * So confidence is a FIELD, set where the line is built, and it can only ever be one of these:
 *
 *   known    — the address is written in a file. Her ledger, or her own correspondence record.
 *              Nothing was inferred; the line is as good as the file behind it.
 *   pattern  — the address is PREDICTED from addresses she already has at that exact domain. The
 *              line says how many agreed. This is the only kind of prediction permitted, and it is
 *              permitted because the evidence is countable and hers.
 *   record   — a real person, named in a public filing, with NO ADDRESS AT ALL. Form ADV publishes
 *              names and titles and no mailbox. This is the honest shape of most of what the ADV
 *              half returns, and it is genuinely useful: it turns "Fidelity holds it" into a person
 *              to look for. A `record` line must never be read as a way to reach somebody.
 *   link     — a search URL she clicks herself. Not a contact; a shortcut to finding one.
 *
 * THERE IS NO "GUESS" LEVEL, and its absence is the design. A constructed `firstname@fund.com` with
 * no pattern behind it reads exactly like a real address on the page and she would find out by
 * sending it. `predictAddress` returns null rather than inventing one, every time.
 */
export const CONFIDENCE = new Set(["known", "pattern", "record", "link"]);

/**
 * How many known addresses at a domain must AGREE before a pattern is evidence rather than a guess.
 *
 * TWO, AND NOT ONE. One address at a domain is a fact about one person: `jsmith@fund.com` is equally
 * consistent with `flast`, with `jsmith` being a whole first name, and with there being no convention
 * at all. Two that agree is a convention. And ANY disagreement kills it outright — a domain with both
 * `jsmith@` and `john.smith@` has two conventions or an exception, and a prediction into it is a coin
 * flip wearing a number.
 */
export const PATTERN_MIN = 2;

/** At most this many correspondents per holder. More than a few is a dump, not an introduction. */
export const FILER_CAP = 3;

const domainOf = (email) => String(email ?? "").split("@")[1]?.toLowerCase() ?? "";

/** The registrable label — "rainmakersecurities" out of "rainmakersecurities.com". */
const labelOf = (domain) => {
  const parts = String(domain ?? "").split(".").filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : (parts[0] ?? "");
};

/**
 * DOES THIS DOMAIN BELONG TO THIS FILER? A SUBSTRING IS NOT AN ANSWER.
 *
 * The first draft used `domain.includes(token)` and matched "Forge Global Holdings" to a contact at
 * `launchusaforge.co` — a real person, at an unrelated company, presented as a way to reach a fund
 * she has never dealt with. That is the trash she asked not to be given, produced by a guard that
 * was one character too loose.
 *
 * So the token has to line up with the registrable LABEL: equal to it, or — for a token long enough
 * to be distinctive on its own — a prefix or a suffix of it. "rainmaker" prefixes
 * "rainmakersecurities"; "roweprice" suffixes "troweprice"; "forge" does neither to
 * "launchusaforge", and is five characters long, so it is refused.
 */
export function domainBelongsTo(domain, token) {
  const label = labelOf(domain);
  if (!label || !token) return false;
  if (label === token) return true;
  /*
   * A PREFIX AND NOTHING ELSE. `rainmaker` prefixes `rainmakersecurities`, which is the real shape of
   * a firm's domain. A SUFFIX rule was tried and it matched "related" to "notrelated.com" — the same
   * class of mistake as the Forge case it was meant to replace.
   */
  if (token.length < 6) return false;
  return label.startsWith(token);
}

/**
 * THE SHAPE OF THE ADDRESSES SHE ALREADY HAS AT A DOMAIN.
 *
 * Given a person's name and the local part of a known address, which convention does it fit?
 * Returns a token — `first.last`, `flast`, `first.l`, `first`, `last` — or null when it fits none,
 * which is the common case and is not a failure.
 *
 * NAMED PATTERNS ONLY, AND NO FUZZY MATCHING. A rule like "the local part contains the surname"
 * would match `sales@` at a firm whose founder is called Sales, and would generate a prediction from
 * a shared-mailbox address. Each pattern below is an exact reconstruction or nothing.
 */
export function patternOf(fullName, local) {
  const parts = String(fullName ?? "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  const first = parts[0];
  const last = parts[parts.length - 1];
  const l = String(local ?? "").toLowerCase();
  if (!l) return null;

  if (l === `${first}.${last}`) return "first.last";
  if (l === `${first}${last}`) return "firstlast";
  if (l === `${first[0]}${last}`) return "flast";
  if (l === `${first}.${last[0]}`) return "first.l";
  if (l === `${first}_${last}`) return "first_last";
  if (l === first) return "first";
  if (l === last) return "last";
  return null;
}

/** Build the local part a pattern implies for a name, or null if it cannot be built. */
export function applyPattern(pattern, fullName) {
  const parts = String(fullName ?? "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  const first = parts[0];
  const last = parts[parts.length - 1];
  switch (pattern) {
    case "first.last": return `${first}.${last}`;
    case "firstlast": return `${first}${last}`;
    case "flast": return `${first[0]}${last}`;
    case "first.l": return `${first}.${last[0]}`;
    case "first_last": return `${first}_${last}`;
    /*
     * `first` AND `last` ARE DELIBERATELY NOT PREDICTABLE. They are real conventions and they are the
     * two that COLLIDE: a second Andrea at the firm cannot also be `andrea@`, so the prediction is
     * wrong precisely when the firm is big enough to matter. They are still recognised above, so a
     * domain that uses them produces NO pattern rather than a confident wrong one.
     */
    default: return null;
  }
}

/**
 * THE ADDRESS CONVENTION AT A DOMAIN, FROM HER OWN CORRESPONDENCE, OR NOTHING.
 *
 * @returns `{ pattern, evidence, domain }` where `evidence` is the actual addresses that agreed —
 *          carried so the line can say "pattern from 9 known addresses at this domain" and she can
 *          check the claim — or null.
 */
export function addressPattern(domain, contacts) {
  const dom = String(domain ?? "").toLowerCase();
  if (!dom || !contacts?.contacts?.length) return null;

  const at = contacts.contacts.filter((c) => domainOf(c.email) === dom && c.name);
  if (at.length < PATTERN_MIN) return null;

  const votes = new Map();
  let unexplained = 0;
  for (const c of at) {
    const pat = patternOf(c.name, String(c.email).split("@")[0]);
    if (!pat) { unexplained += 1; continue; }
    if (!votes.has(pat)) votes.set(pat, []);
    votes.get(pat).push(c.email);
  }

  const ranked = [...votes.entries()].sort((a, b) => b[1].length - a[1].length);
  const top = ranked[0];
  if (!top || top[1].length < PATTERN_MIN) return null;
  /*
   * DISAGREEMENT KILLS IT. A second convention with any support at all, or an address at the domain
   * whose shape nothing explains, means there is no single convention — and a prediction into a
   * domain with two conventions is a coin flip presented as a fact. Silence is the honest output and
   * the filing is still there as a handle.
   */
  if (ranked.length > 1 || unexplained > 0) return null;
  if (!applyPattern(top[0], "Placeholder Name")) return null;

  return { pattern: top[0], evidence: top[1], domain: dom };
}

/**
 * A PREDICTED ADDRESS, ONLY WHERE THE PATTERN IS KNOWN.
 *
 * Returns null far more often than not, and that is the feature. There is no fallback to a "most
 * common format": a constructed address with nothing behind it looks identical on the page to one
 * out of her own archive, and the way she would discover the difference is by sending it.
 */
export function predictAddress(fullName, domain, contacts) {
  const pat = addressPattern(domain, contacts);
  if (!pat) return null;
  const local = applyPattern(pat.pattern, fullName);
  if (!local) return null;
  return { email: `${local}@${pat.domain}`, pattern: pat.pattern, evidence: pat.evidence };
}

/** How warm the line is, in her own numbers. Never a score — the counts she can check. */
function warmth(c) {
  const bits = [];
  if (c.sent) bits.push(`you have written ${c.sent}`);
  if (c.received) bits.push(`${c.received} from them`);
  if (c.days_since_last != null) bits.push(`last ${c.days_since_last}d ago`);
  return bits.join(", ");
}

/**
 * Every way she can actually reach this holder, with the file and row behind each one.
 *
 * @returns `{ lines, none }` — `lines` each carry `{ text, kind, source }`, and `none` is the honest
 * sentence to print when there are no lines. A caller must never print a line without `source`.
 */
export function reachFor({ filer = null, rows = [], contacts = null, adv = null, handle = "the filing" } = {}) {
  const lines = [];
  const seen = new Set();
  /*
   * CONFIDENCE IS REQUIRED AT THE CALL, NOT DEFAULTED. A default would make the level the property of
   * whoever forgot to pass one, and the whole point is that `known` and `pattern` are different
   * claims about the world. An unrecognised level is dropped rather than printed at face value.
   */
  const push = (kind, confidence, text, source) => {
    if (!CONFIDENCE.has(confidence)) return;
    const key = `${kind}:${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    lines.push({ kind, confidence, text, source });
  };

  // 1. The principal, where the ledger actually has one.
  for (const r of rows) {
    if (!r?.principal_email) continue;
    push("principal", "known",
      `${r.principal ?? "the principal"} <${r.principal_email}>  — the principal, from your ledger`,
      { file: "capital/ledger.json", row: r.source_message ?? r.principal_email });
  }

  // 2. The broker. LABELLED, always.
  for (const r of rows) {
    if (!r?.intermediated_by) continue;
    const c = contacts?.contacts?.find((x) => x.email.toLowerCase() === String(r.intermediated_by).toLowerCase());
    push("broker", "known",
      `${r.intermediated_by}  — THE BROKER on this row, not the principal`
      + (c ? ` (${warmth(c)})` : ""),
      { file: "capital/ledger.json", row: r.source_message ?? r.intermediated_by });
  }

  /*
   * 3. THE FILER, matched against her own correspondents on a distinctive token in their domain.
   *
   * CAPPED, AND HER OWN FIRM IS EXCLUDED. Matching "Rainmaker Securities LLC" returns 26 colleagues
   * at `rainmakersecurities.com` — she is down the hall from all of them, and 26 lines under one
   * holder is a dump rather than a way to reach anybody. The same exclusion the cross already makes.
   */
  if (filer && contacts?.contacts?.length) {
    const tokens = filerTokens(filer);
    const matched = contacts.contacts
      .map((c) => ({ c, dom: domainOf(c.email), hit: tokens.find((t) => domainBelongsTo(domainOf(c.email), t)) }))
      .filter((m) => m.hit && !m.dom.endsWith(HER_BROKERAGE_DOMAIN))
      // The warmest first: somebody she has written to and heard from recently is the introduction.
      .sort((a, b) => (Number(b.c.sent) + Number(b.c.received)) - (Number(a.c.sent) + Number(a.c.received)))
      .slice(0, FILER_CAP);
    for (const { c, dom, hit } of matched) {
      push("filer", "known",
        `${c.name || c.email} <${c.email}>  — you already correspond at ${dom}`
        + (warmth(c) ? ` (${warmth(c)})` : "") + `; matched on "${hit}"`,
        { file: contacts.file, row: c.email });
    }
  }

  /*
   * ─── 4. THE PEOPLE, FROM FORM ADV — NAMED, AND USUALLY WITH NO ADDRESS ────
   *
   * This is the half that turns "Fidelity holds it" into a person. Schedule A names the principals;
   * it publishes no mailbox for any of them. So the ordinary shape of an ADV line is `record`: a real
   * person, a real title, a real firm, AND NO WAY TO REACH THEM YET. That is not a failed line — it
   * is the answer to "who might be investors", and it is the reason the LinkedIn link is composed
   * beside it.
   *
   * AN ADDRESS APPEARS ONLY WHERE HER OWN CORRESPONDENCE ALREADY SHOWS THE PATTERN, and then it is
   * labelled `pattern` and says how many known addresses it rests on. Nothing here ever constructs an
   * address at a domain she has never written to.
   */
  if (adv?.people?.length) {
    /*
     * THE DOMAIN COMES FROM HER OWN CORRESPONDENCE, NEVER FROM THE FIRM'S NAME. Deriving
     * `fidelity.com` from "Fidelity" is exactly the Forge mistake in a new costume: it looks right,
     * it is unverifiable, and a prediction built on it is a wrong address that reads like a real one.
     * So the domain must already appear in CONTACTS.json, matched by `domainBelongsTo` — the same
     * guard that refused `launchusaforge.co`.
     */
    const tokens = filer ? filerTokens(filer) : [];
    const knownDomain = contacts?.contacts
      ?.map((c) => domainOf(c.email))
      .find((d) => d && !d.endsWith(HER_BROKERAGE_DOMAIN) && tokens.some((t) => domainBelongsTo(d, t))) ?? null;

    for (const person of adv.people.slice(0, FILER_CAP)) {
      if (!person?.name || !person.source?.file || !person.source?.row) continue;

      const predicted = knownDomain ? predictAddress(person.name, knownDomain, contacts) : null;
      if (predicted) {
        push("adv_person", "pattern",
          `${person.name}${person.title ? `, ${person.title}` : ""} <${predicted.email}>  — PREDICTED from the `
          + `${predicted.evidence.length} known address(es) at ${knownDomain}, which all use `
          + `"${predicted.pattern}". Named on Form ADV; the address is inferred, not read.`,
          person.source);
      } else {
        push("adv_person", "record",
          `${person.name}${person.title ? `, ${person.title}` : ""}  — named on Form ADV`
          + `${person.firm ? ` at ${person.firm}` : ""}. NO ADDRESS: Form ADV publishes names, not mailboxes`
          + `${knownDomain ? ", and this firm's domain has no usable convention in your archive" : ", and you have never written to this firm"}.`,
          person.source);
      }

      const search = linkedInSearch(person.name, person.firm ?? filer);
      if (search) {
        push("linkedin", "link",
          `${search}  — a search you run yourself. Nothing here logs in, fetches it or automates it.`,
          person.source);
      }
    }
  }

  /*
   * THE HONEST SENTENCE. `handle` is what she is left with when nothing resolved — the SEC filing for
   * a fund, the email in her own archive for a ledger row. Naming it is the difference between "we
   * found nothing" and "here is the only thing you have".
   */
  return {
    lines,
    none: `no address for this holder — ${handle} is the only handle`
      + (contacts ? "" : ", and CONTACTS.json was not readable")
      + (adv?.note ? `. ${adv.note}` : ""),
  };
}
