import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestLimiter } from './request-limiter.mjs';

test('RPC requests are paced and share a Retry-After pause', async () => {
  let time = 1000;
  const waits = [];
  const limiter = createRequestLimiter({ intervalMs: 250, now: () => time, sleep: async (ms) => { waits.push(ms); time += ms; } });
  await limiter.wait();
  await limiter.wait();
  await limiter.wait();
  assert.deepEqual(waits, [250, 250]);
  limiter.backoff(2000);
  await limiter.wait();
  assert.equal(waits.at(-1), 2000);
  await limiter.wait();
  assert.equal(waits.at(-1), 250);
});

test('a backoff received while waiting invalidates an already reserved slot', async () => {
  let time = 1000;
  const waits = [];
  const limiter = createRequestLimiter({ intervalMs: 250, now: () => time, sleep: async (ms) => {
    waits.push(ms);
    if (waits.length === 1) limiter.backoff(1000);
    time += ms;
  } });
  await limiter.wait();
  await limiter.wait();
  assert.deepEqual(waits, [250, 750]);
  assert.equal(time, 2000);
});
