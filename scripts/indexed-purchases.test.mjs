import assert from 'node:assert/strict';
import test from 'node:test';
import { archivedPurchaseLogs, indexedPurchaseLogs } from './indexed-purchases.mjs';

const wallet = '0x0000000000000000000000000000000000000001';
const transfer = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const log = { topics: [transfer, 'sender', `0x${'1'.padStart(64, '0')}`] };
const tx = (block, value = '1') => ({ hash: `tx-${block}`, block_number: block, value, from: { hash: wallet } });

test('historical catch-up uses outgoing Transactions and confirmed RPC receipts, with a conservative head', async () => {
  const receipts = [];
  const getJson = async (url) => {
    if (url.endsWith('/stats')) return { total_blocks: '100' };
    assert.ok(url.includes('/transactions?filter=from'));
    if (url.includes('page=2')) return { items: [tx(91), tx(89)], next_page_params: { page: 3 } };
    return { items: [tx(101), tx(99), tx(98, '0')], next_page_params: { filter: 'from', page: 2 } };
  };
  const result = await indexedPurchaseLogs(getJson, async (_, [hash]) => {
    receipts.push(hash);
    return { blockNumber: `0x${Number(hash.slice(3)).toString(16)}`, status: '0x1', logs: [log, { topics: [transfer, 'sender', 'another-wallet'] }] };
  }, wallet, 90, 105);
  assert.equal(result.throughBlock, 99);
  assert.deepEqual(receipts, ['tx-91', 'tx-99']);
  assert.equal(result.logs.length, 2);
});

test('indexer failures, pagination loops and inconsistent receipts never advance a cursor silently', async () => {
  await assert.rejects(indexedPurchaseLogs(async () => ({}), () => {}, wallet, 1, 10), /height/);
  const getJson = async (url) => url.endsWith('/stats') ? { total_blocks: '100' }
    : { items: [tx(90)], next_page_params: { filter: 'from' } };
  await assert.rejects(indexedPurchaseLogs(getJson, () => {}, wallet, 1, 100), /pagination/);
  const onePage = async (url) => url.endsWith('/stats') ? { total_blocks: '100' } : { items: [tx(90)] };
  await assert.rejects(indexedPurchaseLogs(onePage, async () => null, wallet, 1, 100), /Missing receipt/);
  await assert.rejects(indexedPurchaseLogs(onePage, async () => ({ blockNumber: '0x1' }), wallet, 1, 100), /mismatch/);
});

test('a public historical archive applies only to its wallet and covered interval, with RPC confirmation', async () => {
  const archive = { wallet, firstBlock: 1, throughBlock: 99, transactions: [tx(90), tx(95, '0')] };
  let calls = 0;
  const rpc = async () => { calls++; return { blockNumber: '0x5a', status: '0x1', logs: [log] }; };
  const result = await archivedPurchaseLogs(rpc, wallet, 80, 105, archive);
  assert.equal(result.throughBlock, 99);
  assert.equal(result.logs.length, 1);
  assert.equal(calls, 1);
  assert.equal(await archivedPurchaseLogs(rpc, wallet, 100, 105, archive), null);
  assert.equal(await archivedPurchaseLogs(rpc, wallet, 0, 105, archive), null);
  assert.equal(await archivedPurchaseLogs(rpc, 'another-wallet', 80, 105, archive), null);
  await assert.rejects(archivedPurchaseLogs(async () => null, wallet, 80, 105, archive), /Missing receipt/);
});
