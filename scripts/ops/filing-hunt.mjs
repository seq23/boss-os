#!/usr/bin/env node
/**
 * DANIELLE'S HALF OF THE HUNT: WHICH FUNDS HOLD THIS, WHO THERE COULD WRITE THE CHEQUE, AND HOW TO
 * FIND THEM.
 *
 * ─── Why this is a separate file and a separate person ─────────────────────
 *
 *   "Danielle finds, Monique relates."
 *
 * The seam is not workload — it is that FINDING A PERSON IS RESEARCH AND KNOWING A PERSON IS A
 * RELATIONSHIP. Reading eight N-PORT XML filings per name, doing the capacity arithmetic, pulling
 * Schedule A off Form ADV and working out whether a domain has an address convention is Technical
 * Program Management. Knowing which broker in her own ledger is already working a name, and whether
 * a firm she is mid-conversation with as an LP can be approached as a buyer, is Relationships.
 *
 * Monique carried eight of fourteen duties and Danielle carried one. This moves the half that was
 * never hers.
 *
 * ─── A SINGLE REQUEST STILL PRODUCES BOTH HALVES ───────────────────────────
 *
 * This is two people's work REPORTED TOGETHER, not two separate asks. `buyer-hunt.mjs` imports this
 * module and renders both halves into one email, each under its own byline. Splitting the delivery
 * would mean she asks one question and gets two answers on two mornings, which is worse than the
 * undivided version this replaced.
 *
 * ─── The chain, all free and all public ────────────────────────────────────
 *
 *   1. N-PORT via EDGAR — which funds report a position in this issuer, at what dollar mark, against
 *      what total net assets. Free, citable, and the only filing that sees private paper at all:
 *      13F covers exchange-traded securities and returns literally zero for every name in her book.
 *   2. FORM ADV via the SEC — the registered adviser behind the filer, its regulatory AUM, its client
 *      types, and ITS PRINCIPALS BY NAME on Schedule A. That is the population of people who could
 *      actually sign, and it is the answer to "who might be investors".
 *   3. HER OWN CONTACTS.json — 553 correspondents with an address each. Where she has written to a
 *      domain, the address PATTERN is evidence rather than a guess.
 *   4. A LINKEDIN SEARCH URL SHE CLICKS HERSELF. Composing a link is not scraping: nothing here logs
 *      in, fetches it or automates a browser, and no credential is requested or accepted.
 *
 * ─── EVERY LINE STATES ITS CONFIDENCE AND ITS SOURCE ───────────────────────
 *
 *   "Pattern from 9 known addresses at this domain" is evidence.
 *   "Most common format for US managers" is a guess.
 *
 * Conflating those is how she emails a stranger by the wrong name. `lib/reach.mjs` carries the
 * levels — known, pattern, record, link — and `validate:contact-source` fails the build if a line is
 * rendered without a file and a row behind it, or if a predicted address is printed without the
 * count of known addresses it rests on.
 *
 * ─── EMPTY-HANDED IS STILL A GOOD ANSWER, AND THIS IS WHERE THAT IS AT RISK ─
 *
 *   "if she comes up empty handed its fine. better than giving me trash."
 *
 * Attaching names to every hunt puts pressure on exactly that rule. A fund with a real filing and no
 * findable person MUST be able to report "holder confirmed, no person identified" and count as a
 * success — and it does: that is what a `record` line with no address is, and what the `none`
 * sentence says when there is not even one of those. If this ever learns to pad, she stops reading
 * it, and then the filings are worth nothing either.
 *
 *   npm run capital:filings -- --asset Anthropic --size 2000000000
 *   npm run capital:filings                      # every priced lot on her book
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { advFirms, advPeople } from "./lib/adv.mjs";
import { loadContacts, reachFor } from "./lib/reach.mjs";

/** SEC Fair Access requires a descriptive agent with a contact address. It is a condition, not a nicety. */
const USER_AGENT = process.env.SEC_USER_AGENT ?? "Boss OS capital research (seq.taylor@gmail.com)";
const FTS = "https://efts.sec.gov/LATEST/search-index";

