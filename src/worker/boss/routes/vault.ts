import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { newId, sha256Hex } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { ok, badRequest, notFound, conflict, AppError } from "../lib/http";
import { CHURN_TABLES, SNAPSHOT_KEEP } from "../cron/cadence";

export const vault = new Hono<{ Bindings: Env; Variables: Vars }>();

/**
 * Snapshot coverage.
 *
 * Order matters on restore: parents before children, so foreign keys resolve.
 * A table missing from this list is a table that does not survive a rebuild, so
 * every table added by a migration belongs here.
 */
const SNAPSHOT_TABLES = [
  // The employee work queue. On Cloudflare Queues this lived outside the database and outside the
  // snapshot; as a table it is state like any other, and work accepted but not yet run must
  // survive a rebuild rather than be silently dropped by the restore that was meant to save it.
  "boss_task_queue",
  // The airlock's classification registry. A restore that brought the records back without the
  // policy that governs them would rebuild the system with its residency rules erased - every
  // entity unclassified, which the guard refuses, so the restored system would be inert rather
  // than leaky. Either way the vault must carry the rules alongside what they protect.
  "data_policy", "record_policy", "policy_change_log",
  // The sync substrate. record_version is the load-bearing one: restore the records without the
  // versions they were at and every subsequent mutation from every device conflicts at once, so a
  // vault that saved the data would have destroyed the ability to sync it.
  "sync_device", "record_version", "sync_ledger", "sync_cursor", "sync_conflict",
  "lanes", "settings",
  "providers", "models", "routes", "budgets",
  "workload_profiles", "model_benchmarks",
  "agent_need_assessments", "agent_proposals",
  "employees", "task_templates",
  "approvals", "approval_events",
  "tasks", "task_events", "permission_envelopes", "evidence_packets",
  "employee_reviews",
  "usage_ledger", "routing_decisions",
  "memory_items", "promotion_rules", "promotion_events",
  "vault_entries",
  "days", "day_flow_blocks", "open_loops", "gate_entries",
  "organizations", "people", "relationships",
  "meetings", "meeting_briefs", "meeting_captures", "follow_ups",
  "entities", "portfolio_vehicles", "wealth_tracks", "theses",
  "deals", "lps", "opportunities",
  "decisions", "predictions", "red_team_reviews", "calibrations", "capital_allocations",
  "knowledge_surfaces", "knowledge_items", "manual_versions",
  "knowledge_retirements", "knowledge_exports",
  "mastery_lenses", "pov_cards", "prompt_packets", "prompt_scores",
  "prompt_library", "prompt_traces",
  "capabilities", "active_defaults", "bench_candidates", "discovery_inbox",
  "after_action_reviews", "capability_patches",
  "decision_rights", "emotional_states", "compliance_flags", "failure_playbooks",
  "maintenance_items", "ip_assets", "brand_profiles", "learning_entries",
  "runtime_jobs", "document_artifacts", "seo_audits", "geo_probes",
  "bridge_handoffs",
  // Where work may run, and what each run did. The registry is load-bearing on restore: bring the
  // records back without it and the system rebuilds with no idea which backends were permitted,
  // which the guard refuses - inert rather than leaky, but still not restored.
  "execution_backends", "backend_runs",
  // Recurring work and what it produced. A restore that brought the reports back without the duty
  // that generates them would leave a system that has yesterday's intelligence and no way to get
  // tomorrow's - and one that restored the duty without its next_due_at would fire it immediately.
  "standing_duties", "executive_reports",
  // 0204 — what Monique found in the mailbox. Irreplaceable in a way almost nothing else here is:
  // a finding is the product of reading months of mail on her Mac, and a restore that lost them
  // would need another full sweep to get them back. The `status` column is the valuable half —
  // which findings she has already acted on or dismissed — and nothing outside this table records
  // that. The rows themselves hold code names and composed prose, never a subject or an address.
  "mailbox_findings",
  // 0185 — the brokerage sourcing list. A restore that lost it would put her back to an empty
  // funnel with no record of which firms had already been reviewed or rejected, so the next sweep
  // would hand her names she has already decided against. The review status is the valuable part.
  "sourcing_candidates",
  // 0189 — things to raise with a standing counterpart. Losing these in a restore loses the half
  // that was never derivable: items said in passing that exist nowhere else, including the access
  // grant that unblocks reading LP replies. Everything else in the packet recomputes from records;
  // this does not.
  "meeting_agenda_items",
  // 0210 — the packets as she read them. NOT RE-DERIVABLE, and that is the whole reason they are
  // stored rather than recomputed: each one was assembled on her Mac from the outreach sheets, which
  // the Worker cannot see, so a rebuild would produce a thinner document than the one she took into
  // the meeting. What she read on the 9th has to still say the same thing on the 16th.
  "meeting_packets",
  // 0213 — the diary. NOT RE-DERIVABLE AND NOT BACKED BY ANYTHING: her forward schedule is not in
  // Google — three connected feeds hold 5,362 events between them and one dated today or later —
  // so what she typed exists here and nowhere else. Losing it loses her calendar.
  "diary_entries",
  // 0212 — what came back from LP outreach, by category. The counts are cheap to lose and the
  // HISTORY is not: "how many opt-outs since the raise started" is a question only a series can
  // answer, and the mail it was derived from is deleted from nowhere but also readable only from
  // her Mac. Holds no name and no address by construction.
  "lp_reply_digests",
  // 0193 — Monique's backlink prospects. The review status is the valuable part: a restore that lost
  // it would hand her back pages she had already rejected, which is how a working list becomes one
  // she stops trusting.
  "link_prospects",
  // 0194 — Kendra's tool suggestions. The status is the value: a restore that lost it would re-suggest
  // things she has already rejected, and paying for a tool twice is the failure this list prevents.
  "tool_suggestions",
  // 0202 — the register of owned work. THE MOST IMPORTANT ADDITION TO THIS LIST IN A WHILE: these
  // rows are the commitments she has personally handed people, and a restore that lost them would
  // silently drop every one of them — which is the precise thing the mechanism exists to make
  // impossible. `blocked_since` is not re-derivable either; losing it resets a two-week escalation
  // to a first-day one.
  "owned_deliverables",
  // 0216 — which alerts she has put aside, why, and until when. Losing these in a restore would
  // resurrect everything she deliberately snoozed, all at once, with no reasons attached — and the
  // reason is the whole value: it is what lets next week's alert say "you put this aside on the 9th
  // because X" instead of arriving as though it were new.
  "alert_dismissals",
  // 0201 — the publishing block Simone owns. The title states are the part no re-run reproduces:
  // "which of these seven are still stuck" is a fact about Amazon's records, and a restore that
  // lost it would send her back to checking ten books by hand. The determinations are the case's
  // whole history — how long support has been silent and how many nudges have gone unanswered —
  // and the chase ladder is unusable without them.
  "kdp_titles", "kdp_case_checks",
  // 0215 — everything Amazon sent and what Simone decided about it. The `update` rows are the
  // valuable half: "notate them" was her word, and the point of a notation is reading it back in
  // three months. The promo rows are cheap to lose and kept because a count is how she would ever
  // check the triage is working. `work_assignments` is here for the same reason `owned_deliverables`
  // is: a restore that lost them would silently drop work one employee handed another.
  "kdp_mail_log", "work_assignments",
  // 0207 — the credential liveness register. It holds no credential and no secret, which is exactly
  // why it belongs in a backup: what is not re-derivable is the FIX STEPS on each row, written once
  // and read at the worst possible moment. A restore that lost them would leave an alert saying a
  // login is dead and unable to say what to do about it. `last_live_at` is the other irreplaceable
  // part — "this worked as recently as Tuesday" is what separates a password change from a
  // configuration that was never right.
  "credential_probes",
  // 0208 — work put to her for a verdict, and the verdict. NOT RE-DERIVABLE IN EITHER DIRECTION:
  // nothing can reconstruct which covers were shown or what she said about them, and `resumed_at` is
  // the record that her yes actually restarted the work rather than only being filed. The asset rows
  // are pointers into R2 and are useless without their table — losing them would leave the bucket
  // holding seven images nothing can name.
  "judgement_calls", "judgement_assets",
  // 0200 — Imani's week of practice. It is not re-derivable: the run that produced it read the
  // literature and this week's sky, and next Sunday's run answers a different week. A restore that
  // lost these would lose every ritual and technique the practice has ever been given.
  "practice_week",
  // 0198 — the contributed half of the return-on-effort ledger. Everything else in that ledger
  // recomputes from D1 on read; these rows cannot. They come from her LP tracker and Search Console
  // via a job on her Mac, so a restore that lost them would lose every month of history that the
  // cloud has no way to re-derive, and the ledger's whole value is the comparison across months.
  "line_returns",
  // 0199 — the LP × buyer overlaps. Same reason: derived on her Mac from a sheet the Worker cannot
  // read, and carrying her review status, which is the part no re-run reproduces.
  "counterparty_crossmatches",
  // Consent, not content. The coaching conversation itself has no table here and must never get
  // one — its residency is LOCAL_ONLY and this design honours that by not having a row to classify.
  "coaching_consent",
  // 0178 — her Run of Show and the movement novelty history. A restore that lost the movement log
  // would silently reset the rotation, and the day after a restore would repeat the day before it.
  "run_of_show",
  "movement_log",
  "trading_engines", "kill_switch_probes", "deployment_stages", "strategy_desks",
  "promotion_scorecards", "scale_rungs", "trading_sequence", "trading_nevers",
  "sovereignty_packages", "sovereignty_drills",
  "manifestations", "manifestation_evidence", "rituals", "ritual_runs",
  "dream_entries", "contributions", "ancestor_entries",
  "astro_calendar", "astro_days",
  "trading_accounts", "trading_strategies", "trading_signals", "trading_orders",
  "trading_positions", "trading_fills", "trading_authority", "trading_incidents",
  "audit_log", "system_events", "cron_runs", "dead_letters",
] as const;

