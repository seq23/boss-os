-- "partial" is the wrong word when nothing is missing, and a figure now carries its source.
--
-- ─── 1. A REPORT THAT FILED EVERYTHING IT WAS ASKED FOR IS COMPLETE ─────────
--
-- A run on 13 September filed all ELEVEN sections, withheld nothing, and grounded its insight. It
-- reported `status: "partial"`. The four `gaps` behind that were every one of them a FUTURE EVENT:
--
--   "Monday Sept 15 Starship Flight 14 launch outcome"
--   "Sunday evening / Monday AM escalation or de-escalation from Saudi Arabia / Houthis"
--   "Anthropic IPO roadshow timing and preliminary pricing"
--   "Secondary market bid-ask spreads post-Saudi pipeline and pre-FOMC Wednesday"
--
-- Wanting tomorrow's news is not an incomplete report. It is a correct one. Her own standing rule
-- is explicit that a legitimate stop should read GREEN and self-explaining rather than amber — an
-- amber that fires on correct behaviour is an amber that stops meaning anything, which is the same
-- reason three of five Critical Alerts being false was worth a day's work.
--
-- `watching` is its own field and never touches the status. `gaps` keeps its older and narrower
-- meaning: something that EXISTS and could not be verified.
--
-- THE STATUS IS DERIVED NOW, NOT BELIEVED. The run said "partial" and the delivery wrote "partial"
-- down — the one claim in the whole payload that was never checked. Missing sections and insight
-- grounding are computed from the delivered report itself. The only thing still taken on the run's
-- word is which gaps are forward-looking, and the prompt draws that line in one sentence.
--
-- ─── 2. THE $72 OIL FIGURE, AND WHY NOTHING FORCED THE CORRECTION ───────────
--
-- Friday's report published Brent at roughly $72/bbl. The Friday close was $104.61 — a 45% error in
-- a headline figure, in the report she reads at 7am to make decisions. Sunday's run corrected it,
-- and only because that run happened to re-check.
--
-- THE DUTY'S SUCCESS CRITERION ALREADY SAID "every figure carries a named source and the time it was
-- read". It was not enforced, and could not have been. `success_criteria` is a TEXT column:
-- `duties/author.ts` writes it, two screens display it, and no code in this repository has ever
-- evaluated one. It is prose handed to the run, not a check.
--
-- THE MORE SERIOUS HALF is that an enforced criterion would still have had nothing to check.
-- `sources` is a REPORT-LEVEL array; figures live inside a section's `bullets`, `items` and `table`;
-- and nothing related one to the other. No section has ever named which source a number came from.
-- Two halves of one payload, each keeping its own list, with no link between them — this
-- repository's most-produced defect, sitting under its most decision-bearing screen.
--
-- So a section carries `sources`, and a section that prints a FIGURE must name one that RESOLVES —
-- present in the report's own list, with a URL and a readable timestamp. A section that cannot does
-- not print: it is named in `missing_sections` with that as the reason, because the absence has to
-- be louder than the number was.
--
-- A CITATION PROVES PROVENANCE, NEVER ACCURACY, so the corrections mechanism stays exactly as it
-- is. It is what caught the $72, and it is the only thing that can catch a figure that is wrong and
-- sourced.
--
-- ─── 3. THE DASHBOARD ON A CLOSED DAY, DECIDED ONCE ─────────────────────────
--
-- Two runs of this duty twenty minutes apart disagreed about the same morning. One withheld the
-- Markets & Macro Dashboard because US markets were shut on the Sunday and only Friday's close was
-- available; the other filed it, populated with Friday's close, labelled as Friday's. Both are
-- defensible readings of §2.1 and only one can be right — and re-litigating it every morning is the
-- same churn as a somatic rotation that changed between reads.
--
-- THE RULE: RENDER IT, LABELLED. §2.1 exists to stop stale data being passed off as CURRENT, and a
-- close explicitly marked "Friday 11 Sept close" is not passed off as current — the label is what
-- satisfies the rule. Withholding the whole dashboard costs her the one section that orients every
-- other one, on the morning when the orientation matters most. The decision lives in the
-- specification now so the producer follows it instead of reasoning it out afresh each day.

