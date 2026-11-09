import { mayAutoFix } from '../siteAudit/repoPolicy.mjs';
import { heldForOwner } from './ownerApproval.mjs';

/** Fail closed before recovering a PR left by our own audit lane. */
export function orphanVerdict(row, pr, { sites = [], approvedSites = [] } = {}) {
  const name = String(row.repo ?? '').split('/').pop();
  const match = /^https:\/\/github\.com\/seq23\/([^/]+)\/pull\/(\d+)$/.exec(row.pr_url ?? '');
  if (!match || match[1] !== name || !mayAutoFix(row.repo) || !sites.some(s => s.repo === name)) return 'refused_policy';
  const related = sites.filter(s => s.repo === name);
  if (related.some(s => heldForOwner(s, { approved: approvedSites.includes(s.domain), texts: row.pages?.length ? row.pages : [row.headline, row.because] }))) return 'owner_approval';
  // No PR read yet: the caller must read it. A client_approval site is read too (9 Nov 2026), so a
  // PR that only stages an approval-queue item can be proved and landed; see stagesQueueOnly.
  if (!pr) return 'another_lane';
  // MERGED IS MERGED, WHOEVER OPENED IT (7 Nov 2026): heygetonmylevel #15, opened off
  // fix/sr-heygetonmylevel-6nov and already merged, was logged "blocked: another_lane".
  if (pr.state === 'MERGED') return 'already_merged';
  if (!pr.headRefName?.startsWith('danielle/site-audit-')) return 'another_lane';
  if (pr.state !== 'OPEN') return 'refused_policy';
  /*
   * OUR OWN UNFINISHED PR IS WORK FOR THE NEXT PASS, NOT A REASON TO SKIP (9 Nov 2026). Seven
   * danielle/site-audit-* PRs sat 4-6 days: a draft left at a turn limit (p-n-p #179, LGG #166,
   * LGCV #272) and a green PR main had moved past (LGG #161, "CONFLICTING/DIRTY") were each
   * recorded in_flight, and every later pass skipped the brief because the PR was open. The three
   * verdicts in NEEDS_WORKER are handed to the worker first by the next scoped pass
   * (site-audit-lib.mjs own-open -> ahrefs-audit-fix.sh "FINISH YOUR OWN OPEN PULL REQUESTS").
   */
  if (pr.isDraft) return 'draft_left_behind';
  if (pr.mergeable === 'CONFLICTING') return 'conflicting';
  const checks = pr.statusCheckRollup;
  if (!Array.isArray(checks) || !checks.length || checks.some(c => c.status ? c.status !== 'COMPLETED' || !['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(c.conclusion) : c.state !== 'SUCCESS')) return 'checks_red';
  // A CLIENT APPROVES WHAT GOES LIVE (Horse, owner 3 Nov 2026). Only a PR proved to change no public
  // output, by staging an item in the site's own approval queue, lands; anything else stays held.
  if (related.some(s => s.client_approval) && !related.every(s => !s.client_approval || stagesQueueOnly(s, pr.queue_proof))) return 'client_approval';
  return 'land';
}

/** The orphan verdicts that are our own lane's unfinished work: the next pass finishes them. */
export const NEEDS_WORKER = Object.freeze(['draft_left_behind', 'conflicting', 'checks_red']);

/**
 * DOES THIS PR ONLY STAGE AN APPROVAL-QUEUE ITEM? (9 Nov 2026, horse-legal-guide-velocity #77/#78.)
 * `proof` = { files: [changed paths], contents: { [path]: { base: text|null, head: text|null } } }.
 * True only when every changed file is one of the site's `client_approval_queue_files` and, in each,
 * the approved entries (`changes[]` with status "approved") are byte-identical before and after: the
 * repo builds an unapproved change as byte-identical output (its scripts/lib/site_changes.js), so
 * nothing public moves until the client approves it in /admin/. Anything unread, unparsable, new,
 * or touching another file fails closed.
 */
export function stagesQueueOnly(site, proof) {
  const allowed = Array.isArray(site?.client_approval_queue_files) ? site.client_approval_queue_files : [];
  const files = Array.isArray(proof?.files) ? proof.files : [];
  if (!allowed.length || !files.length || files.some(f => !allowed.includes(f))) return false;
  const approved = (text) => {
    const doc = JSON.parse(text);
    if (!Array.isArray(doc?.changes)) throw new Error('no changes[]');
    return JSON.stringify(doc.changes.filter(c => c?.status === 'approved').sort((a, b) => String(a.id).localeCompare(String(b.id))));
  };
  try {
    return files.every(f => {
      const c = proof.contents?.[f];
      return typeof c?.base === 'string' && typeof c?.head === 'string' && approved(c.base) === approved(c.head);
    });
  } catch { return false; }
}

/**
 * IS THIS OPEN PR ALREADY ON MAIN? (9 Nov 2026, approvalprep #80: land lost the network mid-merge,
 * c8833d7 "… (#80)" was on main, the row said land_refused and the PR stayed open.) `commits` are
 * main's newest commits as { sha, subject }. Returns the sha that carries it — the head itself, or a
 * squash commit whose subject ends "(#<number>)" — or null.
 */
export function mergedOnMain(pr, commits) {
  const num = Number(pr?.number);
  if (!Array.isArray(commits) || !Number.isInteger(num) || num <= 0) return null;
  const hit = commits.find(c => (pr.headRefOid && c?.sha === pr.headRefOid) || new RegExp(`\\(#${num}\\)\\s*$`).test(String(c?.subject ?? '')));
  return hit?.sha ?? null;
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
