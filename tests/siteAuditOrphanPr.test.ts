import { it, expect } from 'vitest';
import { orphanVerdict, blockedStopSentence, fixedNothingCause } from '../src/shared/boss/searchReadiness/orphanPr.mjs';
// @ts-expect-error Node-only ops module has no declaration.
import { landAll } from '../scripts/ops/site-audit-lib.mjs';
const row = { repo: 'approvalprep', disposition: 'in_flight', pr_url: 'https://github.com/seq23/approvalprep/pull/1' };
const sites = [{ repo: row.repo, domain: 'example.test' }];
const green = { state: 'OPEN', headRefName: 'danielle/site-audit-123', isDraft: false, statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }] };
it('recovers only green non-draft PRs of our lane and honours policy holds', () => {
  const verdict = (pr: any, extra: any = {}) => orphanVerdict(row, pr, { sites, ...extra });
  expect(verdict(green)).toBe('land');
  const blocked = { ...row, land: 'blocked', land_detail: 'draft_left_behind' };
  expect(blockedStopSentence([blocked, { disposition: 'none' }])).toContain('draft_left_behind');
  expect(blockedStopSentence([blocked, { disposition: 'surfaced' }])).toBe('');
  expect(blockedStopSentence([])).toBe('');
  expect(verdict({ ...green, state: 'MERGED' })).toBe('already_merged');
  expect(verdict({ ...green, isDraft: true })).toBe('draft_left_behind');
  expect(verdict({ ...green, headRefName: 'work/other' })).toBe('another_lane');
  expect(verdict({ ...green, statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] })).toBe('checks_red');
  expect(verdict({ ...green, statusCheckRollup: [] })).toBe('checks_red');
  expect(verdict(green, { sites: [{ ...sites[0], client_approval: true }] })).toBe('client_approval');
  expect(verdict(green, { sites: [{ ...sites[0], owner_approval: true }] })).toBe('owner_approval');
  expect(orphanVerdict({ ...row, pr_url: 'https://github.com/other/approvalprep/pull/1' }, green, { sites })).toBe('refused_policy');
});
it('lands through the existing door once per PR; blocked and merged PRs never reach it', () => {
  for (const pr of [green, { ...green, isDraft: true }, { ...green, state: 'MERGED' }, { ...green, headRefName: 'work/other' }, { ...green, statusCheckRollup: [] }]) {
    const calls: string[] = [];
    const payload: any = { findings: [{ ...row }, { ...row }] };
    landAll(payload, { sites, run: (cmd: string, args: string[]) => { calls.push([cmd, ...args].join(' ')); return { status: 0, out: cmd === 'gh' ? JSON.stringify(pr) : 'ok' }; }, landBin: '/test/land' });
    expect(calls.filter(c => c.includes('/test/land'))).toHaveLength(pr === green ? 1 : 0);
    expect(payload.findings[0].land).toBe(pr === green ? 'landed' : pr.state === 'MERGED' ? 'already_merged' : 'blocked');
  }
});

it('7 Nov 2026: a MERGED PR is already_merged whoever opened it, never another_lane or blocked', () => {
  expect(orphanVerdict(row, { ...green, state: 'MERGED', headRefName: 'fix/sr-heygetonmylevel-6nov' }, { sites })).toBe('already_merged');
  // NEGATIVE: an OPEN PR off another branch is still refused.
  expect(orphanVerdict(row, { ...green, headRefName: 'fix/sr-heygetonmylevel-6nov' }, { sites })).toBe('another_lane');
  // The pre-fetch probe (no PR yet) still asks for the PR to be read.
  expect(orphanVerdict(row, null, { sites })).toBe('another_lane');
  const payload: any = { findings: [{ ...row }] };
  landAll(payload, { sites, run: (cmd: string) => ({ status: 0, out: cmd === 'gh' ? JSON.stringify({ ...green, state: 'MERGED', headRefName: 'work/other' }) : 'ok' }), landBin: '/test/land' });
  expect(payload.findings[0].land).toBe('already_merged');
});
it('fixedNothingCause names an all-merged round, a blocked round, and nothing else', () => {
  const m = { ...row, land: 'already_merged' };
  expect(fixedNothingCause([m, { ...m, pr_url: 'https://github.com/seq23/approvalprep/pull/2' }]).code).toBe('SR_AWAITING_HOST_PUBLISH');
  expect(fixedNothingCause([m]).sentence).toContain('pull/1');
  expect(fixedNothingCause([{ ...row, land: 'blocked', land_detail: 'checks_red' }, m])).toMatchObject({ code: 'SR_BLOCKED_BY_OPEN_PRS', sentence: expect.stringContaining('checks_red') });
  expect(fixedNothingCause([]).code).toBe('');
  expect(fixedNothingCause([m, { disposition: 'surfaced' }]).code).toBe('');
  expect(fixedNothingCause([{ ...row }]).code).toBe('');
});