ALTER TABLE executive_reports ADD COLUMN watching TEXT NOT NULL DEFAULT '[]';
ALTER TABLE executive_reports ADD COLUMN shortfalls TEXT NOT NULL DEFAULT '[]';


-- The producer is told all three rules, so it follows them rather than reasoning them out afresh.
UPDATE standing_duties
   SET task_input = json_set(task_input, '$.prompt', 'Produce today''s Executive Intelligence Report. She reads it at 7am, standing up, with coffee, before a day of work. Write it for a person, not for a database.

FOLLOW THE SPECIFICATION IN YOUR WORKING DIRECTORY, EXECUTIVE_INTELLIGENCE.md, INCLUDING ITS STRUCTURE. A previous version of this prompt told you to ignore it on structure and capped you at four sections; that was wrong and she noticed. Section 5 lists eleven sections in a fixed order and they are what she asked for by name.

THE ELEVEN SECTIONS, AND THE KEY TO FILE EACH UNDER:
  one_minute_summary   One-Minute Executive Summary - 3 to 5 developments, each with a number and the investor implication.
  top_5_headlines      Top 5 Headlines - up to five, each with a summary, why it matters (first-order, second-order, private markets), and an investor importance score out of 10. Do not inflate every score to 10.
  markets_dashboard    Markets & Macro Dashboard - a TABLE of verified figures only. ON A DAY THE
                       MARKET WAS CLOSED, RENDER THE LAST CLOSE AND LABEL IT: put the date in the
                       COLUMN HEADING ("Friday Sept 11 Close"), not in a note underneath. Do not
                       withhold this section because the market is shut - section 2.1 exists to stop
                       stale data being passed off as CURRENT, and a figure marked with the date it
                       closed is not passed off as current. The label is what satisfies the rule.
                       This section orients every other one; omit it only if not even a last close
                       can be verified.
  spacex_watch         SpaceX Watch - follow section 2.5. SpaceX is not publicly listed; never invent a ticker or a price.
  ai_technology        AI & Technology - the broader pattern, not a repeat of the headlines.
  capital_markets      Capital Markets / IPO / M&A - valuation, structure, proceeds, who led, why it matters.
  private_markets      VC / Private Markets / Secondaries Roundup - use the reasoning lenses in section 5.
  government_legal     Government / Legal / Supreme Court / Regulation - distinguish a stay from a merits ruling, always.
  investor_insight     Investor Insight - see below. ONE insight, four parts.
  key_events           Key Events Today - exact time, Central, and what outcome changes the reading.
  one_thing_to_watch   One Thing to Watch - not yet consensus, with its confirmation signals.

EVERY FIGURE CARRIES ITS SOURCE. Section 2.1 binds each NUMBER, not just the report: name the source
in the section''s own `sources` field. A section that prints figures and cites nothing is withheld
from her screen entirely, which is worse for you than a shorter section.

A SECTION YOU CANNOT FILL IS OMITTED AND NAMED IN gaps. Never file a heading over nothing, and NEVER fill a section with plausible-looking data to avoid leaving it out. Section 2.1 is absolute: if a figure cannot be verified it does not appear. She is a registered representative and she trades on this. Her screen names every section you did not file, so an honest absence costs you nothing and an invented table costs her money.

WRITING RULES, WHICH ARE NOT NEGOTIABLE:
  - The ANSWER first, the evidence after. Lead with what it MEANS.
  - Bullets, not paragraphs. One short sentence each.
  - Do NOT bold anything. Weight on her screen means hierarchy; bold inside a sentence competes with the heading above it and marks nothing when every bullet has it.
  - Never open a bullet with a number. Say what changed, then the figure.
  - No section may exceed four bullets. Eleven short sections, not a newspaper.
  - Never file a section that is a title, a date line, a data-cutoff note or a description of this report. A section is a FINDING.

A QUIET DAY IS A SHORT REPORT AND THAT IS A GOOD OUTCOME. File the sections that have something in them and name the rest as gaps. Manufacturing content out of a quiet morning is how she learns to stop opening this.

Weight her businesses: late-stage secondaries and private markets, a fundraise to family offices and endowments, and small web properties that live or die on search.

THE INVESTOR INSIGHT - read its section in EXECUTIVE_INTELLIGENCE.md, which is the authority. In short: ONE synthesized idea, never a restated headline, plus how you reached it, the transferable frame, and what would falsify it. Pitch it at the level of analytical frame - how an allocator connects a capex commitment to a discount rate to a secondary bid - NEVER at the level of definitions. She knows what a secondary is and an explanation of one will make her stop reading. Do not hedge; commit to the analysis. If today''s material does not support a synthesis worth writing, SAY SO and file no insight - a forced daily insight is horoscope writing.
Every fact the insight joins must appear elsewhere in this same report, and you must cite them. The system CHECKS this and withholds an insight whose facts are not in the day''s material.

SKY.json holds every planetary position, her natal chart and today''s transits, computed by this system to about one arcminute. It is authoritative for anything astronomical - do not search the web for ephemeris data. The astrology and the Money / Career / Travel Map are NOT part of this report; they live on her Spirit page. Do not include them.

You have WebSearch and WebFetch. Open the sources you cite rather than recalling them. Every figure carries a named source and the time it was read; anything unverified goes in gaps rather than being softened or omitted. NEVER drop a caveat to make the writing flow.

Write delivers.json in the current working directory, rewriting it as you go rather than at the end:
  status      "complete" or "partial". The system DERIVES this from what you actually filed, so do
              not worry about getting it right - but file "partial" if you know a section is absent
              or a figure is unverified. Note that a full `watching` list does not make you partial.
  headline    ONE line, twelve words at most, no figures. The single thing that changed. If nothing did: "Nothing moved that changes your week."
  summary     Two or three SHORT sentences. What it means for her, not what happened in the world.
  sections    [{ key, heading, so_what, bullets, items, table, insight }] - one entry per section you can fill, using the keys above, in the order above.
                key      one of the eleven keys. A section without a recognised key is filed at the end.
                heading  the section name from the list above
                so_what  one sentence: what she should do or watch because of this
                bullets  up to four strings, one short sentence each, no bold
                sources  REQUIRED on any section that prints a figure. An array naming entries in
                         your own `sources` list, by index or by name. A section that prints a money
                         amount, a percentage or a magnitude and names no resolvable source IS NOT
                         SHOWN TO HER AT ALL - it is reported as absent with that as the reason.
                         Friday''s report published Brent at ~$72/bbl against an actual close of
                         $104.61 and nothing required it to say where that came from, so nothing
                         caught it for two days.
                items    top_5_headlines only: [{ headline, summary, why_it_matters, importance }]
                table    markets_dashboard only: { columns: [..], rows: [[..], ..] } - verified figures only, or omit the section
                insight  investor_insight only: { synthesis, how_reached, transferable_frame, falsified_by, cites: [{ fact, from }] }
                         `from` is the key of the section in THIS report the fact came from.
  sources     [{ name, url, read_at }] - read_at is an ISO timestamp of when YOU opened it.
  gaps        [{ wanted, why }] - things that EXIST and you could NOT VERIFY, plus every section
              you could not fill, by its section name. A gap makes the report "partial".
  watching    [{ wanted, why }] - FORWARD-LOOKING only: events that HAVE NOT HAPPENED YET. Monday''s
              launch outcome, a pricing date not yet set, next week''s decision. These do NOT make a
              report partial - wanting tomorrow''s news is a correct report, not an incomplete one.
              Put a future event HERE and never in gaps.
  corrections [{ was, now, why }] - where today contradicts a previous report.

A short honest brief beats a long one, every single time.')
 WHERE id = 'duty_exec_intel';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0242_boss_partial_means_something_is_missing');
