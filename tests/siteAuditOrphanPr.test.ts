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
