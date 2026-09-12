# Promotion card — `mdl_cf_llama33_70b`, `max_risk` low → medium

**Kind:** `model_promotion` · **Risk:** high · **Status:** approved
**Approval id:** `apr_promo_70b_medium` · **Decided by:** the owner, 12 September 2026
**Raised because:** `tsk_m2bk7zfffhjatvsf` failed at the capability stage with nothing behind it to
take the work.

---

## The wall this moves, stated exactly

Task `tsk_m2bk7zfffhjatvsf` — the owner's re-admitted instruction about the spirit page and the daily
briefing — was classified `drafting` / risk `medium` / sensitivity `private`, was requeued four
times, and failed four times. Routing decision `rtd_m2bkhwdyzg4736hx`:

| Model | Backend | Stage | Reason |
|---|---|---|---|
| `mdl_kimi_k2` | `bk_fireworks` | availability | Fireworks is registered, not enabled |
| `mdl_qwen_fast` | `bk_fireworks` | capability | model is cleared to low risk, task is medium |
| `mdl_cf_llama33_70b` | `bk_workers_ai` | capability | model is cleared to low risk, task is medium |
| `mdl_cf_llama31_8b` | `bk_workers_ai` | capability | model is cleared to low risk, task is medium |

Every model the router could actually reach carried `max_risk = 'low'`. **Any task classified
`medium` or above had no model permitted to take it and failed before it started.** Not a bug in the
router — the router was correct. A ceiling with nothing evidenced behind it.

## The governing text this follows

`src/worker/boss/router/index.ts`, both at the refusal and in `theWall()`:

> **IT WIDENS NOTHING. Raising a model's risk clearance is a PROMOTION, and §3.1 requires benchmark
> evidence and an approved card — not a quiet UPDATE by whoever hit the wall first.** So this states
> the wall and names the decision that would move it; the decision stays the owner's.

`src/worker/boss/routes/models.ts`:

> Evidence AND a card. … Either alone is not enough: evidence without approval is an implementation
> deciding what she runs on, and approval without evidence is a decision made on nothing.

`src/worker/boss/router/bench.ts`:

> QUALITY IS NOT MEASURED BY THIS HARNESS AND IS NOT INVENTED BY IT. … A model becomes a default only
> through an operator-scored `approved` verdict and an approved promotion card.

So: real calls, an operator score, a card. Both halves, in that order.

## The evidence

`ARTIFACTS/benchmarks/2026-09-12-llama33-70b-risk-clearance.md` (readable) and `.json` (every
character of every answer). Produced by `scripts/bench/risk-clearance-bench.mjs` — **14 real calls to
real models, 0 failed, $0**, through a `wrangler dev` Worker carrying the same `[ai] binding = "AI"`
the deployed Worker uses, on the same account and the same included allowance.

Seven probes, each shaped like work this system actually sends — the employee charter as the system
message, the same instruction form, the same output contract. Public and synthetic by construction:
**no owner record, counterparty, holding, name or figure from the database appears in any prompt.**
`mdl_cf_llama31_8b`, the model that carries every free task today, ran the identical probes, because
"is the 70B good enough" is only answerable against what it replaces.

| | Llama 3.3 70B | Llama 3.1 8B |
|---|---|---|
| Mechanical checks passed | **29 / 29** | 24 / 29 |
| Median latency | 1,916 ms | 3,432 ms |
| Slowest probe | 19,767 ms (`wl_repo`) | 23,501 ms (`wl_repo`) |
| Cost | **$0** | $0 |

### The comparison that decided it

On the capital-lane extraction probe, the 8B **invented a settlement date it was never given** —
asked to write `NOT STATED` for an absent field, it wrote `SETTLEMENT DATE: before the next 409a`.
The 70B wrote `NOT STATED`. That is a fabricated term on the lane that moves money, from the model
currently carrying that lane's free work.

On the memory probe the 8B stored `"The weekly review is now held on Thursdays."` — dropping both
the reason and the expiry, writing a temporary arrangement into durable memory as if permanent. The
70B kept all three parts.

On the refusal probe the 8B refused but never said what it would need. The 70B named it.

## What this card clears it for

**`max_risk = 'medium'`, and `benchmark_status = 'benchmarked'`** (six approved verdicts across six
distinct `workload_profiles`, against the five `LOCAL_DEFAULT_MIN_BENCHMARKS` asks).

## What this card does NOT clear it for, and the weaknesses behind that

**Not `high`.** Nothing here was tested at high risk and nothing here argues for it. High risk stays
where it is.

**Not a route default.** `rt_ops_default` and `rt_trading_default` are unchanged. Becoming a primary
needs its own card naming the route, per `PATCH /api/models/routes/:id`. Left deliberately: a route
model that answers reports as `fallback`, a continuity model reports as `degraded` and carries the
"DEGRADED TIER" label onto every screen. That label is how she knows a free model wrote it, and this
promotion does not buy visibility by removing it.

**Not repository work.** `wl_repo` is recorded `needs_review`, NOT approved. The 70B passed the
mechanical checks and the answer is still poor: it answered a TypeScript repository in Java and C#,
its third "breaking pattern" restates its first, its "silently keeps working" case is reasoned
wrongly, and it took **19.8 seconds** — ten times its own median. Repository work belongs on
`bk_claude_code`, and this is evidence for that rather than against it.

**Four more honest weaknesses the mechanical rubric passed and a reader should not:**

1. **Vague first actions.** Asked for "one concrete next step", the routing probe produced "Review
   existing relationships for leads." Correct seat, correct reasoning, an action that does not tell
   anyone what to do on Monday.
2. **Dropped a constraint.** The capital probe's line carried two constraints — a 30-day ROFR and
   "before the next 409a". The 70B recorded the ROFR and silently dropped the 409a. It invented
   nothing, which is the failure that matters, but it did not carry everything either.
3. **Restated the question as an answer.** In the decision probe, one of its three "facts that
   decide it" was the bid price, which the prompt had already supplied. Two real facts, not three.
4. **Latency is not stable.** 1.0s to 19.8s across seven probes on the same model. Anything with a
   timeout tighter than ~25 seconds should not assume this model is fast.

**And one thing the evidence cannot tell her.** Cloudflare served every call from
`@cf/meta/llama-3.3-70b-instruct-sd`, not the `-fp8-fast` build named in the model row. The slug is
an alias and the account routes it. What was benchmarked is what the router will get, because both
go through the same alias — but the stored slug is not literally the build that answered, and that
is recorded rather than smoothed over.

## What it costs

**$0.** `in_micros_1k` and `out_micros_1k` are both 0 — Cloudflare's included Workers AI allowance.
`bk_fireworks` stays registered and disabled. No paid backend was enabled, needed, or touched, and
`validate:free-brain` still fails the build if one is.

## One thing this card also fixes, which nobody asked for

`mdl_kimi_k2` has carried `max_risk = 'medium'` since migration 0155, **with no benchmark and no
card** — a clearance granted by a seed. It is on the disabled paid backend so it has never used it,
which is the only reason it never mattered. Under the rule this card is written to honour, it is not
a clearance at all. It goes back to `low` in the same migration. If the owner enables Fireworks and
wants it at medium, that is a benchmark and a card, like everything else.

## The guard

`scripts/validate/a-risk-clearance-has-evidence.mjs`, registered as `validate:risk-clearance` and
wired into `npm run validate`. It replays every shipped migration and requires that **any** model
above `low` has approved benchmark rows across distinct workloads AND an approved `model_promotion`
card naming it and the clearance. It hard-fails when it examines zero models.