/*
 * THE DEADLOCK (9 Nov 2026): seven danielle/site-audit-* PRs sat 4-6 days. Each guard below is
 * proved negatively next to its positive case, and each fails on zero items.
 */
import { NEEDS_WORKER, clientApprovalHold, mergedOnMain } from '../src/shared/boss/searchReadiness/orphanPr.mjs';
// @ts-expect-error Node-only ops module has no declaration.
import { ownOpenPrs, staleGridHandoff } from '../scripts/ops/site-audit-lib.mjs';

it('cause 1+2: a draft or a conflicting own-lane PR is work for the next pass, listed first; a green one lands', () => {
  const v = (pr: any) => orphanVerdict(row, pr, { sites });
  expect(v({ ...green, isDraft: true })).toBe('draft_left_behind');
  expect(v({ ...green, mergeable: 'CONFLICTING' })).toBe('conflicting');
  expect(v({ ...green, mergeable: 'MERGEABLE' })).toBe('land');
  for (const x of ['draft_left_behind', 'conflicting', 'checks_red']) expect(NEEDS_WORKER).toContain(x);
  expect(NEEDS_WORKER).not.toContain('land');
  const listed = ownOpenPrs([
    { url: 'u1', headRefName: 'danielle/site-audit-1', isDraft: true, state: 'OPEN', title: 't1' },
    { url: 'u2', headRefName: 'danielle/site-audit-2', isDraft: false, mergeable: 'CONFLICTING', state: 'OPEN', title: 't2' },
    { url: 'u3', headRefName: 'fix/someone-else', isDraft: true, state: 'OPEN', title: 't3' },
  ]);
  expect(listed.length).toBeGreaterThan(0);
  expect(listed.map((p: any) => [p.url, p.why])).toEqual([['u1', 'draft_left_behind'], ['u2', 'conflicting']]);
  expect(ownOpenPrs([])).toEqual([]);
});

const horse = { repo: 'horse-legal-guide-velocity', domain: 'horse.test', client_approval: 'new posts wait', client_approval_queue_files: ['data/site_changes/queue.json'], client_approval_new_post_paths: ['content/', 'questions/', 'dist/'], client_approval_draft_paths: ['content/drafts/'], client_approval_record_files: ['data/system/editorial_backlog.json'] };
const hrow = { repo: horse.repo, disposition: 'in_flight', pr_url: `https://github.com/seq23/${horse.repo}/pull/78` };
const q = (changes: any[]) => JSON.stringify({ changes });
const approvedOne = { id: 'a', status: 'approved', title: 'live' };
const staged = { id: 'b', status: 'pending', title: 'waits for the owners' };
/*
 * NEW POSTS WAIT FOR THE CLIENT; FIXES SHIP (owner, 9 Nov 2026), replacing the 3 Nov "every live change
 * waits" reading that held Horse fix PRs. Both land paths (an orphan in_flight PR, a fixed_pr row).
 */
