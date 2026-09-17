-- THE TASK-KIND RULES EXIST AND GOVERN NOTHING.
--
-- `models.approved_task_kinds` and `models.forbidden_task_kinds` have been NULL on every row since
-- the schema was written. `evaluateModel` in `router/policy.ts` reads both and enforces both —
-- correctly, at the capability stage, with a recorded reason — and it has never once had anything
-- to enforce. Machinery that runs and governs nothing is the "runs but inert" defect, and it is
-- worse than an absence because the code reads as though the rule is in force.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE PRECEDENT, FROM NEXT DOOR, WHICH IS WHY THIS MATTERS MORE THAN IT LOOKS.
--
-- A judge was routed to a search model because it was the cheapest eligible candidate, and it
-- refused its own answer three times. The fix was not a retry and not an if-statement afterwards:
-- it was to STATE THE REQUIREMENT TO THE ROUTER BEFORE THE RUN. This migration is that, for this
-- repository. A model that cannot do a kind of work must be ineligible for it at the screening
-- stage, not discovered to be wrong once it has answered.
--
-- The same thing already happened here. `backends.ts` records it: "A verified turn on 9 September
-- was answered by Llama 3.1 8B on Workers AI — free, working, and exactly the wrong instrument for
-- the job", against the owner's standing instruction that "for coaching it is imperative that i use
-- the best models with the best thinking brains and the most integrity". That decision was made,
-- written down in a comment, and never encoded anywhere a router could read. It is encoded now.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- TWO DIFFERENT SHAPES, AND THE DIFFERENCE IS DELIBERATE.
--
-- `evaluateModel` treats the two columns differently and the difference is the whole design:
--
--   forbidden_task_kinds  a denylist. Everything not named is allowed.
--   approved_task_kinds   an ALLOWLIST, and only when non-empty. Everything not named is refused.
--
-- FAST MODELS GET AN ALLOWLIST. "A cheap model takes only the jobs it can do" is exactly an
-- allowlist, and the fail-closed direction is the right one here: an intake kind invented next year
-- is refused by an 8B model until somebody decides it belongs there.
--
-- GENERAL MODELS GET A DENYLIST. If every model carried an allowlist, a new intake kind would route
-- NOWHERE — the whole system would refuse work on the day somebody added a word, which is a
-- different failure and not a safer one. So the capable tier stays open by default and names what
-- it may not touch. One list per model, never both: two lists on one row is the defect this
-- repository names, and it would eventually be two lists that disagree.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT COUNTS AS JUDGEMENT WORK, AND WHY EACH ONE.
--
--   coaching            her interior life, and the quality of the reasoning IS the product
--   decision_support    a recommendation she will act on
--   trading             money, and the lane is isolated by design
--   approval_request    the thing that asks her to approve something
--   new_agent_proposal  a proposal to change the shape of her workforce
--   relationship        LP and counterparty work — the material the confidential line protects
--   west_peek_bridge    crosses into the other business, where a wrong answer is hers to explain
--
-- AND WHAT COUNTS AS MECHANICAL: a scheduled check, a memory promotion, a benchmark, a triggered
-- workflow, a recurring duty, a one-off, a draft. Work where the shape of the answer is known
-- before it runs and a cheap model doing it is simply correct.
--
-- `research` IS NOT ON THE CHEAP LIST, and that is the 9 September lesson again. Research reads
-- sources and decides what is true; an 8B model doing it produces something that looks like
-- research, which is worse than an empty answer because it gets believed.
--
-- COACHING IS FORBIDDEN ON EVERY MODEL IN THIS DATABASE, including the benchmarked 70B. That is not
-- an omission: `backends.ts` routes coaching DIRECTLY to a frontier backend for that reason, and
-- neither frontier model has a row here (both providers are disabled and neither was provisioned).
-- So coaching correctly has nowhere to run today and says so, rather than quietly landing on the
-- cheapest thing with a pulse — which is precisely what happened on 9 September.
--
-- Plan: docs/boss/PLAN_v21.md Stage 4. Canon: Sovereignty Addendum §3.1, stage 2 (required
-- capability), which is the stage these columns are read at.

-- ── The fast tier: an allowlist of mechanical work ───────────────────────────
--
-- `mdl_cf_llama31_8b` (Workers AI, free), `mdl_qwen_fast` (Fireworks, disabled for want of a key),
-- `mdl_or_gemma3_free` (OpenRouter, free). Same list, because the constraint is the tier and not
-- the vendor.

UPDATE models SET
  approved_task_kinds =
    '["one_off","recurring_duty","scheduled_check","triggered_workflow","memory_promotion","model_benchmark","drafting"]',
  forbidden_task_kinds = NULL
WHERE capability_tier = 'fast';

-- ── The general tier: open, minus the work that needs a better brain ─────────

UPDATE models SET
  approved_task_kinds  = NULL,
  forbidden_task_kinds = '["coaching"]'
WHERE id IN ('mdl_cf_llama33_70b', 'mdl_kimi_k2');

-- OpenRouter's general model carries more than coaching, and the extra entries are the same fact
-- the confidential line enforces from the other direction. 0249 records this provider as
-- TRAINS_ON_PROMPTS, so the router already refuses it LP names and deal terms found in the content.
-- This refuses it the KINDS OF WORK that are about LPs and counterparties whether or not a name
-- happens to appear in the prompt — a relationship task with no name in it is still relationship
-- work, and the two guards catch different halves of the same problem.
UPDATE models SET
  approved_task_kinds  = NULL,
  forbidden_task_kinds = '["coaching","decision_support","trading","relationship","west_peek_bridge","approval_request","new_agent_proposal"]'
WHERE id = 'mdl_or_llama33_free';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0251_boss_a_cheap_model_takes_only_the_jobs_it_can_do');