/** Filings read per name. Enough to see who the holders are, far inside SEC's 10/second. */
const FILINGS_PER_ASSET = Number(process.env.BUYER_HUNT_FILINGS ?? 8);
/** Named holders printed per name. A directory is the People tab she deleted. */
export const CAP = Number(process.env.BUYER_HUNT_CAP ?? 6);
/** How far back a filing may be and still describe a position that plausibly still exists. */
const FILING_LOOKBACK_DAYS = Number(process.env.BUYER_HUNT_LOOKBACK_DAYS ?? 400);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const money = (n) => (n == null ? "unknown"
  : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n).toLocaleString("en-US")}`);

// ─── N-PORT: which funds report this position ─────────────────────────────────

export async function sec(url) {
  const r = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/json, text/xml, */*" } });
  if (!r.ok) throw new Error(`SEC ${r.status} for ${url}`);
  return r;
}

/** Recent N-PORT filings whose text names this issuer. */
export async function nportFilings(asset) {
  const startdt = new Date(Date.now() - FILING_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const url = `${FTS}?${new URLSearchParams({ q: `"${asset}"`, forms: "NPORT-P", startdt, enddt: new Date().toISOString().slice(0, 10) })}`;
  const j = await (await sec(url)).json();
  const seen = new Set();
  const out = [];
  for (const h of j?.hits?.hits ?? []) {
    const s = h._source ?? {};
    const cik = String(s.ciks?.[0] ?? "").replace(/^0+/, "");
    if (!cik || seen.has(cik)) continue;
    // `_id` is "accession:filename". The accession is what makes this citable.
    const [accRaw, file] = String(h._id ?? "").split(":");
    if (!accRaw) continue;
    seen.add(cik);
    out.push({
      cik,
      filer: String(s.display_names?.[0] ?? "").replace(/\s+\(CIK.*$/, "").trim(),
      accession: accRaw,
      file: file ?? "primary_doc.xml",
      filed: s.file_date ?? null,
      url: `https://www.sec.gov/Archives/edgar/data/${cik}/${accRaw.replace(/-/g, "")}/${file ?? "primary_doc.xml"}`,
    });
    if (out.length >= FILINGS_PER_ASSET) break;
  }
  return { filings: out, total: j?.hits?.total?.value ?? 0 };
}

/**
 * The position itself, out of the filing.
 *
 * WITHOUT THIS THE WHOLE THING WOULD BE A LIST OF FUND NAMES, which is the trash she asked not to
 * be given. "Fidelity holds Anthropic" is a fact she already assumes; "this Fidelity fund marks
 * $412M of Anthropic against $28B of net assets" is what tells her whether a $2B block is even a
 * conversation. So the XML is read for the matched holding's `valUSD` and the fund's `totAssets`,
 * and where either cannot be read it is reported as unknown rather than estimated.
 */
export function positionFromXml(xml, asset) {
  const key = assetKey(asset);
  const totAssets = Number(/<totAssets>\s*([0-9.]+)\s*<\/totAssets>/i.exec(xml)?.[1] ?? NaN);
  let best = null;
  for (const m of xml.matchAll(/<invstOrSec>([\s\S]*?)<\/invstOrSec>/gi)) {
    const block = m[1];
    const name = /<name>([\s\S]*?)<\/name>/i.exec(block)?.[1]?.trim() ?? "";
    const title = /<title>([\s\S]*?)<\/title>/i.exec(block)?.[1]?.trim() ?? "";
    if (!assetKey(name).includes(key) && !assetKey(title).includes(key)) continue;
    const val = Number(/<valUSD>\s*(-?[0-9.]+)\s*<\/valUSD>/i.exec(block)?.[1] ?? NaN);
    const pct = Number(/<pctVal>\s*(-?[0-9.]+)\s*<\/pctVal>/i.exec(block)?.[1] ?? NaN);
    if (!best || (Number.isFinite(val) && val > (best.valUSD ?? -1))) {
      best = { holding: name || title, valUSD: Number.isFinite(val) ? val : null, pctVal: Number.isFinite(pct) ? pct : null };
    }
  }
  return best ? { ...best, totAssets: Number.isFinite(totAssets) ? totAssets : null } : null;
}

/**
 * Can they write this check?
 *
 * A JUDGEMENT WITH ITS ARITHMETIC ON THE FACE OF IT, never a score. The test is whether the block
 * would be a sane position for this fund: against total net assets, and against what they already
 * hold in the name. Anything that cannot be computed says so — an unverified capacity is printed as
 * unverified and ranked below a verified one, because inventing it is exactly the failure mode this
 * whole file is written against.
 */