it('cause 3: on a client_approval site a fix PR lands; a new post, an approval change or an unread PR is held', () => {
  const QF = 'data/site_changes/queue.json';
  const mod = (path: string) => ({ path, status: 'modified' });
  const add = (path: string) => ({ path, status: 'added' });
  const hold = (files: any[] | null, contents: any = {}) => clientApprovalHold(horse, { files, contents });
  expect(hold([mod('scripts/lib/render_page.js'), mod('content/scenarios/a.md'), mod('dist/scenario/a/index.html')])).toBe('');
  expect(hold([add('content/drafts/generated/2027-03-04__new.md')])).toBe('');
  expect(hold([mod(QF)], { [QF]: { base: q([approvedOne]), head: q([approvedOne, staged]) } })).toBe('');
  // NEGATIVE: each of these waits, with its reason.
  expect(hold([mod('scripts/lib/render_page.js'), add('content/scenarios/new-post.md')])).toMatch(/^adds a new post \(content\/scenarios\/new-post\.md\)/);
  expect(hold([add('questions/new-q/index.html')])).toMatch(/^adds a new post/);
  expect(hold([{ path: 'content/hubs/x.md', status: 'renamed' }])).toMatch(/^adds a new post/);
  expect(hold([mod('data/system/editorial_backlog.json')])).toMatch(/approval record/);
  expect(hold([mod(QF)], { [QF]: { base: q([staged]), head: q([{ ...staged, status: 'approved' }]) } })).toMatch(/approved entry/);
  expect(hold([mod(QF)], { [QF]: { base: undefined, head: q([staged]) } })).toMatch(/approved entry/);
  expect(hold(null)).toMatch(/unclear/);
  expect(hold([])).toMatch(/unclear/);
  expect(clientApprovalHold({ ...horse, client_approval_new_post_paths: undefined }, { files: [mod('a.js')] })).toMatch(/unclear/);
  expect(orphanVerdict(hrow, green, { sites: [horse] })).toBe('client_approval');
  // Through landAll, both paths: the file list (and touched queue files) read from GitHub, then land.
  const run = (disposition: string, files: any[] | null) => {
    const calls: string[] = [];
    const payload: any = { findings: [{ ...hrow, disposition }] };
    landAll(payload, { sites: [horse], parked: () => false, landBin: '/test/land', run: (cmd: string, args: string[]) => {
      calls.push([cmd, ...args].join(' '));
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view') return { status: 0, out: JSON.stringify({ ...green, baseRefName: 'main', headRefOid: 'h1' }) };
      if (cmd === 'gh' && args[0] === 'api' && String(args[1]).includes('/pulls/')) return files ? { status: 0, out: files.map(f => `${f.status}\t${f.path}`).join('\n') } : { status: 1, out: 'HTTP 502' };
      if (cmd === 'gh' && args[0] === 'api') return { status: 0, out: String(args[1]).endsWith('ref=main') ? q([approvedOne]) : q([approvedOne, staged]) };
      return { status: 0, out: 'ok' };
    } });
    return { land: payload.findings[0].land, lands: calls.filter(c => c.includes('/test/land')).length };
  };
  for (const d of ['in_flight', 'fixed_pr']) {
    expect(run(d, [mod('scripts/build/write_public_indexes.js'), mod('content/scenarios/a.md')])).toEqual({ land: 'landed', lands: 1 });
    expect(run(d, [mod(QF)])).toEqual({ land: 'landed', lands: 1 });
    expect(run(d, [add('content/scenarios/new-post.md')])).toEqual({ land: d === 'fixed_pr' ? 'held_client_approval' : 'blocked', lands: 0 });
    expect(run(d, null)).toEqual({ land: d === 'fixed_pr' ? 'held_client_approval' : 'blocked', lands: 0 });
  }
});

