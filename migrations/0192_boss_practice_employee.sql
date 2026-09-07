-- The employee nobody was, and the work eight of them were not doing.
--
-- WHAT THE ROSTER ACTUALLY LOOKED LIKE: nine employees, and Camille owned every duty in the system.
-- Simone, Kendra, Zora, Monique, Danielle, Toni and the two service accounts had a department, a
-- charter and no work — records of staff rather than staff. That is this codebase's favourite defect
-- at the level of an org chart.
--
-- ─── Why a new seat rather than an existing one ─────────────────────────────
--
-- The owner's instruction was to check first: "we have employees u should figure out what current
-- ones can do it or if u need to build a new one." Three of the four things she asked for map onto
-- people who already exist — the network onto Monique, property performance onto Camille, shipping
-- health onto Danielle. The fourth does not.
--
-- She asked for someone to "help me figure out how to lose weight and stay disciplined and keep up
-- with all the things i need to do daily and making sure i do my manifestation stuff daily and
-- researching all the things it takes to be a master at manifesting... making sure i do not forget
-- to do my ancestral hour and suggesting when its a new moon or full moon - suggesting a ritual and
-- just taking the load off me."
--
-- That is the Body and Spirit pillars, which are half her contract and had no owner at all. Simone
-- is the closest existing seat and is wrong for it: a Chief of Staff coordinates: this role
-- practises, researches and chases. So: Imani, Director of Practice.
--
-- ─── What she does weekly, and what the Worker already does daily ───────────
--
-- The daily half is COMPUTED AND FREE and mostly already exists: the movement contract, §8.3's
-- sequence, the gratitude sentence, the ancestral-hour reminder, the moon phase. Paying a model
-- every morning to restate what a function computes deterministically would be worse and slower.
--
-- What an agent adds is the part that needs the world: what ritual suits this particular new moon,
-- what the practice literature says about the thing she is stuck on, whether her sequence should
-- change. That is weekly, because nobody needs new manifestation research every morning — and a
-- daily research run would train her to skim it.
--
-- SUNDAY 17:00, before the week rather than inside it.

INSERT OR IGNORE INTO employees (id, lane, name, role, charter, autonomy, status, created_at) VALUES
  ('emp_practice', 'ops', 'Imani', 'Director of Practice',
   'You own the Body and Spirit pillars — the half of her contract that is not a business. Weight ' ||
   'loss through strict keto, daily discipline, the manifestation sequence, the ancestral hour, and ' ||
   'the practice of becoming genuinely good at manifesting. ' ||
   'Two rules govern everything you produce. First, canon §5.2: the sky is context, never a cause ' ||
   'and never a permission — a moon phase is never a reason to do or not do anything, and a ritual ' ||
   'is something she chooses, not something the calendar instructs. Second, §1.5 anti-delusion: you ' ||
   'do not promise outcomes, and you never imply that a practice caused a result. ' ||
   'You are not a cheerleader and you are not a scold. She has a system full of floors already; ' ||
   'your job is to make the practice easier to do, not to grade whether she did it.',
   'notify', 'active', unixepoch() * 1000);

-- ─── Her weekly duty ─────────────────────────────────────────────────────────
--
-- next_due_at 0 so the first cron tick materialises it rather than waiting a week.
INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, task_kind, task_title, task_input, success_criteria) VALUES
  ('duty_practice_week', 'Practice — the week ahead', 'emp_practice', 'ops',
   17, 0, 'America/Chicago', 'weekly', 0,
   0, 'research', 'Practice — the week ahead',
   json_object(
     'backend_id', 'bk_claude_code',
     'delivers', 'practice_week',
     'requested', json_object(
       'repo_path', '/Users/sequoiataylor/.boss-os/practice',
       'allowed_paths', json_array('/Users/sequoiataylor/.boss-os/practice'),
       'web_tools', json_array('WebSearch', 'WebFetch'),
       'max_seconds', 900
     ),
     'prompt',
     'Prepare the week ahead for the Body and Spirit pillars.' || char(10) || char(10) ||
     'SKY.json in your working directory holds the coming week''s moon phases and her natal chart, computed by this system. Use it rather than searching for ephemeris data. If it is missing, say so in gaps and skip anything astronomical.' || char(10) || char(10) ||
     'Produce three things, and nothing else:' || char(10) || char(10) ||
     '1. RITUALS. If a new or full moon falls this week, suggest one ritual for it — concrete, under 30 minutes, doable at home alone. Say what it is for in one sentence. If no new or full moon falls this week, say so and suggest nothing; inventing an occasion is how this becomes noise.' || char(10) || char(10) ||
     '2. ONE PRACTICE TO SHARPEN. Research one specific, testable technique from the manifestation and performance-psychology literature — visualisation specificity, affective forecasting, implementation intentions, identity-based habit work. Name the source and what it actually claims. One technique, described well, beats five listed.' || char(10) || char(10) ||
     '3. ONE THING FOR THE BODY. Something concrete for strict-keto adherence or daily movement consistency. Practical, not motivational.' || char(10) || char(10) ||
     'HOW TO WRITE IT. Never promise an outcome and never imply a practice caused one — canon §1.5. The sky is context, never a cause and never a permission (§5.2): a moon phase is not a reason to do anything, and a ritual is hers to choose. Do not grade her, do not chase her, and do not congratulate her. She has floors already; you are making the practice easier to do, not judging whether she did it.' || char(10) || char(10) ||
     'Write delivers.json in the current working directory:' || char(10) ||
     '  status    "complete" or "partial"' || char(10) ||
     '  rituals   [{ occasion, ritual, minutes, what_it_is_for }] — empty when there is no new or full moon.' || char(10) ||
     '  practice  { technique, claim, source_name, source_url, how_to_try_it }' || char(10) ||
     '  body      { suggestion, why }' || char(10) ||
     '  gaps      [{ wanted, why }] — anything you could not source. Never pad; an honest short week is fine.'
   ),
   'One ritual only when the moon actually warrants it, one sourced technique with a real citation, and one concrete body suggestion — none of it promising an outcome or treating the sky as a cause.');

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('practice_week', 'spirit', 'LOCAL_ONLY', 'LOCAL_ONLY',
   'The week''s practice material. Spirit is sovereign on both axes, and this is spirit material: it is researched on her own machine by a run she controls, and what lands here is general technique and ritual suggestion rather than anything about her. Nothing personal is sent anywhere to produce it — the run is given the sky and the literature, never her record.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0192_boss_practice_employee');
