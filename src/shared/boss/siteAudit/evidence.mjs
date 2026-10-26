/**
 * WHAT A FIXER PASS MUST PROVE IT LOOKED AT, AND WHAT MAY NEVER CROSS INTO BOSS OS.
 *
 * Shared by `scripts/ops/ahrefs-audit-report.mjs` (the legible refusal, before sending) and
 * `POST /api/boss/engineering/site-audit-findings` (the guarantee, on arrival).
 *
 * ─── Two kinds of pass, two kinds of evidence (26 Oct 2026) ──────────────────
 *
 * The weekly Ahrefs pass reads her mailbox, so its evidence is the mailbox, the queries, the date
 * range and the message count — the owner's standing correction after five false alarms. The daily
 * Search Readiness queue run (`search-readiness-fix.sh` → `ahrefs-audit-fix.sh` with SR_SCOPE_REPO)
 * reads no mailbox at all: it works briefs out of `fix-queue.json`. Holding it to the mailbox rule
 * refused 7 of the night's passes (`NAMED STOP [NO_SEARCH_EVIDENCE] rc=11`) and Boss OS was never
 * told about 129 fixes. A queue pass now carries evidence that fits it — the queue file, when it was
 * written, the repo and the brief ids — built by the runner, not left to the model's wording. Each
 * kind keeps a strict rule; neither may send a bare "nothing found".
 *
 * ─── An address, not an '@' ──────────────────────────────────────────────────
 *
 * The rule is "no email address in this table". A plain `includes("@")` also refused JSON-LD words
 * (`@type`, `@id`, `@graph`) that every structured-data finding names, and refused a whole night's
 * batch for one of them (local-guides-citation-velocity, 25 Oct 2026, ADDRESS_IN_BECAUSE). An
 * address is still refused anywhere, whole batch, as before.
 */

/** Something shaped like an email address (local part, @, a dotted domain). */
export const ADDRESS_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;

export function carriesAddress(v) {
  return typeof v === "string" && ADDRESS_RE.test(v);
}

const nonEmpty = (s) => typeof s === "string" && s.trim().length > 0;
const isDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s);

/**
 * Why `searched` is not acceptable evidence, or null when it is.
 *
 *   mode "queue"  → queue_file, queue_written_at, repo and at least one brief id in item_ids.
 *   otherwise     → the mailbox pass: mailbox, at least one query, since, until and a message count.
 */
export function searchEvidenceGap(searched) {
  if (!searched || typeof searched !== "object" || Array.isArray(searched)) return "`searched` is missing";
  if (searched.mode === "queue") {
    const miss = [];
    if (!nonEmpty(searched.queue_file)) miss.push("queue_file");
    if (!nonEmpty(searched.queue_written_at)) miss.push("queue_written_at");
    if (!nonEmpty(searched.repo)) miss.push("repo");
    if (!Array.isArray(searched.item_ids) || !searched.item_ids.some(nonEmpty)) miss.push("item_ids");
    return miss.length ? `a queue pass's \`searched\` must carry the queue file, when it was written, the repo and the brief ids it worked (missing: ${miss.join(", ")})` : null;
  }
  const miss = [];
  if (!nonEmpty(searched.mailbox)) miss.push("mailbox");
  if (!Array.isArray(searched.queries) || !searched.queries.some(nonEmpty)) miss.push("queries");
  if (!isDay(searched.since) || !isDay(searched.until)) miss.push("the date range");
  if (!Number.isFinite(Number(searched.messages)) || searched.messages === null || searched.messages === "") miss.push("the message count");
  return miss.length ? `a mailbox pass's \`searched\` must carry the mailbox, the queries, the date range and the message count (missing: ${miss.join(", ")})` : null;
}

/** `sr-<domain>-<item>` for a checklist finding row (`project: "checklist:<domain>"`, headline "a6: …"). */
export function findingItemId(f) {
  const p = String(f?.project ?? "");
  if (!p.startsWith("checklist:")) return null;
  const item = /^\s*([a-j]\d{1,2})\s*:/i.exec(String(f?.headline ?? ""))?.[1]?.toLowerCase();
  return item ? `sr-${p.slice("checklist:".length).trim().toLowerCase()}-${item}` : null;
}

/**
 * The evidence for one queue pass. `scope` is the snapshot the runner wrote before the pass started
 * (`site-audit-lib.mjs scope`); the findings add any brief the pass recorded beyond it. Nothing the
 * model wrote is copied in, so an address it put in its own `searched` never travels.
 */
export function queueEvidence({ scope, repo, findings = [] }) {
  const ids = new Set([...(scope?.item_ids ?? [])]);
  for (const f of findings) { const id = findingItemId(f); if (id) ids.add(id); }
  return {
    mode: "queue",
    queue_file: scope?.queue_file ?? null,
    queue_written_at: scope?.queue_written_at ?? null,
    repo: scope?.repo ?? repo ?? null,
    item_ids: [...ids],
    briefs_in_queue_for_repo: scope?.briefs_in_queue_for_repo ?? null,
    snapshot_at: scope?.snapshot_at ?? null,
  };
}

/** The scope snapshot: which briefs of the queue this pass was handed. Pure, so the test can call it. */
export function scopeSnapshot({ queue, queueFile, repo, briefIds = [], now = Date.now() }) {
  const forRepo = (queue?.briefs ?? []).filter((b) => b.repo === repo);
  const wanted = briefIds.length ? forRepo.filter((b) => briefIds.includes(b.id)) : forRepo;
  return {
    mode: "queue",
    queue_file: queueFile,
    queue_written_at: queue?.written_at ?? null,
    repo,
    item_ids: wanted.map((b) => b.id),
    briefs_in_queue_for_repo: forRepo.length,
    snapshot_at: new Date(now).toISOString(),
  };
}