const SNAPSHOT_VERSION = 2;

/**
 * Ceiling on a single restore transaction. Generous for a single-user system;
 * the point is to refuse loudly rather than silently split a restore into
 * pieces that could leave the database half-loaded.
 */
const MAX_RESTORE_STATEMENTS = 20_000;

/**
 * The document vault — and it is empty by design rather than by accident, which it now says.
 *
 * FOUND BY THE REACHABILITY SCAN, WHICH IS WHY THERE IS NOW A WRITER. `vault_entries` was read here
 * and written by nothing, anywhere, so this returned `[]` from the day the table was created — the
 * same shape as the Executive Intelligence Report: a reader with no writer renders an empty state
 * for ever, and an empty state is indistinguishable from "nothing here yet".
 *
 * `POST /vault/entries` below is the fix, and the response still carries a reason while the vault is
 * empty, because the difference between "nothing stored" and "nothing can be stored" is the whole
 * point and it costs one field to say.
 */
vault.get("/entries", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT id, lane, key, kind, bytes, sha256, note, created_at FROM vault_entries
        ORDER BY created_at DESC LIMIT 100`,
    )
    .all();
  const entries = rows.results ?? [];
  return ok(c, {
    entries,
    total: entries.length,
    ...(entries.length === 0
      ? {
          reason:
            "No canon documents are stored yet. Run `npm run canon:sync` to put the documents in " +
            "docs/boss/ here with a sha256 each — which is what makes \"does the system still match " +
            "what I agreed to\" a diff rather than a memory exercise.",
        }
      : {}),
  });
});

/**
 * Store a canon document, hashed.
 *
 * WHY THIS EXISTS NOW. The reachability scan found `vault_entries` read by an endpoint and written
 * by nothing, so the document vault had returned `[]` since the day it was created. The honest
 * short-term fix was to say so in the response. This is the actual fix.
 *
 * WHAT IT IS FOR, and it is not filing. The contract this entire system implements — her A-Player
 * Mode document, the coaching manual, the sovereignty addendum — governs what every gate, floor and
 * verdict in here does. A sha256 of each is what makes "the system still matches what I agreed to"
 * a question anybody can answer in one command instead of by reading nineteen files.
 *
 * IDEMPOTENT ON CONTENT. Re-storing an unchanged document returns the existing row rather than
 * writing a second copy, so this can run on every deploy. A CHANGED document stores a new row and
 * keeps the old one: the point of a hash chain is that it shows the moment something changed, and
 * overwriting would destroy exactly the evidence worth having.
 */
vault.post("/entries", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const key = b?.key ? String(b.key).trim() : "";
  const content = typeof b?.content === "string" ? b.content : "";
  if (!key || !content) throw badRequest("A vault entry needs { key, content }", "kind defaults to canon_doc.");

  // `sha256Hex` already exists in lib/id and is what the rest of this file hashes with. Two hashing
  // implementations in one module is how two "same" documents end up with different digests.
  const bytes = new TextEncoder().encode(content);
  const sha256 = await sha256Hex(content);

  const existing = await c.env.DB
    .prepare(`SELECT id, sha256, created_at FROM vault_entries WHERE lane = ? AND key = ? ORDER BY created_at DESC LIMIT 1`)
    .bind("ops", key)
    .first<{ id: string; sha256: string; created_at: number }>();

  if (existing?.sha256 === sha256) {
    return ok(c, { id: existing.id, key, sha256, bytes: bytes.length, stored: false, reason: "Unchanged since it was last stored." });
  }

  const id = newId("vlt");
  const r2Key = `canon/${key}/${sha256}`;
  if (!c.env.VAULT) {
    /*
     * NO BUCKET IS A REFUSAL, NOT A HALF-STORE. Writing the row without the object would leave a
     * hash pointing at nothing — a record that says a document is preserved when it is not, which is
     * worse than an empty vault.
     */
    throw conflict("No R2 bucket is bound, so nothing can be preserved", "Bind VAULT before storing documents.");
  }
  await c.env.VAULT.put(r2Key, bytes);

  await c.env.DB
    .prepare(
      `INSERT INTO vault_entries (id, lane, key, kind, r2_key, sha256, bytes, note, created_at)
       VALUES (?, 'ops', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, key, b?.kind ? String(b.kind) : "canon_doc", r2Key, sha256, bytes.length,
          existing ? `Replaces ${existing.sha256.slice(0, 12)} stored ${new Date(existing.created_at).toISOString().slice(0, 10)}` : null,
          Date.now())
    .run();

  await audit(c.env.DB, {
    actor: "system", lane: "ops", entityType: "vault_entry", entityId: id,
    action: existing ? "canon_changed" : "canon_stored",
    detail: { key, sha256, bytes: bytes.length, previous: existing?.sha256 ?? null },
  });

  return ok(c, { id, key, sha256, bytes: bytes.length, stored: true, changed: Boolean(existing) }, 201);
});

