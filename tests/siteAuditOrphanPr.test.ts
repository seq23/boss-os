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
import { NEEDS_WORKER, stagesQueueOnly, mergedOnMain } from '../src/shared/boss/searchReadiness/orphanPr.mjs';
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

const horse = { repo: 'horse-legal-guide-velocity', domain: 'horse.test', client_approval: 'owners approve', client_approval_queue_files: ['data/site_changes/queue.json'] };
const hrow = { repo: horse.repo, disposition: 'in_flight', pr_url: `https://github.com/seq23/${horse.repo}/pull/78` };
const q = (changes: any[]) => JSON.stringify({ changes });
const approvedOne = { id: 'a', status: 'approved', title: 'live' };
const staged = { id: 'b', status: 'pending', title: 'waits for the owners' };
it('cause 3: on a client_approval site only a queue-only PR with unchanged approved entries lands', () => {
  const proof = (files: string[], base: string | null, head: string | null) => ({ files, contents: Object.fromEntries(files.map(f => [f, { base, head }])) });
  const QF = 'data/site_changes/queue.json';
  expect(stagesQueueOnly(horse, proof([QF], q([approvedOne]), q([approvedOne, staged])))).toBe(true);
  expect(orphanVerdict(hrow, { ...green, queue_proof: proof([QF], q([approvedOne]), q([approvedOne, staged])) }, { sites: [horse] })).toBe('land');
  // NEGATIVE: flipping an item to approved, touching any other file, an unread or new file, or a
  // site with no declared queue file all stay held.
  expect(stagesQueueOnly(horse, proof([QF], q([approvedOne, staged]), q([approvedOne, { ...staged, status: 'approved' }])))).toBe(false);
  expect(stagesQueueOnly(horse, { files: [QF, 'scripts/lib/render_page.js'], contents: { [QF]: { base: q([]), head: q([staged]) } } })).toBe(false);
  expect(stagesQueueOnly(horse, proof([QF], null, q([staged])))).toBe(false);
  expect(stagesQueueOnly(horse, proof([QF], 'not json', q([staged])))).toBe(false);
  expect(stagesQueueOnly(horse, proof([], q([]), q([])))).toBe(false);
  expect(stagesQueueOnly({ ...horse, client_approval_queue_files: undefined }, proof([QF], q([]), q([staged])))).toBe(false);
  expect(orphanVerdict(hrow, green, { sites: [horse] })).toBe('client_approval');
  // Through landAll: the PR and both copies of the queue are read from GitHub, then land runs once.
  const run = (files: string[], base: string, head: string) => {
    const calls: string[] = [];
    const payload: any = { findings: [{ ...hrow }] };
    landAll(payload, { sites: [horse], landBin: '/test/land', run: (cmd: string, args: string[]) => {
      calls.push([cmd, ...args].join(' '));
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view') return { status: 0, out: JSON.stringify({ ...green, baseRefName: 'main', headRefOid: 'h1', files: files.map(path => ({ path })) }) };
      if (cmd === 'gh' && args[0] === 'api') return { status: 0, out: String(args[1]).endsWith('ref=main') ? base : head };
      return { status: 0, out: 'ok' };
    } });
    return { land: payload.findings[0].land, lands: calls.filter(c => c.includes('/test/land')).length };
  };
  expect(run([QF], q([approvedOne]), q([approvedOne, staged]))).toEqual({ land: 'landed', lands: 1 });
  expect(run([QF, 'scripts/build/write_public_indexes.js'], q([approvedOne]), q([approvedOne, staged]))).toEqual({ land: 'blocked', lands: 0 });
  expect(run([QF], q([staged]), q([{ ...staged, status: 'approved' }]))).toEqual({ land: 'blocked', lands: 0 });
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
