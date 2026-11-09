// Keep unfiltered-address log requests within the public Robinhood RPC limit.
export async function getLogsInRange(rpc, filter, firstBlock, latestBlock, {
  maxBlockRange = 30_000,
  concurrency = 2,
} = {}) {
  if (![firstBlock, latestBlock, maxBlockRange, concurrency].every(Number.isSafeInteger)
    || firstBlock < 0 || latestBlock < 0 || maxBlockRange < 1 || concurrency < 1) {
    throw new Error('Invalid RPC block range or concurrency');
  }
  if (firstBlock > latestBlock) return [];
  let nextBlock = firstBlock;
  let stopped = false;
  const chunks = [];

  async function readChunk(fromBlock, toBlock) {
    try {
      const logs = await rpc('eth_getLogs', [{
        ...filter,
        fromBlock: `0x${fromBlock.toString(16)}`,
        toBlock: `0x${toBlock.toString(16)}`,
      }]);
      if (!Array.isArray(logs)) throw new Error('eth_getLogs returned a non-array response');
      return logs;
    } catch (error) {
      const rangeLimit = /query spans|block range|too many (?:logs|results)|response (?:size|too large)|(?:maximum|max).{0,30}blocks/i.test(error.message);
      if (!rangeLimit || fromBlock === toBlock) throw error;
      const middle = Math.floor((fromBlock + toBlock) / 2);
      const left = await readChunk(fromBlock, middle);
      const right = await readChunk(middle + 1, toBlock);
      return [...left, ...right];
    }
  }

  async function worker() {
    while (!stopped && nextBlock <= latestBlock) {
      const fromBlock = nextBlock;
      const toBlock = Math.min(fromBlock + maxBlockRange - 1, latestBlock);
      nextBlock = toBlock + 1;
      try {
        chunks.push({ fromBlock, logs: await readChunk(fromBlock, toBlock) });
      } catch (error) {
        stopped = true;
        throw error;
      }
    }
  }

  // Wait for every in-flight request before reporting failure; never return a partial scan.
  const results = await Promise.allSettled(Array.from({ length: concurrency }, worker));
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
  return chunks.sort((left, right) => left.fromBlock - right.fromBlock).flatMap((chunk) => chunk.logs);
}