vault.get("/snapshots", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM vault_snapshots ORDER BY ts DESC LIMIT 50`).all();
  return ok(c, rows.results ?? []);
});

vault.get("/restores", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM vault_restores ORDER BY ts DESC LIMIT 50`).all();
  return ok(c, rows.results ?? []);
});

/**
 * Which tables this runtime is allowed to snapshot.
 *
 * THE LEAK THIS CLOSES. `takeSnapshot` wrote every table in SNAPSHOT_TABLES to R2, and R2 is a
 * CLOUD bucket. All eighteen sovereign tables were in that list, so the continuity vault - running
 * on a cron, nightly, with nobody watching - copied every dream, decision, prediction, emotional
 * state, meeting capture and promoted memory into cloud storage. §3.3 says LOCAL_ONLY must "never
 * enter cloud snapshots". It was entering them on a schedule. Found by the Batch 9 hostile suite,
 * which planted a sentinel in three sovereign tables and read the snapshot back out of R2.
 *
 * The exclusion is DERIVED from data_policy, not a second hand-written list. Two lists that must
 * agree and have no link is how the first one gets updated alone.
 *
 * The private runtime sets BOSS_DOMAIN=private and snapshots everything, because that vault is on
 * the machine the data already lives on. Absent or unrecognised means cloud, so a misconfigured
 * runtime excludes rather than exports.
 */
