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
export function reachFor({ filer = null, rows = [], contacts = null, handle = "the filing" } = {}) {
  const lines = [];
  const seen = new Set();
  const push = (kind, text, source) => {
    const key = `${kind}:${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    lines.push({ kind, text, source });
  };

  // 1. The principal, where the ledger actually has one.
  for (const r of rows) {
    if (!r?.principal_email) continue;
    push("principal",
      `${r.principal ?? "the principal"} <${r.principal_email}>  — the principal, from your ledger`,
      { file: "capital/ledger.json", row: r.source_message ?? r.principal_email });
  }

  // 2. The broker. LABELLED, always.
  for (const r of rows) {
    if (!r?.intermediated_by) continue;
    const c = contacts?.contacts?.find((x) => x.email.toLowerCase() === String(r.intermediated_by).toLowerCase());
    push("broker",
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
      push("filer",
        `${c.name || c.email} <${c.email}>  — you already correspond at ${dom}`
        + (warmth(c) ? ` (${warmth(c)})` : "") + `; matched on "${hit}"`,
        { file: contacts.file, row: c.email });
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
      + (contacts ? "" : ", and CONTACTS.json was not readable"),
  };
}
