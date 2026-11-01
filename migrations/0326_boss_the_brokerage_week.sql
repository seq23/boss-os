-- THE BROKERAGE WEEK (owner, 1 Nov 2026). Additive: names, times and one new duty; no row removed,
-- no run history touched.
--
--   1. Prospect emails go on WEEKDAYS only (Central). A follow-up due at the weekend goes Monday.
--      The sequence is the first email and ONE follow-up (MAX_TOUCHES = 2, plan.mjs); the duty's
--      name and task said "two follow-ups" / "3 touches ever", which was stale.
--   2. Tuesday is ONE email, "Buyers for what you're selling", at 07:00: Monique's people-in-your-mail
--      half and Danielle's funds-that-hold-it half. Both computations still run, each on its own
--      duty row so either can go red alone; only the output merged (buyer-hunt.mjs --email).
--      Danielle's half moves from 06:50 to 07:00, where its launchd job already ran it.
--   3. NEW Thursday 07:00: "Sellers for what your LPs want to buy" — the mirror for her buy orders.
--      Monique's. seller-hunt.mjs, launchd com.seq.boss-capital-sellers.

UPDATE standing_duties
   SET name = 'Prospects: the approved note and its one follow-up, weekdays only, under the brakes',
       weekdays = json_array(1, 2, 3, 4, 5),
       task_input = json_set(task_input, '$.sends',
         'prospect emails from the West Peek mailbox only with an approved template, at most 20 new a day, Monday to Friday Central only, 2 touches ever: the first email and one follow-up')
 WHERE id = 'duty_prospects';

UPDATE standing_duties
   SET name = 'Buyers for what you''re selling: one Tuesday email, people in your mail and funds that hold it',
       task_title = 'Buyers for what you''re selling: one Tuesday email, people in your mail and funds that hold it'
 WHERE id = 'duty_buyer_hunt';

UPDATE standing_duties
   SET name = 'Buyers for what you''re selling: the funds that hold it (the second section of the Tuesday email)',
       task_title = 'Buyers for what you''re selling: the funds that hold it (the second section of the Tuesday email)',
       local_hour = 7, local_minute = 0
 WHERE id = 'duty_filing_research';

INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended) VALUES
  ('duty_seller_hunt',
   'Sellers for what your LPs want to buy: one Thursday email, people in your mail and funds that hold it',
   'emp_relationship', 'ops',
   7, 0, 'America/Chicago', 'weekly', 4,
   unixepoch() * 1000 + 86400000,
   'local_job', 'ops',
   'Sellers for what your LPs want to buy: one Thursday email, people in your mail and funds that hold it',
   json_object(
     'local_job', 'seller-hunt.mjs',
     'why_local', 'Her inbox records live on her Mac (~/.boss-os/capital), and the public SEC fund filings are read under SEC fair-access limits from there. Neither exists inside a Worker.',
     'never', 'Contacts nobody, calls no model and no paid service. LP names and deal terms never leave her Mac except in the one email to her, from Monique, never from spry.vc.',
     'sends', 'one email to her on Thursday: Sellers for what your LPs want to buy'
   ),
   'Every buy order of hers from the last ~6 months is hunted, newest first. Each person listed said in her own mail that they hold or can source the company, with their size against hers (overlap, never equality: a $100M seller fills a $15M buy) and a price within the deal grid tolerance or marked worth asking. Each fund listed has a public filing link. A section whose source failed says so in the email and the run goes red. Nothing is a Decide item.',
   0);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0326_boss_the_brokerage_week');
