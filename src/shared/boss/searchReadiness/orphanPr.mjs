import { mayAutoFix } from '../siteAudit/repoPolicy.mjs';
import { heldForOwner } from './ownerApproval.mjs';

/** Fail closed before recovering a PR left by our own audit lane. */
export function orphanVerdict(row, pr, { sites = [], approvedSites = [] } = {}) {
  const name = String(row.repo ?? '').split('/').pop();
  const match = /^https:\/\/github\.com\/seq23\/([^/]+)\/pull\/(\d+)$/.exec(row.pr_url ?? '');
  if (!match || match[1] !== name || !mayAutoFix(row.repo) || !sites.some(s => s.repo === name)) return 'refused_policy';
  const related = sites.filter(s => s.repo === name);
  if (related.some(s => s.client_approval)) return 'client_approval';
  if (related.some(s => heldForOwner(s, { approved: approvedSites.includes(s.domain), texts: row.pages?.length ? row.pages : [row.headline, row.because] }))) return 'owner_approval';
  // MERGED IS MERGED, WHOEVER OPENED IT (7 Nov 2026): heygetonmylevel #15, opened off
  // fix/sr-heygetonmylevel-6nov and already merged, was logged "blocked: another_lane".
  if (pr?.state === 'MERGED') return 'already_merged';
  if (!pr?.headRefName?.startsWith('danielle/site-audit-')) return 'another_lane';
  if (pr.state !== 'OPEN') return 'refused_policy';
  if (pr.isDraft) return 'draft_left_behind';
  const checks = pr.statusCheckRollup;
  if (!Array.isArray(checks) || !checks.length || checks.some(c => c.status ? c.status !== 'COMPLETED' || !['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(c.conclusion) : c.state !== 'SUCCESS')) return 'checks_red';
  return 'land';
}

export function blockerLines(rows) {
  return [...new Set(rows.filter(r => r.disposition === 'in_flight' && r.land === 'blocked').map(r => `${r.pr_url ?? r.repo}: ${r.land_detail ?? 'unverified PR'}`))];
}
export function blockedStopSentence(rows) {
  rows = rows.filter(r => r.disposition !== 'none');
  if (!rows.length || rows.some(r => r.disposition !== 'in_flight' || r.land !== 'blocked' || !PR_URL.test(r.pr_url ?? ''))) return '';
  return blockerLines(rows).join('; ');
}

const PR_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/;
const DONE_LANDS = ['already_merged', 'landed'];

/**
 * WHY A ROUND FIXED NOTHING (7 Nov 2026). Round 3 of that day's run held two briefs on heygetonmylevel,
 * both fixed by MERGED pull requests that Lovable had not yet published (a hand Share -> Publish), and
 * the run called it "fixed nothing" / SR_QUEUE_STALLED, opening a repair Danielle can never finish.
 * Returns { code, sentence }:
 *  - every row in flight and at least one still blocked by an open PR -> SR_BLOCKED_BY_OPEN_PRS;
 *  - every row in flight and every PR merged or landed -> SR_AWAITING_HOST_PUBLISH (the fix is on
 *    main; the live host has not rebuilt);
 *  - anything else -> { code: '', sentence: '' }, so a genuine stall stays SR_QUEUE_STALLED.
 */
export function fixedNothingCause(rows) {
  rows = rows.filter(r => r.disposition !== 'none');
  const none = { code: '', sentence: '' };
  if (!rows.length || rows.some(r => r.disposition !== 'in_flight' || !PR_URL.test(r.pr_url ?? ''))) return none;
  if (rows.some(r => r.land === 'blocked')) {
    const blockers = blockerLines(rows).join('; ');
    return blockers ? { code: 'SR_BLOCKED_BY_OPEN_PRS', sentence: blockers } : none;
  }
  if (rows.every(r => DONE_LANDS.includes(r.land))) {
    const prs = [...new Set(rows.map(r => r.pr_url))];
    const repos = [...new Set(rows.map(r => String(r.repo ?? '').split('/').pop()).filter(Boolean))];
    return {
      code: 'SR_AWAITING_HOST_PUBLISH',
      sentence: `the fixes are merged (${prs.join(', ')}) but the live site has not been republished${repos.length ? ` (${repos.join(', ')})` : ''}`,
    };
  }
  return none;
}
