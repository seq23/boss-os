interface KdpCaseCheck {
  id: string;
  checked_at: number;
  sentinel: string;
  determination: string | null;
  next_action: string | null;
  needs_owner: number;
  days_since_support: number | null;
  nudges_unanswered: number | null;
  threads_seen: number | null;
  source: string;
  run_outcome: string;
}

export async function readKdpCaseChecks(db: D1Database, limit = 12) {
  const { results } = await db.prepare(`SELECT id, checked_at, sentinel, determination, next_action, needs_owner,
    days_since_support, nudges_unanswered, threads_seen, source, run_outcome
    FROM kdp_case_checks ORDER BY checked_at DESC LIMIT ?`).bind(limit).all<KdpCaseCheck>();
  return results;
}

export async function readKdpPublishAttempts(db: D1Database, limit: number) {
  const { results } = await db.prepare(`SELECT id, attempted_at, judgement_id, title_ref, cover_uploaded, publish_attempted,
    resulting_state, amazon_message, run_outcome, stop_code, source
    FROM kdp_publish_attempts ORDER BY attempted_at DESC LIMIT ?`).bind(limit).all();
  return results;
}
