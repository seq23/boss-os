import { it, expect } from 'vitest';
import { orphanVerdict, blockedStopSentence } from '../src/shared/boss/searchReadiness/orphanPr.mjs';
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
