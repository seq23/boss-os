import { expect, it, vi } from "vitest";
import { resolveKey, NEVER_KEYS, runEightraiseProducer } from "../scripts/ops/lp-eightraise.mjs";

it("uses only her explicit vault names in order, writes unread failures before rejecting", async () => {
  expect(resolveKey({ EIGHTRAISE_API_KEY: 'first', EIGHTRAISE_SEQ_TAYLOR_API_KEY: 'second' })).toBe('first');
  expect(resolveKey({ EIGHTRAISE_SEQ_TAYLOR_API_KEY: 'second' })).toBe('second');
  for (const name of NEVER_KEYS) {
    expect(resolveKey({ [name]: 'other' })).toBeNull();
    expect(() => resolveKey({ [name]: 'other' }, [name])).toThrow(/ACCOUNT_REFUSED/);
  }
  const api = { get: vi.fn(async () => ({ used: 4 })), post: vi.fn(async () => ({})) };
  const write = vi.fn((_section: string, _body: { lines: string[] }) => 'test-file');
  await expect(runEightraiseProducer(api, { write, readBalance: () => { throw new Error('NAMED STOP [NO_8RAISE_KEY] no key'); } })).rejects.toThrow(/NO_8RAISE_KEY/);
  expect(write).toHaveBeenCalledOnce();
  expect(write.mock.calls[0]![1].lines).toHaveLength(2);
  expect(write.mock.calls[0]![1].lines[1]).toMatch(/not read/);
  expect(api.post).not.toHaveBeenCalled();
  await expect(runEightraiseProducer(api, { write, readBalance: () => '{"balance":null}' })).rejects.toThrow(/BALANCE_UNREADABLE/);
  await expect(runEightraiseProducer(api, { write, readBalance: () => '{"balance":100}' })).resolves.toBeUndefined();
  expect(write.mock.calls.at(-1)![1].lines).toHaveLength(1);
});
