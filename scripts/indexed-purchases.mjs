const API = 'https://robinhoodchain.blockscout.com/api/v2';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// Use the Transactions tab, not Token Transfers, to catch up a large historical gap.
// The conservative indexer head prevents advancing over transactions not indexed yet.
export async function indexedPurchaseLogs(getJson, rpc, wallet, firstBlock, latestBlock) {
  const stats = await getJson(`${API}/stats`);
  const indexedCount = Number(stats.total_blocks);
  if (!Number.isSafeInteger(indexedCount) || indexedCount <= 0) throw new Error('Invalid indexer block height');
  const throughBlock = Math.min(latestBlock, indexedCount - 1);
  if (throughBlock < firstBlock) return { logs: [], throughBlock: firstBlock - 1 };
  const transactions = new Map();
  let params = { filter: 'from' };
  const visited = new Set();
  while (params) {
    const query = new URLSearchParams(params).toString();
    if (visited.has(query)) throw new Error('Indexer pagination did not advance');
    visited.add(query);
    const page = await getJson(`${API}/addresses/${wallet}/transactions?${query}`);
    if (!Array.isArray(page.items)) throw new Error('Invalid indexer transactions response');
    let crossedBoundary = false;
    for (const transaction of page.items) {
      if (transaction.block_number == null) continue; // Pending transactions must be checked next time.
      const block = Number(transaction.block_number);
      if (!Number.isSafeInteger(block)) throw new Error('Invalid indexed transaction block');
      if (block < firstBlock) crossedBoundary = true;
      if (block < firstBlock || block > throughBlock) continue;
      if (transaction.from?.hash?.toLowerCase() !== wallet.toLowerCase()) throw new Error('Indexer returned another sender');
      if (BigInt(transaction.value ?? '0') > 0n) transactions.set(transaction.hash, transaction);
    }
    params = crossedBoundary ? null : page.next_page_params;
    if (page.items.length === 0 && params) throw new Error('Indexer returned an empty page with continuation');
  }

  return { logs: await confirmedTransfers(rpc, wallet, [...transactions.values()]), throughBlock };
}

export async function archivedPurchaseLogs(rpc, wallet, firstBlock, latestBlock, archive) {
  if (archive.wallet?.toLowerCase() !== wallet.toLowerCase()
    || !Number.isSafeInteger(archive.firstBlock) || !Number.isSafeInteger(archive.throughBlock)
    || archive.firstBlock > firstBlock || archive.throughBlock < firstBlock
    || !Array.isArray(archive.transactions)) return null;
  const throughBlock = Math.min(latestBlock, archive.throughBlock);
  const transactions = archive.transactions.filter((transaction) =>
    transaction.block_number >= firstBlock && transaction.block_number <= throughBlock);
  return { logs: await confirmedTransfers(rpc, wallet, transactions), throughBlock };
}

async function confirmedTransfers(rpc, wallet, transactions) {
  const logs = [];
  const walletTopic = `0x${wallet.slice(2).toLowerCase().padStart(64, '0')}`;
  for (const transaction of transactions.sort((a, b) => a.block_number - b.block_number)) {
    if (transaction.from?.hash?.toLowerCase() !== wallet.toLowerCase()) throw new Error('Indexed sender mismatch');
    if (BigInt(transaction.value ?? '0') <= 0n) continue;
    const receipt = await rpc('eth_getTransactionReceipt', [transaction.hash]);
    if (!receipt) throw new Error(`Missing receipt for ${transaction.hash}`);
    if (Number(BigInt(receipt.blockNumber)) !== Number(transaction.block_number)) throw new Error('Indexer/RPC block mismatch');
    if (BigInt(receipt.status ?? '0x0') !== 1n) continue;
    logs.push(...(receipt.logs ?? []).filter((log) =>
      log.topics?.[0]?.toLowerCase() === TRANSFER && log.topics?.[2]?.toLowerCase() === walletTopic));
  }
  return logs;
}
