-- The briefing, written for her eyes instead of for a database.
--
-- ─── Her words, 8 September 2026 ────────────────────────────────────────────
--
-- "the exec intelligence report needs to be formatted for something to read and take in quickly in
--  the morning .... the way it is formmated now is for a machine not for a human eyes. it needs to
--  be synthesized and summarized and formatted properly"
--
-- ─── The diagnosis, because it is both halves and they need different fixes ─
--
-- 0195 already cut this to six sections for exactly this reason and it is still unreadable, which
-- is the tell that adding structure is not the answer. Reading the actual delivered report for
-- 7 September settles which half is which:
--
--   · **The PROMPT was asking for the wrong shape.** It asks for `summary` as "two or three
--     sentences" and gets five, each one a stack of figures — "August payrolls +162,000 vs ~55,000
--     consensus; Chair Kevin Warsh went hawkish at Jackson Hole" — true, sourced, and impossible to
--     take in standing up with coffee. Nowhere does it ask for the ANSWER before the evidence.
--   · **The SCREEN was rendering fields in storage order.** Heading, paragraph, heading, paragraph,
--     then a source list. A data structure with a stylesheet.
--
-- ─── What changes here, and what deliberately does not ──────────────────────
--
-- `headline` IS THE ONE NEW COLUMN, and it is the whole idea: one line, twelve words, the single
-- thing that changed. If she reads nothing else she has read the report. It is a column rather than
-- the first line of `summary` because Today's collapsed block shows ONE line, and slicing a
-- sentence out of a paragraph to fill it would put a half-thought on the screen.
--
-- THE TRANSPORT IS UNCHANGED. `sections`, `sources`, `gaps` and `corrections` are still JSON and
-- still carry everything they carried. What changes is that a section may now say WHAT IT MEANS
-- and carry bullets rather than a paragraph, and that the screen no longer renders provenance at
-- the same weight as content.
--
-- THE HONESTY PROPERTIES ARE NOT COMPRESSED AWAY, and this is the line worth holding: a briefing
-- that reads beautifully because it dropped its caveats is worse than the one it replaced. So
-- `gaps` and `corrections` stay ON the screen at full weight — "I could not verify this" and
-- "yesterday I told you the opposite" are decision-bearing. Only `sources` move behind a toggle,
-- because a list of URLs with ISO timestamps is provenance she reaches for when she doubts a
-- figure, not something she reads at 7am.
--
-- COST IS UNCHANGED. Same duty, same daily cadence, same Haiku, same 5-minute cap, ~$0.15 a run.
-- Asking for a synthesis is not more work than asking for six sections — it is less, and the
-- prompt now says so in a sentence the run can act on. No model change, no cadence change, and
-- therefore no `next_due_at` to reset (0197's rule binds when cadence, weekday or weekdays move;
-- none of them does here).

ALTER TABLE executive_reports ADD COLUMN headline TEXT;