export function capacity(position, size, side = "buy") {
  if (side === "sell") return supply(position, size);
  if (!position || !size) return { verdict: "UNVERIFIED", why: "no size to test against" };
  const { totAssets, valUSD } = position;
  if (!totAssets) return { verdict: "UNVERIFIED", why: "the filing did not state total net assets" };
  const pct = (size / totAssets) * 100;
  if (pct <= 2) {
    return { verdict: "COMFORTABLY", why: `${money(size)} is ${pct.toFixed(2)}% of ${money(totAssets)} in net assets` };
  }
  if (pct <= 10) {
    return { verdict: "PLAUSIBLY", why: `${money(size)} is ${pct.toFixed(1)}% of ${money(totAssets)} in net assets — a real decision for them, not a routine add` };
  }
  return {
    verdict: "NO",
    why: `${money(size)} is ${pct.toFixed(0)}% of ${money(totAssets)} in net assets${valUSD ? `, against ${money(valUSD)} they already hold` : ""} — not a check this fund writes`,
  };
}

/**
 * THE SAME FILING, READ THE OTHER WAY ROUND.
 *
 * Hunting a BUYER asks whether the block would be a sane position for them — size against total net
 * assets. Hunting a SELLER asks a different and simpler question: do they actually HAVE it? The
 * answer is the position they themselves marked in the filing, `valUSD`, and nothing else. Total net
 * assets are irrelevant here: a $28B fund that marks $40M of OpenAI cannot sell her $1B of it.
 *
 * A PARTIAL FILL IS A REAL ANSWER AND IS SAID AS ONE. Somebody holding a quarter of what she wants
 * is a conversation — three of them is the trade — so it is PLAUSIBLY with the arithmetic printed,
 * never a silent pass and never dressed up as a full fill.
 */
export function supply(position, size) {
  if (!position || !size) return { verdict: "UNVERIFIED", why: "no size to test against" };
  const { valUSD } = position;
  if (!valUSD) {
    return { verdict: "UNVERIFIED", why: "the filing named the issuer and did not state a readable dollar mark for the position" };
  }
  if (valUSD >= size) {
    return {
      verdict: "COMFORTABLY",
      why: `they mark ${money(valUSD)} of it, which is ${(valUSD / size).toFixed(1)}x the ${money(size)} you want`,
    };
  }
  if (valUSD >= size * 0.25) {
    return {
      verdict: "PLAUSIBLY",
      why: `they mark ${money(valUSD)}, which is ${((valUSD / size) * 100).toFixed(0)}% of the ${money(size)} you want — a partial fill, not the whole block`,
    };
  }
  return {
    verdict: "NO",
    why: `they mark ${money(valUSD)} against the ${money(size)} you want — under a quarter of it, so not a seller for this size`,
  };
}

const RANK = { COMFORTABLY: 3, PLAUSIBLY: 2, UNVERIFIED: 1, NO: 0 };

export async function fromFilings(asset, size, SIDE = "buy") {
  let found;
  try { found = await nportFilings(asset); }
  catch (err) { return { holders: [], note: `EDGAR could not be read: ${err.message}` }; }

  const holders = [];
  for (const f of found.filings) {
    await sleep(150); // Well inside SEC's 10 requests/second.
    let position = null;
    try {
      const xml = await (await sec(f.url)).text();
      position = positionFromXml(xml, asset);
    } catch { /* One unreadable filing must not end the hunt for the other seven. */ }
    if (!position) continue;
    const cap = capacity(position, size, SIDE);
    // HER BAR: a holder who cannot write the cheque — or cannot supply the paper — is not a
    // candidate, it is a distraction.
    if (cap.verdict === "NO") continue;
    holders.push({ ...f, ...position, capacity: cap });
  }
  holders.sort((a, b) => (RANK[b.capacity.verdict] - RANK[a.capacity.verdict]) || ((b.valUSD ?? 0) - (a.valUSD ?? 0)));
  return { holders: holders.slice(0, CAP), scanned: found.filings.length, total: found.total };
}

// ─── Rendering ───────────────────────────────────────────────────────────────

