/**
 * FORM ADV — WHO COULD ACTUALLY WRITE THE CHEQUE, BY NAME, FROM A PUBLIC FILING.
 *
 * ─── The gap this fills ────────────────────────────────────────────────────
 *
 * The hunt could already say which FUNDS hold a name and at what size: N-PORT, read out of EDGAR,
 * with an accession number behind every line. What it could never say is WHO. A fund is not a person
 * and you cannot call one.
 *
 * Form ADV is the answer and the SEC publishes it free. Every registered investment adviser files
 * one, and SCHEDULE A NAMES THE PRINCIPALS — the direct owners and executive officers, by name, with
 * their titles. That is the population of people who could sign. It also carries regulatory AUM,
 * client types and the firm's own address, which is how a fund that "holds Anthropic" becomes a firm
 * of a knowable size with knowable clients and a named managing partner.
 *
 * ─── NOTHING IS PAID FOR AND NOTHING IS SCRAPED ────────────────────────────
 *
 * `api.adviserinfo.sec.gov` is the SEC's own public search service behind adviserinfo.sec.gov. It is
 * read with a declared User-Agent, as EDGAR requires and as `buyer-hunt.mjs` already does. No key, no
 * account, no terms accepted on her behalf.
 *
 * ─── EVERY FACT CARRIES THE FILE AND ROW IT CAME OUT OF ────────────────────
 *
 * The responses are CACHED TO DISK BEFORE ANYTHING IS RETURNED, and every object points at the
 * cached file. That is not a performance decision. Her standing rule is that a line she cannot check
 * is worse than no line, and `a-contact-line-has-a-source.mjs` enforces it by BEHAVIOUR: a line with
 * no `source.file` and `source.row` is never rendered. A live API response is not a source — it is
 * gone the moment it is parsed, and "the SEC said so last Tuesday" is not something she can open.
 * The cache file is.
 *
 * ─── AND AN EMPTY ANSWER IS A GOOD ANSWER ──────────────────────────────────
 *
 *   "if she comes up empty handed its fine. better than giving me trash."
 *
 * A fund with a real filing and no findable person must be able to report "holder confirmed, no
 * person identified" and count as a success. Attaching names to every hunt puts pressure on exactly
 * that rule: if the system learns to pad, she stops reading it. So every function here returns
 * `null` or an empty list rather than a guess, and the reason is carried on the result.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const ADV_DIR = process.env.BOSS_OS_ADV_DIR
  ?? path.join(os.homedir(), ".boss-os", "sourcing", "adv");

/** The SEC asks for a real contact in the User-Agent. `buyer-hunt.mjs` sends the same. */
const USER_AGENT = process.env.SEC_USER_AGENT ?? "Boss OS research (seq.taylor@gmail.com)";

const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

function cached(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function store(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return true;
  } catch {
    /*
     * A CACHE THAT COULD NOT BE WRITTEN MEANS THE LINES HAVE NO SOURCE FILE, and a line with no
     * source is not rendered. So this is reported rather than swallowed: the caller downgrades to
     * "no person identified", which is a correct answer, instead of printing names nobody can check.
     */
    return false;
  }
}

async function getJson(url) {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.json();
}

/**
 * Firms whose name matches, with what the filing says about them.
 *
 * @returns `{ firms, source, note }`. `firms` is `[]` with a `note` when nothing resolved — never a
 *          near-match dressed up as a hit.
 */
export async function advFirms(name, { maxAgeDays = 30, offline = false } = {}) {
  const key = slug(name);
  if (!key) return { firms: [], source: null, note: "no firm name to look up" };

  const file = path.join(ADV_DIR, `firm-${key}.json`);
  const hit = cached(file);
  const fresh = hit && Date.now() - (hit.fetched_at ?? 0) < maxAgeDays * 86_400_000;

  let payload = fresh ? hit : null;
  if (!payload) {
    if (offline) return { firms: [], source: null, note: "ADV not cached for this filer and the run is offline" };
    try {
      const raw = await getJson(
        `https://api.adviserinfo.sec.gov/search/firm?query=${encodeURIComponent(name)}&hits=10&type=Firm&investmentAdvisors=true`,
      );
      payload = { fetched_at: Date.now(), query: name, raw };
      /*
       * NOT CACHED MEANS NOT USED. See `store` — a result with no file behind it cannot produce a
       * sourced line, and an unsourced line is not printed at any confidence.
       */
      if (!store(file, payload)) {
        return { firms: [], source: null, note: `ADV read but ${ADV_DIR} could not be written, so nothing here has a source` };
      }
    } catch (err) {
      return { firms: [], source: null, note: `Form ADV could not be read: ${err.message}` };
    }
  }

  const hits = payload?.raw?.hits?.hits ?? [];
  const firms = hits.map((h) => {
    const d = h?._source ?? {};
    return {
      firm_name: d.firmname ?? d.org_name ?? null,
      crd: d.org_pk ?? d.crd_number ?? null,
      sec_number: d.sec_nb ?? null,
      city: d.firm_ia_city ?? d.city ?? null,
      state: d.firm_ia_state ?? d.state ?? null,
      /*
       * REGULATORY AUM, AND IT IS A DIFFERENT NUMBER FROM THE N-PORT MARK. The filing's `valUSD` is
       * what one fund holds of one issuer; this is what the adviser manages in total. Naming which
       * is which matters, because the capacity arithmetic in the hunt uses the first and a reader
       * would reasonably assume the second.
       */
      aum: d.firm_ia_full_regaum ?? null,
      // Kept verbatim so nothing here is a paraphrase of a regulatory disclosure.
      client_types: d.firm_ia_client_types ?? null,
      source: { file, row: String(d.org_pk ?? d.firmname ?? h?._id ?? "") },
    };
  }).filter((f) => f.firm_name && f.source.row);

  return {
    firms,
    source: { file },
    note: firms.length === 0 ? "No registered investment adviser matched this filer's name in Form ADV." : null,
  };
}