-- ─── The prompt, rewritten ──────────────────────────────────────────────────
--
-- Kept as one UPDATE on the duty rather than a second document, because `task_input` is what the
-- runner actually reads and a spec file it is told to "follow but not for length" has already
-- proven it can be outvoted by its own instructions.
--
-- WHAT THE NEW PROMPT ASKS FOR THAT THE OLD ONE DID NOT:
--   · the ANSWER first — a headline, then a synthesis, then the evidence
--   · bullets with the key phrase in bold, because she glazes over paragraphs and has said so
--   · "so what" per section: what it means for HER, not what happened in the world
--   · four sections at most, down from six, and permission to file fewer
--   · explicit permission for a quiet day to be one line — a good outcome, not an empty one
UPDATE standing_duties
   SET task_input = json_set(
         task_input,
         '$.prompt',
         'Produce today''s Executive Intelligence Report. She reads it at 7am, standing up, with coffee, before a day of work. Write it for a person, not for a database.' || char(10) || char(10) ||
         'THE ORDER IS THE ANSWER FIRST, THE EVIDENCE AFTER. Her instruction, verbatim: "it needs to be synthesized and summarized and formatted properly". A previous run opened with five sentences of stacked figures — every one true, every one sourced, and impossible to take in. Lead with what it MEANS.' || char(10) || char(10) ||
         'FORMAT RULES, WHICH ARE NOT NEGOTIABLE:' || char(10) ||
         '  - NEVER file a section that is a title, a date line, a data-cutoff note or a description of this report. Put the cutoff time in the summary if it matters. A section is a FINDING.' || char(10) ||
         '  - Bullets, not paragraphs. One short sentence each.' || char(10) ||
         '  - Bold the key phrase in every bullet with **markdown asterisks**. She scans; the bold is what she scans for.' || char(10) ||
         '  - Never open a bullet with a number. Say what changed, then the figure.' || char(10) ||
         '  - No section may exceed four bullets.' || char(10) ||
         '  - A table only where two things are genuinely being compared.' || char(10) || char(10) ||
         'A QUIET DAY IS A ONE-LINE REPORT AND THAT IS A GOOD OUTCOME. If nothing moved that changes her week, say exactly that, file no sections, and stop. Manufacturing four sections out of a quiet morning is how she learns to stop opening this.' || char(10) || char(10) ||
         'Cover only what could change a decision she makes THIS WEEK, aimed at her actual businesses: late-stage secondaries and private markets, a fundraise to family offices and endowments, and small web properties that live or die on search. Skip general market colour she can get anywhere.' || char(10) || char(10) ||
         'The specification is in your working directory as EXECUTIVE_INTELLIGENCE.md. Follow its standards for SOURCING AND HONESTY, and ignore it entirely on length and structure — this prompt governs those.' || char(10) || char(10) ||
         'SKY.json holds every planetary position, her natal chart and today''s transits, computed by this system to about one arcminute. It is authoritative for anything astronomical — do not search the web for ephemeris data, and cite it as "Boss OS (computed)". If it is missing, file that as a gap and carry on.' || char(10) || char(10) ||
         'You have WebSearch and WebFetch. Open the sources you cite rather than recalling them. Every figure carries a named source and the time it was read; anything unverified goes in gaps rather than being softened or omitted. NEVER drop a caveat to make the writing flow — a briefing that reads well because it hid what it could not check is worse than a clumsy honest one.' || char(10) || char(10) ||
         'Write delivers.json in the current working directory, rewriting it as you go rather than at the end:' || char(10) ||
         '  status      "complete" or "partial". Use "partial" whenever anything is unverified.' || char(10) ||
         '  headline    ONE line, twelve words at most, no figures. The single thing that changed. If nothing did: "Nothing moved that changes your week."' || char(10) ||
         '  summary     Two or three SHORT sentences. What it means for her, not what happened in the world.' || char(10) ||
         '  sections    [{ heading, so_what, bullets }] — FOUR AT MOST. This is a hard cap, not a target: her screen shows the first four and folds the rest away behind a click, so a fifth section is research she paid for that she will not read. A run on 8 September filed fourteen; that is fourteen sections of work for four sections of value.' || char(10) ||
         '                heading  three or four words' || char(10) ||
         '                so_what  one sentence: what she should do or watch because of this' || char(10) ||
         '                bullets  up to four strings, each one short sentence with **the key phrase bolded**' || char(10) ||
         '  sources     [{ name, url, read_at }] — read_at is an ISO timestamp of when YOU opened it.' || char(10) ||
         '  gaps        [{ wanted, why }] — never omit a gap to look complete.' || char(10) ||
         '  corrections [{ was, now, why }] — where today contradicts a previous report.' || char(10) || char(10) ||
         'A short honest brief beats a long one, every single time.'
       )
 WHERE id = 'duty_exec_intel';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0205_boss_briefing_for_human_eyes');
