import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { apiJson, insertTask, row } from "./helpers";
import { admitTask } from "../../src/worker/boss/tasks/admit";
import { handleTask } from "../../src/worker/boss/queue/consumer";
import { dispatchRunForTask } from "../../src/worker/boss/backends/dispatch";
import { guardKindFor, INTAKE_KIND_TO_BACKEND_KIND } from "../../src/worker/boss/backends/taskKind";
import { INTAKE_KINDS } from "../../src/shared/boss/governance";
// eslint-disable-next-line
import { validateEnvelope } from "../../scripts/sync-agent/runner.mjs";

/**
 * A DISPATCH SPEAKS THE SEAT'S VOCABULARY, NOT THE INTAKE DOOR'S (3 Nov 2026).
 *
 * Her mail of 1 Nov became tsk_m6c2nxx17qyp6qr5, a Chrome job: "in Pinterest, on the A Player Mode
 * account, connect the RSS feed for the faith board". On Monday it failed on arrival:
 * "bk_claude_code: Claude Code is not allowed to take one_off work. Its allowed kinds are
 * repo_work, research, document." `one_off` is the INTAKE door's vocabulary (what was asked for);
 * `repo_work`/`research`/`document` is the SEAT's vocabulary (what a backend may be handed).
 * `backendKindFor` (`router/backends.ts`, now `backends/taskKind.ts`) is the join written for
 * exactly this, and `queue/consumer.ts` handed the guard the raw intake kind without it — the same
 * defect `tasks/admit.ts:235` already patched once, by forcing a research page's kind to
 * `"research"` at the door, which only ever worked because that one word happens to exist in both
 * vocabularies.
 *
 * Every step below runs the shipped intake door, consumer and claim route against the real
 * migrated database, then feeds the envelope the claim route hands out to the REAL
 * `validateEnvelope` the Mac runner uses — the half nobody had checked, and the reason fixing only
 * the cloud guard would have moved this same refusal onto her Mac.
 */

async function forceEnable(id: string) {
  await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled' WHERE id = ?`).bind(id).run();
}
async function forceShut(id: string) {
  await env.DB.prepare(`UPDATE execution_backends SET status = 'registered' WHERE id = ?`).bind(id).run();
}
afterEach(async () => {
  await forceShut("bk_claude_code");
});

describe("a dispatch speaks the seat's vocabulary, not the intake door's (3 Nov 2026)", () => {
  it("her actual Chrome words are not refused: the task runs, dispatched to bk_claude_code on its backend kind, with the intake kind kept on the record", async () => {
    await forceEnable("bk_claude_code");

    const admitted = await admitTask(env as any, {
      title: "One-time Chrome job for tomorrow, Monday 2 Nov, after 9am Central",
      employee_id: "emp_research",
      input: {
        body: "in Pinterest, on the A Player Mode account, connect the RSS feed for the faith board",
      },
    });
    expect(admitted.created).toBe(true);
    expect(admitted.queued).toBe(true);
    // THE DEFECT'S OWN SHAPE: an ordinary Chrome job, with nothing else said, classifies as
    // `one_off` — the exact word her failure quoted. The chrome branch never overrides it (unlike
    // the research page's door, which does, on purpose — see tasks/admit.ts:235).
    expect(admitted.classification.intakeKind).toBe("one_off");

    await handleTask(env as any, { taskId: admitted.task_id!, lane: "ops" });

    const task = await row<any>(`SELECT status FROM tasks WHERE id = ?`, admitted.task_id);
    expect(task?.status, "the task failed on dispatch, the original defect").not.toBe("failed");

    const run = await row<any>(
      `SELECT backend_id, status, requested FROM backend_runs WHERE task_id = ? AND status = 'running'`,
      admitted.task_id,
    );
    expect(run, "no running backend_runs row was parked for the task").not.toBeNull();
    expect(run.backend_id).toBe("bk_claude_code");
    const requested = JSON.parse(run.requested);
    // The guard, and the envelope it feeds, read the SEAT's word — not the door's.
    expect(requested.kind).toBe("document");
    // The door's own word is kept on the record, so it still says what was asked for.
    expect(requested.intake_kind).toBe("one_off");
    expect(requested.browser).toBe("chrome");

    const claimed = await apiJson("/api/backends/claim", {
      method: "POST",
      body: { device_id: "dev_test", backend_id: "bk_claude_code" },
    });
    expect(claimed.status).toBe(200);
    expect(claimed.body.data.run).not.toBeNull();
    const envelope = claimed.body.data.run;
    // intake_kind is on the AUDIT row and the log, not the envelope: the runner's KNOWN_KEYS does
    // not carry it, and the claim route builds the envelope key by key rather than spreading it.
    expect(envelope.intake_kind).toBeUndefined();
    expect(envelope.kind).toBe("document");

    const verdict = validateEnvelope(envelope);
    expect(verdict.ok, verdict.ok ? "" : `refused: ${verdict.reason}`).toBe(true);
  });

  it("every INTAKE_KINDS entry maps to a kind some seat's allowed_kinds actually contains", async () => {
    const seats = await env.DB.prepare(`SELECT allowed_kinds FROM execution_backends`).all<{ allowed_kinds: string }>();
    const everyAllowedKind = new Set<string>();
    for (const r of seats.results ?? []) {
      for (const k of JSON.parse(r.allowed_kinds ?? "[]")) everyAllowedKind.add(k);
    }
    expect(everyAllowedKind.size, "no seat carried any allowed_kinds at all").toBeGreaterThan(0);
    for (const kind of INTAKE_KINDS) {
      const mapped = INTAKE_KIND_TO_BACKEND_KIND[kind];
      expect(mapped, `${kind} has no row in INTAKE_KIND_TO_BACKEND_KIND`).toBeTruthy();
      expect(everyAllowedKind.has(mapped!), `${kind} -> "${mapped}", which no seat's allowed_kinds contains`).toBe(true);
    }
  });

  it("an unmapped kind is the named refusal naming the kind, never task_kind_not_allowed", async () => {
    await forceEnable("bk_claude_code");

    // Simulate a future intake kind added to the door before anyone decided its seat vocabulary —
    // guardKindFor is a pure function, so this is read directly, no mocked database row.
    const direct = guardKindFor("repository");
    expect(direct.guardKind).toBe("repo_work");
    expect(direct.unmapped).toBe(false);

    const saved = INTAKE_KIND_TO_BACKEND_KIND.repository!;
    delete (INTAKE_KIND_TO_BACKEND_KIND as Record<string, string>).repository;
    try {
      const g = guardKindFor("repository");
      expect(g.unmapped).toBe(true);
      expect(g.guardKind).toBeNull();
      expect(g.intakeKind).toBe("repository");

      const taskId = await insertTask({ intake_kind: "repository" });
      const dispatched = await dispatchRunForTask(env as any, {
        taskId, lane: "ops", backendId: "bk_claude_code", title: "A kind nobody has decided",
        prompt: "x", kind: "repository", envelopeId: null,
      });
      expect(dispatched.refused).toBeTruthy();
      expect(dispatched.refused).toContain('intake kind "repository"');
      // NEVER the "is not allowed to take X work" sentence — that reads like the seat refused it,
      // when nobody ever decided what the seat should be handed.
      expect(dispatched.refused).not.toMatch(/is not allowed to take/);

      const recorded = await row<any>(`SELECT refusal_reason FROM backend_runs WHERE id = ?`, dispatched.run_id);
      expect(JSON.parse(recorded.refusal_reason).code).toBe("task_kind_absent");
    } finally {
      INTAKE_KIND_TO_BACKEND_KIND.repository = saved;
    }
  });
});