/**
 * The people at a firm, by CRD — Schedule A's principals, as the SEC's own individual search returns
 * them.
 *
 * NAMES ONLY, AND THAT IS THE HONEST LIMIT. Form ADV does not publish an email address for anybody.
 * What this gives is a real person with a real title at a real firm, which is what turns "Fidelity
 * holds it" into somebody to look for. Turning a name into an address is a SEPARATE step with a
 * SEPARATE confidence, done in `reach.mjs`, and it happens only where her own correspondence already
 * shows the pattern.
 */
export async function advPeople(crd, { maxAgeDays = 30, offline = false } = {}) {
  if (!crd) return { people: [], source: null, note: "no CRD to look people up by" };

  const file = path.join(ADV_DIR, `people-${slug(String(crd))}.json`);
  const hit = cached(file);
  const fresh = hit && Date.now() - (hit.fetched_at ?? 0) < maxAgeDays * 86_400_000;

  let payload = fresh ? hit : null;
  if (!payload) {
    if (offline) return { people: [], source: null, note: "no cached ADV people for this firm and the run is offline" };
    try {
      const raw = await getJson(
        `https://api.adviserinfo.sec.gov/search/individual?query=${encodeURIComponent(String(crd))}&hits=25&type=Individual`,
      );
      payload = { fetched_at: Date.now(), crd, raw };
      if (!store(file, payload)) return { people: [], source: null, note: `ADV people read but ${ADV_DIR} could not be written` };
    } catch (err) {
      return { people: [], source: null, note: `Form ADV individuals could not be read: ${err.message}` };
    }
  }

  const hits = payload?.raw?.hits?.hits ?? [];
  const people = hits.map((h) => {
    const d = h?._source ?? {};
    const name = [d.ind_firstname, d.ind_middlename, d.ind_lastname].filter(Boolean).join(" ").trim()
      || d.ind_namefull || null;
    return {
      name,
      crd: d.ind_source_id ?? null,
      /*
       * THE TITLE IS THE POINT. "Managing Partner" and "Compliance Associate" are both on Schedule A
       * and only one of them is somebody to approach about a block. The title is reported and never
       * interpreted — ranking people by seniority would be this file guessing at a hierarchy it
       * cannot see.
       */
      title: d.ind_other_names ?? d.ind_current_employments?.[0]?.title ?? null,
      firm: d.ind_current_employments?.[0]?.firm_name ?? null,
      source: { file, row: String(d.ind_source_id ?? name ?? h?._id ?? "") },
    };
  }).filter((p) => p.name && p.source.row);

  return {
    people,
    source: { file },
    note: people.length === 0 ? "Form ADV lists no individuals for this firm." : null,
  };
}

/**
 * A LINKEDIN SEARCH SHE RUNS HERSELF.
 *
 * ─── What this is, and what it deliberately is not ─────────────────────────
 *
 * COMPOSING A SEARCH LINK IS NOT SCRAPING. This builds a URL and prints it. Nothing here logs in,
 * nothing fetches it, nothing automates a browser against it, and no credential is requested,
 * accepted or stored — she offered and that offer was declined, and the decline stands.
 *
 * It exists because the ADV name is often the whole answer: she knows the firm, she now knows the
 * person, and the thing she would do next is look them up. One click beats retyping a name into a
 * search box, and it keeps the human in the only part of this that needs one.
 */
export function linkedInSearch(person, firm = null) {
  const terms = [person, firm].filter(Boolean).join(" ").trim();
  if (!terms) return null;
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(terms)}`;
}
