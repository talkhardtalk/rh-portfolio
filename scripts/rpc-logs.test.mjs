import assert from 'node:assert/strict';
import test from 'node:test';
import { getLogsInRange } from './rpc-logs.mjs';

test('30,000-block inclusive ranges cover the whole gap without overlap', async () => {
  const ranges = [];
  const logs = await getLogsInRange(async (method, [filter]) => {
    assert.equal(method, 'eth_getLogs');
    assert.deepEqual(filter.topics, ['transfer', null, 'wallet']);
    const from = Number(BigInt(filter.fromBlock));
    const to = Number(BigInt(filter.toBlock));
    ranges.push([from, to]);
    return [{ block: from }];
  }, { topics: ['transfer', null, 'wallet'] }, 81_026_997, 81_126_997);
  ranges.sort((a, b) => a[0] - b[0]);
  assert.equal(ranges[0][0], 81_026_997);
  assert.equal(ranges.at(-1)[1], 81_126_997);
  for (let index = 0; index < ranges.length; index++) {
    assert.ok(ranges[index][1] - ranges[index][0] + 1 <= 30_000);
    if (index) assert.equal(ranges[index][0], ranges[index - 1][1] + 1);
  }
  assert.deepEqual(logs.map((log) => log.block), ranges.map(([from]) => from));
});

test('a stricter provider limit splits ranges, retaining every block once', async () => {
  const logs = await getLogsInRange(async (_, [filter]) => {
    const from = Number(BigInt(filter.fromBlock));
    const to = Number(BigInt(filter.toBlock));
    if (to - from + 1 > 3) throw new Error('query spans too many blocks; narrow the block range');
    return Array.from({ length: to - from + 1 }, (_, index) => from + index);
  }, {}, 1, 10, { maxBlockRange: 8, concurrency: 2 });
  assert.deepEqual(logs, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('bounded concurrency, deterministic output and no scan for an empty range', async () => {
  let active = 0;
  let peak = 0;
  const logs = await getLogsInRange(async (_, [filter]) => {
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    return [Number(BigInt(filter.fromBlock))];
  }, {}, 1, 9, { maxBlockRange: 1, concurrency: 3 });
  assert.equal(peak, 3);
  assert.deepEqual(logs, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(await getLogsInRange(() => assert.fail('must not call RPC'), {}, 2, 1), []);
});

test('network, authentication and single-block errors are not swallowed or split forever', async () => {
  for (const message of ['401 Unauthorized', 'timeout', 'block range too large']) {
    await assert.rejects(getLogsInRange(async () => { throw new Error(message); }, {}, 1, 1), { message });
  }
  await assert.rejects(getLogsInRange(async () => null, {}, 1, 2), /non-array/);
  await assert.rejects(getLogsInRange(async () => [], {}, 1, 2, { concurrency: 0 }), /Invalid/);
});