it('cause 4: a land refusal for a PR already on main is already_merged and the leftover PR is closed', () => {
  const commits = [{ sha: 'c8833d7aaaa', subject: 'fix: repair malformed mortgage underwriting citation at source (#80)' }, { sha: 'b0', subject: 'other (#79)' }];
  expect(mergedOnMain({ number: 80, headRefOid: 'zzz' }, commits)).toBe('c8833d7aaaa');
  expect(mergedOnMain({ number: 8, headRefOid: 'zzz' }, commits)).toBeNull();
  expect(mergedOnMain({ number: 81, headRefOid: 'b0' }, commits)).toBe('b0');
  expect(mergedOnMain({ number: 80 }, [])).toBeNull();
  const attempt = (onMain: boolean) => {
    const calls: string[] = [];
    const payload: any = { findings: [{ ...row, disposition: 'fixed_pr', pr_url: 'https://github.com/seq23/approvalprep/pull/80' }] };
    landAll(payload, { sites, parked: () => false, landBin: '/test/land', run: (cmd: string, args: string[]) => {
      calls.push([cmd, ...args].join(' '));
      if (args.includes('/test/land')) return { status: 1, out: 'STOPPED: could not verify (network)' };
      if (cmd === 'gh' && args.includes('.state')) return { status: 0, out: 'OPEN\n' };
      if (cmd === 'gh' && args[1] === 'view') return { status: 0, out: JSON.stringify({ number: 80, headRefOid: 'a74f', baseRefName: 'main' }) };
      if (cmd === 'gh' && args[0] === 'api') return { status: 0, out: JSON.stringify(onMain ? commits : commits.slice(1)) };
      return { status: 0, out: 'ok' };
    } });
    return { land: payload.findings[0].land, closed: calls.filter(c => c.startsWith('gh pr close')).length };
  };
  expect(attempt(true)).toEqual({ land: 'already_merged', closed: 1 });
  // NEGATIVE: not on main stays a refusal, and nothing is closed.
  expect(attempt(false)).toEqual({ land: 'land_refused', closed: 0 });
});

it('cause 5: a stale grid PR of our lane open >24h is acted on; fresh, foreign and closed ones are not', () => {
  const now = Date.parse('2026-11-09T14:00:00Z');
  const inbox = [
    'seq23/approvalprep\tpr_stale\thttps://github.com/seq23/approvalprep/pull/1\ttsk\tdraft, 3 days',
    'seq23/approvalprep\tpr_stale\thttps://github.com/seq23/approvalprep/pull/2\ttsk\tgreen, 3 days',
    'seq23/approvalprep\tpr_stale\thttps://github.com/seq23/approvalprep/pull/3\ttsk\tfresh',
    'seq23/approvalprep\tpr_stale\thttps://github.com/seq23/approvalprep/pull/4\ttsk\tanother lane',
    'seq23/approvalprep\tci_red\thttps://github.com/seq23/approvalprep/actions/runs/5\ttsk\tnot a PR',
  ].join('\n');
  const old = '2026-11-05T10:00:00Z', fresh = '2026-11-09T10:00:00Z';
  const prs: Record<string, any> = {
    1: { ...green, isDraft: true, createdAt: old }, 2: { ...green, createdAt: old },
    3: { ...green, isDraft: true, createdAt: fresh }, 4: { ...green, headRefName: 'fix/other', createdAt: old },
  };
  const pr = (url: string) => prs[/pull\/(\d+)/.exec(url)![1] ?? ''];
  const calls: string[] = [];
  const { lines, rearm } = staleGridHandoff(inbox, { now, sites, parked: () => false, landBin: '/test/land', view: pr, run: (cmd: string, args: string[]) => {
    calls.push([cmd, ...args].join(' '));
    return { status: 0, out: cmd === 'gh' ? JSON.stringify(pr(args.find(a => a.includes('/pull/')) ?? '')) : 'ok' };
  } });
  expect(lines.length).toBe(2);
  expect(lines[0]).toMatch(/pull\/1: blocked \(draft_left_behind\) -> the next Search Readiness pass finishes it/);
  expect(lines[1]).toMatch(/pull\/2: landed/);
  expect(rearm).toBe(true);
  expect(calls.filter(c => c.includes('/test/land'))).toHaveLength(1);
  // NEGATIVE: an inbox with only fresh, foreign or non-PR rows does nothing and says so.
  const none = staleGridHandoff(inbox.split('\n').slice(2).join('\n'), { now, sites, view: pr, run: () => { throw new Error('must not run'); } });
  expect(none.rearm).toBe(false);
  expect(none.lines).toEqual([expect.stringMatching(/^HANDOFF none:/)]);
});
