import { expect, it } from 'vitest';
import { followUpDue, nextTouchDueAt, startOfCentralDay, DAY_MS } from '../src/shared/boss/outreach/cadence.mjs';

const at = (iso: string) => Date.parse(iso);

it('a follow-up is due from the start of its Central day, so a daily run a few seconds early still sends it', () => {
  // Email 1 on Fri 6 Nov, email 2 sent Tue 10 Nov at 09:31:10 CT; email 3 is due three days later.
  const p = { touches: 2, firstSentAt: at('2026-11-06T09:30:20-06:00'), lastTouchAt: at('2026-11-10T09:31:10-06:00') };
  // Friday's run reads its plan five seconds BEFORE the exact three-day mark: it must still be due.
  expect(followUpDue(p, at('2026-11-13T09:31:05-06:00'))).toBe(3);
  expect(nextTouchDueAt(p)).toBe(at('2026-11-13T00:00:00-06:00'));
  // The gap is still three calendar days: nothing goes on Thursday, however late in the day.
  expect(followUpDue(p, at('2026-11-12T23:59:59-06:00'))).toBeNull();
});

it('the day starts at Central midnight on both sides of a clock change', () => {
  expect(startOfCentralDay(at('2026-07-04T15:20:30.250-05:00'))).toBe(at('2026-07-04T00:00:00-05:00'));
  expect(startOfCentralDay(at('2026-12-01T00:00:00-06:00'))).toBe(at('2026-12-01T00:00:00-06:00'));
  expect(startOfCentralDay(at('2026-12-01T23:59:59.999-06:00')) + DAY_MS).toBe(at('2026-12-02T00:00:00-06:00'));
});
