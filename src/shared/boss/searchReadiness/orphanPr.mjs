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
  // fix PR (anything but a new post) can be proved and landed; see clientApprovalHold.
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
  // NEW POSTS WAIT FOR THE CLIENT; FIXES SHIP (Horse, owner 9 Nov 2026): clientApprovalHold.
  if (related.some(s => s.client_approval && clientApprovalHold(s, pr.client_proof))) return 'client_approval';
  return 'land';
}

/** The orphan verdicts that are our own lane's unfinished work: the next pass finishes them. */
export const NEEDS_WORKER = Object.freeze(['draft_left_behind', 'conflicting', 'checks_red']);

/**
 * NEW POSTS WAIT FOR THE CLIENT; FIXES SHIP (owner, 9 Nov 2026: "the only thing that waits for the
 * horse owner's approval is new posts — any fixes I make get pushed without that"). Replaces the
 * 3 Nov reading that held every change to a live page, which held Horse fix PRs (#77/#78 could land
 * only by staging a queue item; any at-source fix stayed `client_approval`).
 * `proof` = { files: [{ path, status }] (GitHub's pulls/<n>/files), contents: { [queueFile]: { base, head } } }.
 * Returns '' when the PR may land, else the named reason it waits. Held when it:
 *  - ADDS a post or page (an added .md/.mdx/.html under `client_approval_new_post_paths`, outside
 *    `client_approval_draft_paths`, which only fill the queue);
 *  - changes an approval record (`client_approval_record_files`), which would publish without a yes;
 *  - changes an approved entry of a `client_approval_queue_files` file (staging new items is fine).
 * Unclear fails closed: no new-post paths declared, or the file list or a queue file unread.
 */
export function clientApprovalHold(site, proof) {
  const postPaths = Array.isArray(site?.client_approval_new_post_paths) ? site.client_approval_new_post_paths : [];
  if (!postPaths.length) return `${site?.domain ?? site?.repo}: no new-post paths declared, so whether the PR adds a new post is unclear`;
  const files = proof?.files;
  if (!Array.isArray(files) || !files.length || files.some(f => typeof f?.path !== 'string' || typeof f?.status !== 'string')) return "the PR's changed files could not be read, so whether it adds a new post is unclear";
  const under = (path, list) => (Array.isArray(list) ? list : []).some(x => path.startsWith(x));
  const posts = files.filter(f => ['added', 'renamed', 'copied'].includes(f.status) && /\.(md|mdx|html?)$/i.test(f.path) && under(f.path, postPaths) && !under(f.path, site.client_approval_draft_paths));
  if (posts.length) return `adds a new post (${posts.slice(0, 3).map(f => f.path).join(', ')}${posts.length > 3 ? ` +${posts.length - 3} more` : ''}): new posts wait for the client's approval queue`;
  const records = files.filter(f => (site.client_approval_record_files ?? []).includes(f.path));
  if (records.length) return `changes the approval record ${records.map(f => f.path).join(', ')}: only the client's approval changes it`;
  const queue = Array.isArray(site.client_approval_queue_files) ? site.client_approval_queue_files : [];
  for (const f of files.filter(x => queue.includes(x.path))) if (!approvedUnchanged(proof.contents?.[f.path])) return `changes an approved entry in ${f.path} (or it could not be read): approving is the client's`;
  return '';
}

/** A queue file's approved entries (`changes[]` with status "approved") are byte-identical before and after. Unread = false. */
function approvedUnchanged(c) {
  const approved = (text) => {
    const doc = JSON.parse(text);
    if (!Array.isArray(doc?.changes)) throw new Error('no changes[]');
    return JSON.stringify(doc.changes.filter(x => x?.status === 'approved').sort((a, b) => String(a.id).localeCompare(String(b.id))));
  };
  try { return typeof c?.head === 'string' && approved(c.head) === (c.base === null ? approved('{"changes":[]}') : approved(c.base)); } catch { return false; }
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
