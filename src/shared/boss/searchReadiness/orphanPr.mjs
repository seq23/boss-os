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

/** The land outcomes that are a named gate refusing a finished fix, never a stall. */
export const GATE_LANDS = Object.freeze(['land_refused', 'clickthrough_failed', 'held_owner_approval', 'held_client_approval']);
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;
const namedStop = (detail) => /NAMED STOP \[([A-Z0-9_]+)\]/.exec(String(detail ?? '').replace(ANSI, ''))?.[1] ?? '';

/**
 * THE STOP ONE ROW RECORDS (rebuilt 25 Nov 2026). Each row carries the stop written where it happened:
 * landAll writes every land outcome (`land`, and a NAMED STOP in `land_detail` for land's gates,
 * including its review gate: REVIEW_CLASS_MISSING / REVIEW_PASS_MISSING), orphanVerdict the reason an
 * open PR is blocked, policy a row it refused before any PR existed. This reads that record; it never
 * guesses from the round's shape. Kinds:
 *  - 'skip'    the lane refused it by policy and there is no PR: nothing to land, so no evidence;
 *  - 'gate'    a finished fix a named land gate refused (`code` names it; a land_refused counts only
 *              when land's refusal was named: a red check or a network blip is not a gate);
 *  - 'open'    an in-flight PR still open and blocked (`line` says by what);
 *  - 'merged'  an in-flight PR already merged or landed (the fix is on main);
 *  - 'landed'  a PR this round fixed and landed;
 *  - 'unexplained' anything else, which keeps the round a genuine stall.
 */
export function rowStop(r) {
  const hasPr = PR_URL.test(r.pr_url ?? '');
  if (r.disposition === 'in_flight' && !hasPr && r.land === 'blocked' && /^refused_policy/.test(String(r.land_detail ?? ''))) return { kind: 'skip' };
  if (!['fixed_pr', 'in_flight'].includes(r.disposition) || !hasPr) return { kind: 'unexplained' };
  if (r.disposition === 'fixed_pr') {
    if (DONE_LANDS.includes(r.land)) return { kind: 'landed' };
    const code = GATE_LANDS.includes(r.land) ? (namedStop(r.land_detail) || (r.land === 'land_refused' ? '' : r.land)) : '';
    return code ? { kind: 'gate', code } : { kind: 'unexplained' };
  }
  if (DONE_LANDS.includes(r.land)) return { kind: 'merged' };
  if (r.land === 'blocked') return { kind: 'open', line: `${r.pr_url}: ${r.land_detail ?? 'unverified PR'}` };
  return { kind: 'unexplained' };
}

/**
 * WHY A ROUND FIXED NOTHING: one reduction over each row's own stop (rowStop). Rebuilt 25 Nov 2026
 * after four shape-guarded branches (5, 7, 9, 17 Nov) each had to be taught the next case and the
 * 25 Nov round (42 fixes refused by land's review gate, 3 policy rows with no PR) fell through all
 * of them to "fixed nothing". Returns { code, sentence }:
 *  - any row unexplained, or no row left -> { code: '', sentence: '' }: a genuine SR_QUEUE_STALLED;
 *  - a gate refused a finished fix (every other row landed, merged or open) -> SR_LAND_GATE_UNMET,
 *    each PR and its gate named (17 Nov detoxdenver NOT_CLICKED_THROUGH; 25 Nov REVIEW_CLASS_MISSING);
 *  - a fixed PR landed and nothing gated -> '' (the land worked; why the brief stayed is not a stop);
 *  - an open PR blocked (the rest merged) -> SR_BLOCKED_BY_OPEN_PRS (9 Nov);
 *  - every PR merged -> SR_AWAITING_HOST_PUBLISH (7 Nov: Lovable had not republished heygetonmylevel).
 */
export function fixedNothingCause(rows) {
  const none = { code: '', sentence: '' };
  const stops = rows.filter(r => r.disposition !== 'none').map(r => ({ r, s: rowStop(r) })).filter(x => x.s.kind !== 'skip');
  if (!stops.length || stops.some(x => x.s.kind === 'unexplained')) return none;
  const of = (kind) => stops.filter(x => x.s.kind === kind);
  if (of('gate').length) return { code: 'SR_LAND_GATE_UNMET', sentence: [...new Set(of('gate').map(x => `${x.r.pr_url} refused by ${x.s.code}`))].join('; ') };
  if (of('landed').length) return none;
  if (of('open').length) return { code: 'SR_BLOCKED_BY_OPEN_PRS', sentence: [...new Set(of('open').map(x => x.s.line))].join('; ') };
  const prs = [...new Set(stops.map(x => x.r.pr_url))];
  const repos = [...new Set(stops.map(x => String(x.r.repo ?? '').split('/').pop()).filter(Boolean))];
  return {
    code: 'SR_AWAITING_HOST_PUBLISH',
    sentence: `the fixes are merged (${prs.join(', ')}) but the live site has not been republished${repos.length ? ` (${repos.join(', ')})` : ''}`,
  };
}