/**
 * ─── HOW TO REACH THEM ─────────────────────────────────────────────────────
 *
 * Printed only from a row in a file. `reachFor` returns a `source` on every line — the file and the
 * row inside it — and a line with no source is never rendered. Where nothing resolves, the honest
 * sentence goes in instead, because "coming up empty handed is fine; returning noise is not".
 */
export function renderReach(lines, reach, indent) {
  lines.push(`${indent}HOW TO REACH THEM`);
  const printable = reach.lines.filter((l) => l.source?.file && l.source?.row);
  if (printable.length === 0) {
    lines.push(`${indent}  ${reach.none}`);
    return;
  }
  /*
   * THE CONFIDENCE IS ON THE FACE OF THE LINE, IN FRONT OF IT, NOT IN A LEGEND.
   *
   * `[known]` and `[pattern]` are different claims about the world and the difference matters at the
   * moment she is deciding whether to press send. A key at the bottom of the email is read once and
   * then never again; a prefix is read every time. `[record]` is the one that most needs saying —
   * that line is a PERSON and not a way to reach them, and without the label it reads like a contact
   * whose address was omitted.
   */
  for (const l of printable) lines.push(`${indent}  [${l.confidence}] ${l.text}`);
}

// ─── The people behind a filer ───────────────────────────────────────────────

/**
 * Form ADV for one filer: the adviser, and its principals by name.
 *
 * ONE FIRM, THE BEST MATCH, OR NONE. ADV search returns near-matches on a common word, and taking
 * the top hit regardless would attach "Blue Chip Capital LLC" to "Blue Chip Growth Fund" — the Forge
 * mistake in a new costume. So the hit has to line up with the filer on a distinctive run of words,
 * and where nothing does, this returns the empty answer with the reason on it.
 */
