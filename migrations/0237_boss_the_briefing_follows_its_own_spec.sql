-- The briefing follows the specification it is handed, and the Investor Insight teaches the move.
--
-- ─── Her words, 13 September 2026 ───────────────────────────────────────────
--
-- "the executive breifing section is missing some sections (and u can make it scrollable)...like
--  major news (top 5 headlines) a one min summary section, markets dashboard a tech section a
--  cpaital markets secondary ipo m&A section....."
--
-- "u r also supposed to use the intelligence of the LLM to develop an investor insights section to
--  help me learn how to think about the stuff im reading....."
--
-- ─── WHICH END WAS WRONG, AND HOW THAT WAS ESTABLISHED ──────────────────────
--
-- THE PRODUCER. Not the consumer, not the model, and not a drift — it was instructed.
--
-- Measured first: `/api/boss/today` returned `status: partial` with THREE sections, each a thematic
-- analyst essay ("Capex Arms Race Becomes Structural Repricing Signal"). Every section she named as
-- missing is already mandated by §5 of `docs/boss/EXECUTIVE_INTELLIGENCE.md`, which lists ELEVEN in
-- a fixed order and has since the spec was carried in on 6 September.
--
-- Then read backwards through this directory's own history, which settles it in two lines:
--
--   0195: "follow its standards for sourcing and honesty, but NOT its length."
--   0205: "ignore it entirely on length and structure — THIS PROMPT GOVERNS THOSE", followed by
--         `sections [{ heading, so_what, bullets }] — FOUR AT MOST. This is a hard cap.`
--
-- The run was doing exactly what it was told, and was told to override the spec. Nothing had to be
-- diagnosed on the model's side. The consumer then applied `slice(0, 4)` on top, so even a
-- compliant run would have been cut to four on the screen.
--
-- ─── WHY THOSE TWO PROMPTS WERE WRITTEN, AND WHAT IS KEPT FROM THEM ─────────
--
-- Both were aimed at a real defect: a twenty-section newspaper, and sections that were walls of
-- stacked figures with no answer in them. That defect was never §5's section COUNT — §5's sections
-- are short and each has one job — it was the WRITING. So the structure comes back and 0205's rules
-- about how to write survive intact: the answer first, bullets not paragraphs, no figure opening a
-- bullet, nothing unverified softened or omitted, a quiet day allowed to be quiet.
--
-- WHAT DOES NOT SURVIVE: "bold the key phrase in every bullet". Her words today: "even in exec
-- briefing u have some bold stuff that i feel like should not be — headings should be bold and have
-- diff visual weight than the normal text". When EVERY bullet contains bold the bold marks nothing,
-- and it competed with a section heading that was rendered in `.eyebrow` — 11px, muted — directly
-- above it. Weight now belongs to hierarchy. `bold()` stays in the client unchanged so the month of
-- reports already written still renders correctly.
--
-- ─── THE INVESTOR INSIGHT IS AMENDED IN THE SPEC AS WELL AS HERE ────────────
--
-- §5 already mandated it and every example in it is a CONCLUSION. She is asking to be taught the
-- reasoning that reaches one, so she can make the move herself on tomorrow's news. Four parts now:
-- the synthesis, how it was reached, the transferable frame, and what would falsify it — plus the
-- citations that let the worker CHECK it rests on today's material. See the amended
-- `# Investor Insight` section of EXECUTIVE_INTELLIGENCE.md, which is the authority; this prompt
-- must not become a second copy of it.
--
-- §2.1 — never invent market data — binds all of this absolutely and binds the REASONING too. An
-- absent Markets & Macro Dashboard is the CORRECT outcome on a morning nothing could be verified;
-- a plausible-looking table is far worse than a named gap, on a page read by a registered
-- representative before she trades. `src/worker/boss/today/briefing.ts` names every §5 section the
-- run did not file, and withholds an insight whose facts are not in the report.
--
-- COST AND CADENCE ARE UNCHANGED. Same duty, same daily 06:30 Central, same model, same cap. Eleven
-- short sections is not more research than four long ones; it is the same research, filed where she
-- can find it. No `next_due_at` reset (0197 binds when cadence, weekday or weekdays move; none do).

UPDATE standing_duties
   SET task_input = json_set(task_input, '$.prompt', 'Produce today''s Executive Intelligence Report. She reads it at 7am, standing up, with coffee, before a day of work. Write it for a person, not for a database.

FOLLOW THE SPECIFICATION IN YOUR WORKING DIRECTORY, EXECUTIVE_INTELLIGENCE.md, INCLUDING ITS STRUCTURE. A previous version of this prompt told you to ignore it on structure and capped you at four sections; that was wrong and she noticed. Section 5 lists eleven sections in a fixed order and they are what she asked for by name.

THE ELEVEN SECTIONS, AND THE KEY TO FILE EACH UNDER:
  one_minute_summary   One-Minute Executive Summary - 3 to 5 developments, each with a number and the investor implication.
  top_5_headlines      Top 5 Headlines - up to five, each with a summary, why it matters (first-order, second-order, private markets), and an investor importance score out of 10. Do not inflate every score to 10.
  markets_dashboard    Markets & Macro Dashboard - a TABLE of verified figures only.
  spacex_watch         SpaceX Watch - follow section 2.5. SpaceX is not publicly listed; never invent a ticker or a price.
  ai_technology        AI & Technology - the broader pattern, not a repeat of the headlines.
  capital_markets      Capital Markets / IPO / M&A - valuation, structure, proceeds, who led, why it matters.
  private_markets      VC / Private Markets / Secondaries Roundup - use the reasoning lenses in section 5.
  government_legal     Government / Legal / Supreme Court / Regulation - distinguish a stay from a merits ruling, always.
  investor_insight     Investor Insight - see below. ONE insight, four parts.
  key_events           Key Events Today - exact time, Central, and what outcome changes the reading.
  one_thing_to_watch   One Thing to Watch - not yet consensus, with its confirmation signals.

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
  status      "complete" or "partial". Use "partial" whenever anything is unverified or any section is missing.
  headline    ONE line, twelve words at most, no figures. The single thing that changed. If nothing did: "Nothing moved that changes your week."
  summary     Two or three SHORT sentences. What it means for her, not what happened in the world.
  sections    [{ key, heading, so_what, bullets, items, table, insight }] - one entry per section you can fill, using the keys above, in the order above.
                key      one of the eleven keys. A section without a recognised key is filed at the end.
                heading  the section name from the list above
                so_what  one sentence: what she should do or watch because of this
                bullets  up to four strings, one short sentence each, no bold
                items    top_5_headlines only: [{ headline, summary, why_it_matters, importance }]
                table    markets_dashboard only: { columns: [..], rows: [[..], ..] } - verified figures only, or omit the section
                insight  investor_insight only: { synthesis, how_reached, transferable_frame, falsified_by, cites: [{ fact, from }] }
                         `from` is the key of the section in THIS report the fact came from.
  sources     [{ name, url, read_at }] - read_at is an ISO timestamp of when YOU opened it.
  gaps        [{ wanted, why }] - name every section you could not fill, by its section name.
  corrections [{ was, now, why }] - where today contradicts a previous report.

A short honest brief beats a long one, every single time.')
 WHERE id = 'duty_exec_intel';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0237_boss_the_briefing_follows_its_own_spec');