async function snapshotTablesFor(env: Env): Promise<{ tables: string[]; excluded: string[] }> {
  if (env.BOSS_DOMAIN === "private") return { tables: [...SNAPSHOT_TABLES], excluded: [] };
  const rows = await env.DB
    .prepare(`SELECT entity FROM data_policy WHERE residency = 'LOCAL_ONLY'`)
    .all<{ entity: string }>();
  const sovereign = new Set((rows.results ?? []).map((r) => r.entity));
  return {
    tables: SNAPSHOT_TABLES.filter((t) => !sovereign.has(t)),
    excluded: SNAPSHOT_TABLES.filter((t) => sovereign.has(t)),
  };
}

/**
 * Full JSON export to R2 of every table this runtime may snapshot. This is the thing that makes
 * the system rebuildable: if the Worker vanishes, the vault still has the state.
 *
 * A CLOUD SNAPSHOT IS PARTIAL BY DESIGN, and says so in its own manifest. A restore that did not
 * know which tables were never in the file would look complete and be missing the whole private
 * half - so the excluded list travels inside the snapshot rather than in someone's memory.
 */
export interface SnapshotWritten {
  id: string;
  r2Key: string;
  bytes: number;
  sha256: string;
  counts: Record<string, number>;
}

export interface SnapshotSkipped {
  id: string;
  skipped: true;
  reason: "unchanged";
  matches: string;
  sha256: string;
}

/*
 * OVERLOADED SO THE DEFAULT CALLER KEEPS ITS OLD SHAPE. `skipIfUnchanged` is the only way to get
 * back something that might not have written an object, and a caller that does not ask for it
 * cannot be handed one - which is what keeps the drill, the manual button and the restore path
 * free of narrowing they have no reason to do.
 */
