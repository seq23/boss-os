-- A day is allowed to change, and the change has to be visible.
--
-- HER REQUIREMENT, IN HER WORDS: the system "needs to take my inputs and decide my priorities each
-- day and allow me to make last min or emergency adjustments or inputs if something comes up."
--
-- The first half is now real — the Morning Gate derives the day from her projects instead of asking
-- her to type three priorities into blank fields at 6am. This column is the second half.
--
-- WHY NOT `midday_adjustments`, WHICH ALREADY EXISTS. That belongs to the Midday Reset gate: it
-- records what that gate decided, at that gate, once. An emergency does not wait for a gate. A
-- column tied to a ritual cannot hold an event that happens at 3pm on a Thursday, and overloading
-- it would mean the Midday Reset's own record stopped meaning what it says.
--
-- WHY NOT JUST RE-RUN THE MORNING GATE. It would recompute the whole day and overwrite the
-- contract, which destroys the two things the record exists for. The morning contract is what the
-- Night Gate scores against — a day that rewrites its contract at 3pm always meets it, and the
-- verdict becomes meaningless. And it would erase that the day changed at all, when a week with
-- three hijacked days is a pattern she should be able to SEE rather than three days that each look
-- fine in isolation.
--
-- So adjustments are APPENDED and the original contract stands. Both are true: this is what the day
-- was for, and this is what happened to it.
--
-- AN INTERRUPTED DAY IS NOT A FAILED DAY. Core Law 3 closes yesterday and moves forward; §17.2's
-- Recovery Mode exists because bad days are expected rather than exceptional. A system that scored
-- an interrupted day as broken would teach her to stop telling it the truth, and every other number
-- in here is worthless the moment that happens.

ALTER TABLE days ADD COLUMN adjustments TEXT; -- json: [{ id, kind, what, instead_of, at }]

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0184_boss_day_adjustments');