export async function peopleFor(filer, { offline = false } = {}) {
  if (!filer) return { people: [], firm: null, note: "no filer name" };

  const { firms, note } = await advFirms(filer, { offline });
  if (!firms.length) return { people: [], firm: null, note: note ?? "no adviser matched" };

  const norm = (x) => String(x ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const target = norm(filer);
  const firm = firms.find((f) => {
    const n = norm(f.firm_name);
    return n && (target.startsWith(n) || n.startsWith(target)) && n.length >= 8;
  }) ?? null;

  if (!firm) {
    return {
      people: [], firm: null,
      note: `Form ADV returned ${firms.length} adviser(s) and none lines up with "${filer}" closely enough to attribute a person to it.`,
    };
  }
  if (!firm.crd) return { people: [], firm, note: `${firm.firm_name} has no CRD in the ADV record, so its Schedule A cannot be read.` };

  const { people, note: pnote } = await advPeople(firm.crd, { offline });
  return { people, firm, note: people.length ? null : (pnote ?? "Form ADV lists no individuals for this firm.") };
}

// ─── Rendering the filings half ──────────────────────────────────────────────

/**
 * DANIELLE'S SECTION FOR ONE LOT. Rendered here rather than in `buyer-hunt.mjs` so that the half she
 * owns is the half she writes, and a change to the research output cannot be made by editing the
 * relationship file.
 */
export function renderFilings(lines, lot, filings, contacts, SIDE) {
  const size = lot.size_usd ?? 0;
  lines.push(SIDE === "sell"
    ? "  FROM FILINGS (N-PORT — funds that report holding this, and could therefore sell it) — Danielle"
    : "  FROM FILINGS (N-PORT — funds that report this position) — Danielle");

  if (filings.note) {
    lines.push(`    ${filings.note}`);
    return;
  }
  if (filings.holders.length === 0) {
    lines.push(SIDE === "sell"
      ? `    Nobody marking enough of it to supply ${money(size)}. ${filings.total ?? 0} N-PORT filing(s) name this issuer;`
      : `    Nobody who could write ${money(size)}. ${filings.total ?? 0} N-PORT filing(s) name this issuer;`);
    lines.push(SIDE === "sell"
      ? `    ${filings.scanned ?? 0} were read and none marked a position large enough against what you want.`
      : `    ${filings.scanned ?? 0} were read and none had both a readable position and the balance sheet for it.`);
    return;
  }

  for (const h of filings.holders) {
    lines.push(`    ${h.filer}`);
    lines.push(`      Holds ${money(h.valUSD)}${h.pctVal != null ? ` (${h.pctVal.toFixed(2)}% of the fund)` : ""} of "${h.holding}"`);
    lines.push(`      ${SIDE === "sell" ? "Could supply it" : "Can write it"}: ${h.capacity.verdict} — ${h.capacity.why}`);
    lines.push(`      ${h.filed ?? ""} N-PORT ${h.accession}  ${h.url}`);

    /*
     * THE ADVISER, WHERE FORM ADV HAS ONE. Its regulatory AUM is a DIFFERENT NUMBER from the mark
     * above and is labelled as such — the mark is what this fund holds of this issuer, the AUM is
     * what the adviser manages in total, and a reader who conflated them would badly misjudge who
     * can take a block.
     */
    if (h.adv?.firm) {
      const f = h.adv.firm;
      lines.push(`      ADV: ${f.firm_name}${f.crd ? ` (CRD ${f.crd})` : ""}${f.city ? ` · ${f.city}${f.state ? `, ${f.state}` : ""}` : ""}`
        + `${f.aum ? ` · ${money(Number(f.aum))} regulatory AUM across the adviser, not in this name` : ""}`);
    } else if (h.adv?.note) {
      // AN EMPTY ANSWER WITH A REASON IS A RESULT. "Holder confirmed, no person identified" is a
      // success, and it only reads as one if the run says which step came up empty.
      lines.push(`      ADV: ${h.adv.note}`);
    }

    /*
     * THE FILER'S OWN ADDRESSES AND ITS OWN PEOPLE ONLY. The first draft of the reach half passed
     * this asset's LEDGER rows in here too, and duly printed a broker from an unrelated OpenAI email
     * under "T. Rowe Price Blue Chip Growth Fund" — a real address, attributed to the wrong party.
     * The ledger's people are Monique's half and are rendered on their own rows above.
     */
    renderReach(lines, reachFor({ filer: h.filer, contacts, adv: h.adv ?? null }), "      ");
  }
}

/**
 * The whole of Danielle's half for one lot: the filings, and the people behind each holder.
 *
 * THE ADV LOOKUP IS PER HOLDER AND CAPPED BY `CAP` ABOVE, because it is one or two HTTP calls each
 * and the holders are already the short list. A lookup per filing rather than per holder would be
 * eight times the traffic for names that did not clear the capacity bar anyway.
 */
export async function researchLot(asset, size, SIDE = "buy", { offline = false } = {}) {
  const filings = await fromFilings(asset, size, SIDE);
  for (const h of filings.holders ?? []) {
    h.adv = await peopleFor(h.filer, { offline });
  }
  return filings;
}

// ─── Press and podcast mentions ───────────────────────────────────────────────

/**
 * THE ONE SOURCE FILINGS AND FORM ADV CANNOT SEE: SOMEBODY SAYING IT OUT LOUD.
 *
 * A fund's N-PORT mark is a dollar figure with no story behind it. A press release naming who led a
 * round, or a podcast guest describing a position they hold, is the same fact in the world's own
 * words — and it is the one piece of `interest-ledger-hunt`'s brief filings and ADV cannot reach: no
 * SEC form requires a fund to say why it holds something or when it said so out loud.
 *
 * NO NEW SPEND LANE. This calls `claudeCodeExecutor` directly, in-process — the same adapter every
 * `agent_executed` duty already uses, authenticating as the owner's own Claude Code session (macOS
 * keychain, never an API key). There is no Worker round trip and nothing crosses to D1: the prompt,
 * the search, and the result all stay on this machine, exactly like the filings half.
 *
 * A FINDING WITH NO URL IS NOT A FINDING. Same discipline as `assignedSearch`'s "no quote, no hit"
 * and `reachFor`'s "no source, no line" — dropped before it is ever rendered.
 *
 * ─── THE LINKEDIN LINE, AND WHY IT IS SAFE HERE AND NOT ON THE ADV HALF ────
 *
 * Her words, 25 Sep 2026: "why the fuck can u not just search linkedin and give me the linkedin
 * account of the person". For a press/podcast lead the answer is: it can, and does. Once a name is
 * already identified by a dated, quoted article, ONE further public web search for that specific
 * name plus organisation is enough to surface their actual profile URL from a search engine's own
 * index — nothing here logs into LinkedIn, fetches the page, or automates a browser against it. The
 * same boundary as the composed search link: no credential, no session, no scrape. This is not
 * offered for `filing-hunt.mjs`'s OWN Form ADV people (`peopleFor`/`reachFor`) on purpose — a name
 * off a regulatory filing has no independent corroboration, and a search engine confidently
 * returning the WRONG "John Smith at Blue Chip Capital" is exactly the Forge Global Holdings mistake
 * in a new costume. A press/podcast finding already carries a citation identifying the specific
 * person; that is what makes one further targeted search safe to trust.
 *
 * `spawnImpl` IS INJECTED, the same convention `claudeCodeExecutor` itself uses, defaulting to the
 * real process. A test passes a fake, so this whole function is exercised without spending anything
 * or invoking the CLI.
 */
export async function pressPodcastLeads(asset, size, side, { model, maxSeconds = 180, spawnImpl } = {}) {
  const { claudeCodeExecutor } = await import("../sync-agent/backends/claudeCode.mjs");
  const { mkdtempSync } = await import("node:fs");
  const cwd = mkdtempSync(path.join(os.tmpdir(), "ledger-hunt-"));
  const verb = side === "sell" ? "holding, dealing in, or having secondary-market exposure to" : "wanting to buy or add to a position in";
  const prompt = [
    `Search press releases, news coverage, and podcast transcripts or show notes — NOT SEC filings —`,
    `for named funds, family offices, or individuals who have PUBLICLY, ON THE RECORD, discussed`,
    `${verb} "${asset}" shares${size ? ` at a scale near ${money(size)}` : ""}.`,
    ``,
    `For EVERY finding, give: a name, an organisation, a one-sentence quote or close paraphrase of`,
    `what they said, a working source URL for that quote, whether it is press or podcast, and a`,
    `published date if you can find one. A finding with no working URL must be dropped, not printed —`,
    `an invented citation is worse than no finding at all.`,
    ``,
    `THEN, for each named person only (not organisations), do ONE further web search — their name plus`,
    `their organisation — to see if a LinkedIn profile URL for that specific person appears in the`,
    `search results. Do not log in to LinkedIn, fetch a LinkedIn page, or automate a browser against`,
    `it — a plain web search only. Include the URL ONLY if a search result plainly names this exact`,
    `person at this exact organisation — never a same-name person elsewhere, and never a URL you`,
    `constructed by guessing a pattern. If you are not sure it is the same person, leave it out; a`,
    `wrong profile handed to her as a fact is worse than no profile at all.`,
    ``,
    `Write your findings as JSON to ./delivers.json, nothing else in that file:`,
    `{"status":"complete","leads":[{"name":"...","org":"...","role":"...","evidence_quote":"...","source_url":"...","kind":"press"|"podcast","published_date":"...","linkedin_url":"..."}]}`,
    `Omit linkedin_url entirely (not an empty string) where you found no confident match.`,
    ``,
    `If you find nothing that clears this bar, write {"status":"complete","leads":[]} — that is a`,
    `valid, complete answer. Coming back empty is fine. A guess dressed up as a finding is not.`,
  ].join("\n");
  const result = await claudeCodeExecutor(
    { envelope: { web_tools: ["WebSearch", "WebFetch"], model, max_seconds: maxSeconds }, prompt, cwd },
    { spawnImpl },
  );
  const leads = (result.delivers?.leads ?? []).filter((l) => l && l.source_url)
    // A linkedin_url must actually look like one — a hallucinated non-URL string is dropped rather
    // than printed as though it were a link she could click.
    .map((l) => (l.linkedin_url && /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\//i.test(l.linkedin_url)
      ? l : { ...l, linkedin_url: undefined }));
  return {
    leads,
    note: result.error
      ? `the search could not complete: ${result.error}`
      : leads.length ? null : "searched; nothing cleared the bar (a name with no working source URL is dropped, not printed)",
  };
}

/**
 * DANIELLE'S SECTION, PRESS AND PODCAST HALF. Rendered beside `renderFilings`, under its own byline,
 * for the same reason the filings half is: the half she owns is the half she writes.
 */
export function renderPressPodcast(lines, press) {
  lines.push("  FROM PRESS AND PODCAST MENTIONS — Danielle");
  if (!press.leads.length) {
    lines.push(`    ${press.note ?? "nobody named"}`);
    return;
  }
  for (const l of press.leads) {
    lines.push(`    [${l.kind}] ${l.name}${l.org ? ` — ${l.org}` : ""}${l.role ? ` (${l.role})` : ""}`);
    lines.push(`      "${l.evidence_quote}"`);
    lines.push(`      ${l.published_date ? `${l.published_date}  ` : ""}${l.source_url}`);
    lines.push(l.linkedin_url
      ? `      LinkedIn: ${l.linkedin_url}`
      : `      LinkedIn: no confident match found by search — nothing was fetched or logged into`);
  }
}

// ─── Standalone ──────────────────────────────────────────────────────────────

/**
 * RUNNABLE ON ITS OWN, AND IT IS ALSO A LIBRARY. The duty runs it standalone so the research half has
 * a row of its own that can go red; `buyer-hunt.mjs` imports `researchLot` so a single request still
 * produces both halves in one email. One implementation either way — a second copy of the filings
 * logic behind the combined path is the defect this repository names most often.
 */
async function main() {
  const ARGS = process.argv.slice(2);
  const argOf = (n) => { const i = ARGS.indexOf(`--${n}`); return i === -1 ? null : ARGS[i + 1] ?? null; };
  const SIDE = (argOf("side") ?? "buy").toLowerCase() === "sell" ? "sell" : "buy";
  const HER_SIDE = SIDE === "sell" ? "buy" : "sell";
  const asset = argOf("asset");
  const size = Number(argOf("size") ?? 0);

  const { parseLiveBook } = await import("../../src/shared/boss/intake/liveBook.mjs");
  const DIR = process.env.BOSS_OS_CAPITAL_DIR ?? path.join(os.homedir(), ".boss-os", "capital");
  const BOOK_TEXT = argOf("book") ?? path.join(DIR, "book.txt");

  let lots;
  if (asset) {
    lots = [{ asset, side: HER_SIDE, size_usd: size || null, size_text: size ? money(size) : "" }];
  } else {
    // The pulled mirror is the book when there is one — see lib/book-mirror.mjs for the week this cost.
    const { mirrorOrStop } = await import("./lib/book-mirror.mjs");
    const mirror = argOf("book") ? null : mirrorOrStop();
    if (mirror) {
      lots = mirror.positions.filter((l) => l.side === HER_SIDE);
    } else {
      if (!fs.existsSync(BOOK_TEXT)) {
        console.error(`NAMED STOP [NO_BOOK] ${BOOK_TEXT} does not exist and no --asset was given.`);
        console.error("  Email your book to boss@sequoiataylor.com with #monique, or pass --asset and --size.");
        process.exit(5);
      }
      lots = parseLiveBook(fs.readFileSync(BOOK_TEXT, "utf8")).positions.filter((l) => l.side === HER_SIDE);
    }
  }
  if (lots.length === 0) {
    console.error(`NAMED STOP [EMPTY_BOOK] the book was read and holds no ${HER_SIDE}-side line.`);
    process.exit(6);
  }

  const contacts = loadContacts();
  const lines = [
    `Filings research — ${lots.length} lot(s), ${new Set(lots.map((l) => String(l.asset).toLowerCase())).size} name(s).`,
    "13F is not consulted and that is deliberate: it covers exchange-traded securities only and",
    "returns zero for every name you hold. N-PORT is where a fund reports a private position.",
    "",
    "Nobody here has been contacted.",
    "",
  ];
  let candidates = 0;
  for (const lot of lots) {
    lines.push(`${String(lot.asset).toUpperCase()}`);
    const filings = await researchLot(lot.asset, lot.size_usd ?? 0, SIDE);
    candidates += filings.holders?.length ?? 0;
    renderFilings(lines, lot, filings, contacts, SIDE);
    lines.push("");
  }
  console.log(lines.join("\n"));

  /*
   * RULE 0: ZERO HOLDERS IS A RESULT AND IT SAYS SO. What is NOT permitted is exiting quietly having
   * read nothing — so the render above always states the names searched and the filing counts, and
   * "found nobody" and "never ran" cannot produce the same page.
   */
  if (candidates === 0) console.log("No holder cleared the bar. That is an answer: the names, the filing counts and the reason are above.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`FILING HUNT FAILED: ${err?.stack ?? err}`); process.exit(1); });
}

