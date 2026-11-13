import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { READERS } from '../scripts/ops/lib/scorecard-readers.mjs';
import { judge } from '../src/shared/boss/scorecard/scorecard.mjs';

it('ApprovalPrep phone app: waits for launch, never judges a missing count as zero, and judges kit purchases against its floors', async () => {
  const manifest = JSON.parse(readFileSync(new URL('../src/shared/boss/scorecard/manifest.json', import.meta.url), 'utf8'));
  const row = manifest.rows.find((r: any) => r.id === 'ap-phone-app');
  expect(row).toBeDefined();
  const now = Date.parse('2027-03-01T12:00:00Z');
  const read = async (report: object | null) => {
    const ctx = { now, gh: () => { if (!report) throw Error('404'); return JSON.stringify(report); } };
    const one = async (metric: any): Promise<{ raw: string | number | null; error?: string }> => { try { return await READERS['repo-json']!(metric.params, ctx); } catch (e) { return { raw: null, error: String((e as Error).message) }; } };
    return { started: await one(row.startWhen), first: await one(row.first), real: await one(row.real) };
  };
  // Before the app's files are on the default branch the source is a visible stop, not a pass.
  expect((await read(null)).first.error).toMatch(/REPORT_MISSING/);
  // Before launch: the clock has not started and empty counts are unknown, not zero.
  const waiting = await read({ at: null, launchedOn: null, installs30: null, kitPurchases30: null, kitPurchases60: null });
  expect(waiting.started.raw).toBeNull();
  expect(waiting.first.raw).toBeNull();
  expect(waiting.first.error).toMatch(/SOURCE_STALE/);
  expect(judge({ row, record: null, reading: waiting, today: '2027-03-01' }).state).toBe('Too early');
  // After launch the purchase counts are judged: 3 by day 30, 10 by day 60.
  const live = { at: '2027-02-28T09:00:00Z', launchedOn: '2027-01-25', installs30: 140, kitPurchases30: 2, kitPurchases60: 2 };
  const missed = await read(live);
  expect(missed.started.raw).toBe('2027-01-25');
  expect(missed.first.raw).toBe(2);
  expect(judge({ row, record: null, reading: missed, today: '2027-02-24' }).state).toBe('Trying version B');
  expect(judge({ row, record: null, reading: await read({ ...live, kitPurchases30: 3 }), today: '2027-02-24' }).state).toBe('On track');
  expect([row.first.by, row.first.floor.value, row.real.by, row.real.floor.value]).toEqual([30, 3, 60, 10]);
  // A stale count is not a number.
  expect((await read({ ...live, at: '2027-01-30T09:00:00Z' })).first.error).toMatch(/SOURCE_STALE/);
});