export async function takeSnapshot(env: Env, label: string): Promise<SnapshotWritten>;
export async function takeSnapshot(
  env: Env,
  label: string,
  opts: { skipIfUnchanged: true },
): Promise<SnapshotWritten | SnapshotSkipped>;
export async function takeSnapshot(
  env: Env,
  label: string,
  opts: { skipIfUnchanged?: boolean } = {},
): Promise<SnapshotWritten | SnapshotSkipped> {
  const id = newId("snp");
  const ts = Date.now();
  await env.DB
    .prepare(`INSERT INTO vault_snapshots (id, ts, label, status) VALUES (?,?,?,'pending')`)
    .bind(id, ts, label)
    .run();

  try {
    const { tables: allowed, excluded } = await snapshotTablesFor(env);
    const dump: Record<string, unknown[]> = {};
    const counts: Record<string, number> = {};
    for (const table of allowed) {
      const rows = await env.DB.prepare(`SELECT * FROM ${table}`).all();
      dump[table] = rows.results ?? [];
      counts[table] = dump[table].length;
    }

    /*
     * HAS ANYTHING ACTUALLY CHANGED?
     *
     * Hashed over the tables MINUS the diagnostic spine, and minus the timestamp. Include either
     * and the answer is yes forever - `cron_runs` gains a row for the very run asking the
     * question, which is how a snapshot every fifteen minutes justified itself for a day. See
     * cron/cadence.ts CHURN_TABLES for why `audit_log` is deliberately not in that exemption.
     *
     * Compared against the last COMPLETE snapshot's substance, so a run that skipped and a run
     * that failed cannot be mistaken for a baseline.
     */
    const substance: Record<string, unknown[]> = {};
    for (const table of allowed) if (!CHURN_TABLES.has(table)) substance[table] = dump[table] ?? [];
    const substanceSha = await sha256Hex(JSON.stringify(substance));

    if (opts.skipIfUnchanged) {
      const previous = await env.DB
        .prepare(
          `SELECT id, substance_sha FROM vault_snapshots
            WHERE status = 'complete' AND substance_sha IS NOT NULL
            ORDER BY ts DESC LIMIT 1`,
        )
        .first<{ id: string; substance_sha: string }>();

      if (previous?.substance_sha === substanceSha) {
        await env.DB
          .prepare(`UPDATE vault_snapshots SET status = 'skipped', substance_sha = ? WHERE id = ?`)
          .bind(substanceSha, id)
          .run();
        await logEvent(env.DB, {
          level: "info", scope: "vault", event: "snapshot_skipped_unchanged", entityId: id,
          detail: { matches: previous.id, substance_sha: substanceSha },
        });
        return { id, skipped: true, reason: "unchanged", matches: previous.id, sha256: substanceSha } satisfies SnapshotSkipped;
      }
    }

    const payload = JSON.stringify({
      snapshot_version: SNAPSHOT_VERSION,
      version: env.BOSS_OS_VERSION,
      ts,
      domain: env.BOSS_DOMAIN === "private" ? "private" : "cloud",
      // Named, so a restore knows what was never here rather than inferring completeness.
      excluded_local_only: excluded,
      tables: dump,
    });
    const bytes = new TextEncoder().encode(payload);
    const sha = await sha256Hex(payload);
    const r2Key = `snapshots/${new Date(ts).toISOString()}-${id}.json`;

    await env.VAULT.put(r2Key, bytes, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { sha256: sha, snapshotId: id },
    });

    await env.DB
      .prepare(
        `UPDATE vault_snapshots SET r2_key = ?, bytes = ?, sha256 = ?, table_counts = ?, substance_sha = ?, status = 'complete' WHERE id = ?`,
      )
      .bind(r2Key, bytes.byteLength, sha, JSON.stringify(counts), substanceSha, id)
      .run();

    await logEvent(env.DB, {
      level: "info", scope: "vault", event: "snapshot_complete", entityId: id,
      detail: { bytes: bytes.byteLength, tables: SNAPSHOT_TABLES.length },
    });

    return { id, r2Key, bytes: bytes.byteLength, sha256: sha, counts };
  } catch (err) {
    await env.DB
      .prepare(`UPDATE vault_snapshots SET status = 'failed' WHERE id = ?`).bind(id).run();
    await logEvent(env.DB, {
      level: "error", scope: "vault", event: "snapshot_failed", entityId: id,
      detail: { message: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

/**
 * Retention. Keeps the newest `SNAPSHOT_KEEP` complete snapshots and deletes the rest from R2.
 *
 * WHY THIS EXISTS AT ALL. Nothing ever deleted a snapshot - not in R2, not in `vault_snapshots`.
 * Paired with a maintenance run that fired 96 times a day, production reached 62 snapshots and
 * 30.4 MB inside fifteen hours, each one larger than the last. The cadence fix stops the flood;
 * this stops the puddle from being permanent.
 *
 * THE ROW SURVIVES ITS OBJECT. A pruned snapshot keeps its id, timestamp, hash and table counts
 * and loses only the bytes, so the vault's history stays readable and a restore attempt against a
 * pruned snapshot fails with "pruned" rather than a missing-key error that reads like corruption.
 *
 * NEVER PRUNES THE NEWEST, whatever the arithmetic says. A retention bug that empties the vault
 * is strictly worse than one that keeps too much, so the floor is defended explicitly rather than
 * left to follow from the ordering.
 */
export async function pruneSnapshots(env: Env, keep = SNAPSHOT_KEEP) {
  const floor = Math.max(1, keep);
  const stale = await env.DB
    .prepare(
      `SELECT id, r2_key FROM vault_snapshots
        WHERE status = 'complete' AND r2_key IS NOT NULL
        ORDER BY ts DESC
        LIMIT -1 OFFSET ?`,
    )
    .bind(floor)
    .all<{ id: string; r2_key: string }>();

  const rows = stale.results ?? [];
  let deleted = 0;
  const failures: { id: string; error: string }[] = [];

  for (const rowToPrune of rows) {
    try {
      await env.VAULT.delete(rowToPrune.r2_key);
      await env.DB
        .prepare(
          `UPDATE vault_snapshots SET status = 'pruned', pruned_at = ?, r2_key = NULL, bytes = 0 WHERE id = ?`,
        )
        .bind(Date.now(), rowToPrune.id)
        .run();
      deleted += 1;
    } catch (err) {
      // A failed delete leaves the row COMPLETE and the object in place, so the next run tries
      // again. Marking it pruned here would orphan the object forever - unreachable from the
      // database and never billed to anyone's attention.
      failures.push({ id: rowToPrune.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (deleted || failures.length) {
    await logEvent(env.DB, {
      level: failures.length ? "warn" : "info", scope: "vault", event: "snapshots_pruned",
      detail: { kept: floor, deleted, failures },
    });
  }
  return { kept: floor, deleted, failures };
}

vault.post("/prune", async (c) => {
  const body = await c.req.json<{ keep?: number }>().catch(() => ({ keep: undefined }));
  const result = await pruneSnapshots(c.env, body.keep ?? SNAPSHOT_KEEP);
  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "snapshot", entityId: "retention",
    action: "pruned", detail: result,
  });
  return ok(c, result);
});

vault.post("/snapshots", async (c) => {
  const body = await c.req.json<{ label?: string }>().catch(() => ({ label: undefined }));
  const result = await takeSnapshot(c.env, body.label ?? "manual");
  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "snapshot", entityId: result.id, action: "created" });
  return ok(c, result, 201);
});

vault.get("/snapshots/:id/download", async (c) => {
  const row = await c.env.DB
    .prepare(`SELECT r2_key FROM vault_snapshots WHERE id = ? AND status = 'complete'`)
    .bind(c.req.param("id")).first<{ r2_key: string }>();
  if (!row?.r2_key) throw notFound("No completed snapshot with that id");
  const obj = await c.env.VAULT.get(row.r2_key);
  if (!obj) throw notFound("The snapshot record exists but its file is missing from the vault bucket");
  return new Response(obj.body, {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="${row.r2_key.split("/").pop()}"`,
    },
  });
});

/** Re-reads the object from R2 and re-hashes it. A snapshot nobody verified is a hope. */
vault.get("/snapshots/:id/verify", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB
    .prepare(`SELECT id, r2_key, sha256, bytes FROM vault_snapshots WHERE id = ?`)
    .bind(id).first<{ id: string; r2_key: string | null; sha256: string | null; bytes: number }>();
  if (!row) throw notFound("No snapshot with that id");
  if (!row.r2_key) throw conflict("That snapshot never finished writing");

  const obj = await c.env.VAULT.get(row.r2_key);
  if (!obj) {
    return ok(c, { id, ok: false, reason: "The snapshot file is missing from the vault bucket" });
  }
  const text = await obj.text();
  const computed = await sha256Hex(text);
  const parsed = parseSnapshot(text);

  return ok(c, {
    id,
    ok: computed === row.sha256 && parsed.ok,
    declared_sha256: row.sha256,
    computed_sha256: computed,
    sha_match: computed === row.sha256,
    parse: parsed.ok ? { ok: true, tables: Object.keys(parsed.tables).length, rows: parsed.totalRows } : { ok: false, reason: parsed.reason },
    bytes: text.length,
  });
});

interface ParsedSnapshot {
  ok: boolean;
  reason?: string;
  ts?: number;
  tables: Record<string, any[]>;
  totalRows: number;
  /** Tables the writing runtime deliberately left out. Absent on snapshots taken before §3.3. */
  excludedLocalOnly?: string[];
}

function parseSnapshot(text: string): ParsedSnapshot {
  let doc: any;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, reason: "The file is not valid JSON", tables: {}, totalRows: 0 };
  }
  if (!doc || typeof doc !== "object" || !doc.tables || typeof doc.tables !== "object") {
    return { ok: false, reason: "The file has no `tables` object, so it is not a Boss OS snapshot", tables: {}, totalRows: 0 };
  }
  let totalRows = 0;
  for (const [name, rows] of Object.entries(doc.tables)) {
    if (!Array.isArray(rows)) {
      return { ok: false, reason: `Table ${name} is not an array of rows`, tables: {}, totalRows: 0 };
    }
    totalRows += rows.length;
  }
  return {
    ok: true,
    ts: doc.ts,
    tables: doc.tables as Record<string, any[]>,
    totalRows,
    excludedLocalOnly: Array.isArray(doc.excluded_local_only) ? doc.excluded_local_only : [],
  };
}

/** Columns that actually exist, so a snapshot from an older schema still loads. */
async function tableColumns(db: D1Database, table: string): Promise<Set<string>> {
  const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return new Set((info.results ?? []).map((r) => r.name));
}

/**
 * Restore.
 *
 * Three modes, deliberately separate:
 *   verify  — hash, parse, and count. Writes nothing. Always safe.
 *   merge   — insert rows that are not already present. Existing rows win.
 *   replace — wipe the covered tables and load the snapshot verbatim.
 *
 * `replace` destroys current state, so it demands an explicit confirmation
 * string. Everything is recorded in `vault_restores` either way.
 */
vault.post("/restore", async (c) => {
  const body = await c.req.json<any>().catch(() => null);
  if (!body) throw badRequest("Restore needs a body", "Send { snapshot_id | payload, mode }.");

  const mode = body.mode ?? "verify";
  if (!["verify", "merge", "replace"].includes(mode)) {
    throw badRequest("Mode must be verify, merge, or replace");
  }
  if (mode === "replace" && body.confirm !== "REPLACE") {
    throw conflict(
      "Replace wipes current state before loading",
      'Send { "confirm": "REPLACE" } once you have a fresh snapshot of what you are about to overwrite.',
    );
  }

  let text: string;
  let source: string;
  let declaredSha: string | null = null;

  if (body.snapshot_id) {
    const row = await c.env.DB
      .prepare(`SELECT r2_key, sha256 FROM vault_snapshots WHERE id = ? AND status = 'complete'`)
      .bind(body.snapshot_id).first<{ r2_key: string; sha256: string | null }>();
    if (!row?.r2_key) throw notFound("No completed snapshot with that id");
    const obj = await c.env.VAULT.get(row.r2_key);
    if (!obj) throw notFound("The snapshot record exists but its file is missing from the vault bucket");
    text = await obj.text();
    source = row.r2_key;
    declaredSha = row.sha256;
  } else if (typeof body.payload === "string") {
    text = body.payload;
    source = "upload";
    declaredSha = body.sha256 ?? null;
  } else {
    throw badRequest("Restore needs a source", "Send either snapshot_id or payload as a JSON string.");
  }

  const restoreId = newId("rst");
  const computed = await sha256Hex(text);
  const parsed = parseSnapshot(text);

  const fail = async (reason: string): Promise<never> => {
    await c.env.DB
      .prepare(
        `INSERT INTO vault_restores (id, ts, source, mode, declared_sha, computed_sha, status, error)
         VALUES (?,?,?,?,?,?,'failed',?)`,
      )
      .bind(restoreId, Date.now(), source, mode, declaredSha, computed, reason)
      .run();
    await logEvent(c.env.DB, {
      level: "error", scope: "vault", event: "restore_failed", entityId: restoreId, detail: { reason, mode },
    });
    throw new AppError(422, reason, "Nothing was written. Fix the source file and try again.");
  };

  if (declaredSha && declaredSha !== computed) {
    await fail(`Integrity check failed: the file hashes to ${computed.slice(0, 12)}… but ${declaredSha.slice(0, 12)}… was expected`);
  }
  if (!parsed.ok) await fail(parsed.reason ?? "The snapshot could not be parsed");

  const counts: Record<string, number> = {};
  for (const [name, rows] of Object.entries(parsed.tables)) counts[name] = rows.length;

  if (mode === "verify") {
    await c.env.DB
      .prepare(
        `INSERT INTO vault_restores (id, ts, source, mode, declared_sha, computed_sha, snapshot_ts, table_counts, status)
         VALUES (?,?,?,?,?,?,?,?,'verified')`,
      )
      .bind(restoreId, Date.now(), source, mode, declaredSha, computed, parsed.ts ?? null, JSON.stringify(counts))
      .run();
    return ok(c, {
      id: restoreId, status: "verified", sha256: computed, snapshot_ts: parsed.ts ?? null,
      tables: counts, total_rows: parsed.totalRows,
      note: "Nothing was written. This confirms the snapshot is intact and loadable.",
    });
  }

  // ─── Write path ────────────────────────────────────────────────────────────
  //
  // One batch, one transaction, foreign keys deferred to the commit.
  //
  // The schema contains a genuine cycle — an employee points at the proposal
  // that created it, and that proposal points back at the employee — so no
  // insert order can satisfy foreign keys row by row. Deferring the check to
  // commit is the only correct answer, and it has the bonus that a restore
  // either lands completely or not at all. A half-applied restore would be
  // worse than no restore.
  const applied: Record<string, number> = {};
  const statements: D1PreparedStatement[] = [c.env.DB.prepare(`PRAGMA defer_foreign_keys = ON`)];

  if (mode === "replace") {
    for (const table of [...SNAPSHOT_TABLES].reverse()) {
      if (!(table in parsed.tables)) continue;
      statements.push(c.env.DB.prepare(`DELETE FROM ${table}`));
    }
  }

  const verb = mode === "replace" ? "INSERT OR REPLACE" : "INSERT OR IGNORE";
  for (const table of SNAPSHOT_TABLES) {
    const rows = parsed.tables[table];
    if (!Array.isArray(rows) || !rows.length) continue;

    const known = await tableColumns(c.env.DB, table);
    let written = 0;
    for (const r of rows) {
      if (!r || typeof r !== "object") continue;
      // Only columns this schema still has, so a snapshot from an older
      // migration still loads instead of failing on a dropped column.
      const cols = Object.keys(r).filter((k) => known.has(k));
      if (!cols.length) continue;
      statements.push(
        c.env.DB
          .prepare(`${verb} INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`)
          .bind(...cols.map((k) => (r as any)[k])),
      );
      written++;
    }
    applied[table] = written;
  }

  if (statements.length > MAX_RESTORE_STATEMENTS) {
    await fail(
      `This snapshot needs ${statements.length} statements, over the ${MAX_RESTORE_STATEMENTS} a single ` +
      `transaction can carry. Restoring it in pieces would risk leaving the database half-loaded, so nothing was written.`,
    );
  }

  try {
    await c.env.DB.batch(statements);
  } catch (err) {
    await fail(`The restore transaction was rolled back: ${err instanceof Error ? err.message : String(err)}`);
  }

  await c.env.DB
    .prepare(
      `INSERT INTO vault_restores (id, ts, source, mode, declared_sha, computed_sha, snapshot_ts, table_counts, applied, status)
       VALUES (?,?,?,?,?,?,?,?,?,'applied')`,
    )
    .bind(
      restoreId, Date.now(), source, mode, declaredSha, computed, parsed.ts ?? null,
      JSON.stringify(counts), JSON.stringify(applied),
    )
    .run();

  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "restore", entityId: restoreId,
    action: `restore_${mode}`, detail: { source, rows: applied },
  });
  await logEvent(c.env.DB, {
    level: "warn", scope: "vault", event: "restore_applied", entityId: restoreId,
    detail: { mode, source, tables: Object.keys(applied).length },
  });

  return ok(c, { id: restoreId, status: "applied", mode, sha256: computed, applied }, 201);
});

/**
 * Restore drill.
 *
 * Takes a fresh snapshot, reads it back out of R2, re-hashes it, and confirms it
 * parses and covers every table. Proves the continuity path end to end without
 * touching live state.
 */
vault.post("/drill", async (c) => {
  const started = Date.now();
  const snapshot = await takeSnapshot(c.env, "drill");

  const obj = await c.env.VAULT.get(snapshot.r2Key);
  if (!obj) throw new AppError(500, "The drill snapshot was written but could not be read back", "Check the R2 binding and bucket name.");

  const text = await obj.text();
  const computed = await sha256Hex(text);
  const parsed = parseSnapshot(text);
  /*
   * A DELIBERATE EXCLUSION IS NOT A MISSING TABLE.
   *
   * On a cloud runtime the sovereign tables are never written to the vault, by design (§3.3). A
   * drill that counted them as missing would fail every night and be switched off within a week -
   * and then the drill that catches a REAL missing table would be off too. The snapshot carries
   * its own list of what it left out, so the drill reads it rather than assuming.
   */
  const excluded = new Set<string>((parsed.excludedLocalOnly ?? []) as string[]);
  const missing = SNAPSHOT_TABLES.filter((t) => !excluded.has(t) && !(t in (parsed.tables ?? {})));

  const passed = computed === snapshot.sha256 && parsed.ok && missing.length === 0;
  const restoreId = newId("rst");

  await c.env.DB
    .prepare(
      `INSERT INTO vault_restores (id, ts, source, mode, declared_sha, computed_sha, snapshot_ts, table_counts, status, error)
       VALUES (?,?,?,'verify',?,?,?,?,?,?)`,
    )
    .bind(
      restoreId, Date.now(), snapshot.r2Key, snapshot.sha256, computed, parsed.ts ?? null,
      JSON.stringify(snapshot.counts), passed ? "verified" : "failed",
      passed ? null : `sha_match=${computed === snapshot.sha256} parse_ok=${parsed.ok} missing=${missing.join(",")}`,
    )
    .run();

  await logEvent(c.env.DB, {
    level: passed ? "info" : "error", scope: "vault", event: "restore_drill",
    durationMs: Date.now() - started, detail: { passed, missing },
  });

  return ok(c, {
    passed,
    snapshot_id: snapshot.id,
    restore_id: restoreId,
    sha_match: computed === snapshot.sha256,
    parse_ok: parsed.ok,
    tables_covered: SNAPSHOT_TABLES.length - missing.length - excluded.size,
    tables_expected: SNAPSHOT_TABLES.length - excluded.size,
    missing_tables: missing,
    // Named rather than silent: a partial vault that does not say so is a full vault to whoever
    // reads it next.
    excluded_local_only: [...excluded],
    total_rows: parsed.totalRows,
    bytes: snapshot.bytes,
    took_ms: Date.now() - started,
  });
});

export { SNAPSHOT_TABLES };
