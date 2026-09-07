-- A timeout must degrade to partial, never to nothing.
--
-- WHAT THE FIRST SOURCING RUN DID: worked for the full 900 seconds, got killed by the hard timeout,
-- and produced nothing at all. `error: stdout was not JSON`, `The run was killed after 900s`, an
-- empty workspace, zero candidates, zero gaps, $0 recorded. Fifteen minutes of real research
-- thrown away because the instruction told it to write its output at the END.
--
-- THAT IS THE INSTRUCTION'S FAULT, NOT THE TIMEOUT'S. The hard kill is correct and stays — an
-- unattended run that hangs holds the single work slot for ever and looks identical to one that is
-- thinking. What was wrong is that the whole deliverable was staked on reaching the last line.
--
-- Web research is exactly the shape where this bites: every candidate costs several fetches, some
-- of them slow, and the run cannot know in advance how many it will get through. So it now writes
-- `delivers.json` after EACH verified candidate. A kill at minute 14 leaves thirteen minutes of
-- verified names on disk instead of an empty directory, and the adapter reads the file the same way
-- either way — it does not care whether the process exited cleanly, only whether the file is there.
--
-- The Executive Intelligence Report does not need this: it composes one document and finished in
-- about ten minutes twice. Sourcing is a loop over an unknown number of slow lookups, which is a
-- different risk, so only this duty changes.
--
-- The ceiling also goes to 1800s. Not as the fix — the incremental write is the fix — but because
-- fifteen minutes was simply too short for the work, and 06:45 leaves room before the 07:10 slot.

UPDATE standing_duties
   SET task_input = json_set(
         COALESCE(task_input, '{}'),
         '$.requested.max_seconds', 1800,
         '$.prompt',
         'Find buyers for private, late-stage technology secondaries.' || char(10) || char(10) ||
         'The mandate: institutions that buy private tech secondaries at $5M+ per position, and $20M+ is strongly preferred. Family offices, secondaries funds, crossover funds, sovereign and pension allocators with a direct-secondaries programme. Skip anyone whose stated minimum is below $5M.' || char(10) || char(10) ||
         'WRITE delivers.json AFTER EVERY CANDIDATE YOU VERIFY — not at the end. Rewrite the whole file each time with everything you have so far. You are on a hard timeout and will be killed without warning; if that happens, whatever is in the file is what she gets. A run that verified nine names and wrote nothing delivered nothing. Do not batch the write.' || char(10) || char(10) ||
         'Use WebSearch and WebFetch and OPEN the pages you cite. For each candidate you must be able to point at a source that actually says they buy secondaries — a fund page, a mandate, a filing, a named transaction, an interview. A plausible-sounding firm with no source is worse than nothing here, because it costs her a phone call to find out.' || char(10) || char(10) ||
         'delivers.json is a single JSON object:' || char(10) ||
         '  candidates  [{ name, kind, ticket_floor_usd, thesis, source_url, source_name, read_at }]' || char(10) ||
         '              thesis is one sentence on why they plausibly buy what she sells. read_at is an ISO timestamp of when YOU opened the source.' || char(10) ||
         '  gaps        [{ wanted, why }] — anything you could not verify. Never drop a candidate silently; say why it did not make the list.' || char(10) ||
         '  notes       Anything she should know about how the search went.' || char(10) || char(10) ||
         'Ten well-sourced names beat fifty guesses. If you can only verify three, deliver three and say so in gaps.' || char(10) || char(10) ||
         'EMAIL STEPS — DO NOT ATTEMPT THESE. She has asked for two more things from this agent: finding contacts in her brokerage inbox she has not spoken to in a while, and spotting clients who might want to buy something she has discussed recently. Both need her brokerage email, which is not connected to this run. Do not go looking for it, do not read any mailbox, and do not guess at contacts. Record in gaps that the email half did not run and why.'
       )
 WHERE id = 'duty_brokerage_sourcing';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0186_boss_sourcing_writes_as_it_goes');
