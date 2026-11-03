import { isIntakeKind } from "../../../shared/boss/governance";

/**
 * THE LINK BETWEEN TWO VOCABULARIES THAT WERE WRITTEN SEPARATELY.
 *
 * `INTAKE_KINDS` in shared/boss/governance.ts classifies WHAT WAS ASKED FOR —
 * drafting, research, coaching, decision_support. `execution_backends.allowed_kinds`
 * in migration 0173 classifies WHAT KIND OF WORK a backend may be handed —
 * document, research, classify, summarise, repo_work. They are different lists
 * and neither is wrong, but nothing joined them, and two components each keeping
 * their own list with no link between them is the defect this repository names
 * explicitly. This table is the link, in one place, so the join can be read and
 * changed rather than being re-derived differently at each call site.
 *
 * AN UNMAPPED KIND REFUSES. There is no default: a task kind nobody has decided
 * about is an absent input, and the guard's `task_kind_absent` refusal says so.
 * Adding a kind here is a deliberate act with a diff behind it.
 *
 * MOVED HERE FROM `router/backends.ts` (3 Nov 2026), beside the guard that consumes it
 * (`backends/dispatch.ts`, `backends/guard.ts`). `router/backends.ts` re-exports both names
 * unchanged, so `router/index.ts` and `router/bench.ts` keep importing from there — that file is
 * deliberately only the wire (five provider adapters), and the join is not wiring.
 */
export const INTAKE_KIND_TO_BACKEND_KIND: Record<string, string> = {
  one_off: "document",
  recurring_duty: "document",
  scheduled_check: "classify",
  triggered_workflow: "document",
  approval_request: "document",
  research: "research",
  drafting: "document",
  coaching: "document",
  memory_promotion: "classify",
  relationship: "document",
  decision_support: "research",
  repository: "repo_work",
  model_benchmark: "summarise",
  trading: "research",
  west_peek_bridge: "document",
  new_agent_proposal: "document",
  /*
   * ─── THE FIRM SCAN'S CALLS, NAMED FOR WHAT THE MODEL IS ACTUALLY ASKED TO DO ───
   *
   * "Find firms that did X" (research/firmScan.ts) is a `research` TASK, and Workers AI is rightly
   * not allowed research — a model that cannot open a page must not be asked to recall one. But
   * the scan does not ask it to: the Worker fetches the news itself and hands the model the text.
   * What the model does is write three search queries (a classification-sized job) and extract
   * named firms with a verbatim sentence from text it was given (a summarise-sized job), and each
   * finding is then checked against the page by code. Those calls carry these kinds, so the
   * routing record says what happened and the free non-training rung may take them.
   */
  search_queries: "classify",
  extract_from_fetched_text: "summarise",
};

export function backendKindFor(intakeKind: string | null | undefined): string | null {
  if (!intakeKind) return null;
  return INTAKE_KIND_TO_BACKEND_KIND[intakeKind] ?? null;
}

/**
 * WHAT THE GUARD MUST BE GIVEN, FOR A KIND THAT MAY BE EITHER VOCABULARY.
 *
 * A caller that already names a backend kind (the router's own callers, `firmScan.ts`'s two
 * internal kinds above) passes through unchanged — this function never invents a translation for
 * a word it does not recognise as an intake kind. A caller naming a real `IntakeKind` (the queue
 * consumer, handed `task.intake_kind`) gets it translated, with the original kept alongside so the
 * record still says what was asked for.
 *
 * A recognised `IntakeKind` with NO row in the join (a future kind added to `INTAKE_KINDS` before
 * anyone decided its seat vocabulary) comes back `guardKind: null, unmapped: true` — the caller's
 * job is to refuse by name rather than let `null` read as "no task kind", which is a different,
 * older defect with its own sentence.
 */
export function guardKindFor(kind: string | null | undefined): {
  guardKind: string | null;
  intakeKind: string | null;
  unmapped: boolean;
} {
  if (!kind) return { guardKind: null, intakeKind: null, unmapped: false };
  if (!isIntakeKind(kind)) return { guardKind: kind, intakeKind: null, unmapped: false };
  const mapped = backendKindFor(kind);
  if (!mapped) return { guardKind: null, intakeKind: kind, unmapped: true };
  return { guardKind: mapped, intakeKind: kind, unmapped: false };
}
