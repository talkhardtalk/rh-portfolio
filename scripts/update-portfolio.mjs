import fs from 'node:fs/promises';

const DATA_PATH = new URL('../data/portfolio.json', import.meta.url);
const CACHE_PATH = new URL('../data/portfolio-cache.json', import.meta.url);
const DEXSCREENER = 'https://api.dexscreener.com/token-pairs/v1/robinhood';
const ROBINHOOD_RPC = 'https://rpc.mainnet.chain.robinhood.com';
const UNISWAP_QUOTE_API = 'https://trade-api.gateway.uniswap.org/v1/quote';
const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const NATIVE_ETH = '0x0000000000000000000000000000000000000000';
const CHAIN_ID = '4663';
const QUOTE_CACHE_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const SALE_SCAN_BOOTSTRAP_BLOCK = 60_000_000;
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const portfolio = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));

async function restorePortfolioCache() {
  try {
    const cache = JSON.parse(await fs.readFile(CACHE_PATH, 'utf8'));
    portfolio.lastScannedBlock = cache.lastScannedBlock ?? portfolio.lastScannedBlock;
    portfolio.lastSaleScannedBlock = cache.lastSaleScannedBlock ?? portfolio.lastSaleScannedBlock;
    portfolio.walletNonce = cache.walletNonce ?? portfolio.walletNonce;
    portfolio.sourceTransactionCount = cache.sourceTransactionCount ?? portfolio.sourceTransactionCount;

    const currentByContract = new Map(portfolio.positions.map((item) => [item.contract.toLowerCase(), item]));
    const discoveredFields = [
      'name', 'symbol', 'bought', 'spentEth', 'sold', 'realizedProceedsEth', 'balance', 'balanceRaw',
      'purchaseDateLabel', 'purchaseDates', 'purchaseCount', 'entryEthUsd', 'exitEthUsd', 'confidence',
      'purchaseTxHashes', 'saleTxHashes', 'saleTransactions', 'discoverySource',
    ];
    const persistedPositionFields = [
      'sold', 'realizedProceedsEth', 'balance', 'balanceRaw', 'exitEthUsd',
      'saleTxHashes', 'saleTransactions',
    ];
    for (const cached of cache.positions ?? []) {
      const contract = cached.contract.toLowerCase();
      const current = currentByContract.get(contract);
      if (!current) {
        portfolio.positions.push(cached);
        currentByContract.set(contract, cached);
      } else {
        for (const field of persistedPositionFields) {
          if (cached[field] !== undefined) current[field] = cached[field];
        }
        if (cached.discoverySource === 'rpc-txs') {
          for (const field of discoveredFields) {
            if (cached[field] !== undefined) current[field] = cached[field];
          }
        }
      }
    }

    const cachedByContract = new Map(cache.positions.map((item) => [item.contract.toLowerCase(), item]));
    for (const position of portfolio.positions) {
      const cached = cachedByContract.get(position.contract.toLowerCase());
      const quoteAge = cached?.quoteAsOf ? Date.now() - Date.parse(cached.quoteAsOf) : Infinity;
      if (cached && quoteAge <= QUOTE_CACHE_MAX_AGE_MS) {
        position.currentValueEth = cached.currentValueEth;
        position.quoteProvider = cached.quoteProvider;
        position.quoteAsOf = cached.quoteAsOf;
      } else {
        position.currentValueEth = null;
        position.quoteProvider = null;
        position.quoteAsOf = null;
      }
    }
  } catch {
    for (const position of portfolio.positions) {
      position.currentValueEth = null;
      position.quoteProvider = null;
      position.quoteAsOf = null;
    }
  }
}

await restorePortfolioCache();

async function getJson(url, options = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          accept: 'application/json',
          'user-agent': 'RH-Portfolio/1.0 (+https://github.com)',
          ...options.headers,
        },
      });
      if (!response.ok) {
        const error = new Error(`${response.status} ${response.statusText}: ${url}`);
        error.status = response.status;
        throw error;
      }
      return response.json();
    } catch (error) {
      lastError = error;
      const shouldRetry = !error.status || error.status === 429 || error.status >= 500;
      if (!shouldRetry || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function rpc(method, params) {
  const response = await getJson(ROBINHOOD_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (response.error) throw new Error(`${method}: ${response.error.message}`);
  return response.result;
}

function decodeAbiString(value) {
  if (!value || value === '0x') return '';
  const bytes = Buffer.from(value.slice(2), 'hex');
  try {
    if (bytes.length >= 64) {
      const offset = Number(BigInt(`0x${bytes.subarray(0, 32).toString('hex')}`));
      const length = Number(BigInt(`0x${bytes.subarray(offset, offset + 32).toString('hex')}`));
      return bytes.subarray(offset + 32, offset + 32 + length).toString('utf8').replaceAll('\u0000', '').trim();
    }
  } catch {
    // Some older ERC-20 contracts return bytes32 rather than an ABI string.
  }
  return bytes.toString('utf8').replaceAll('\u0000', '').trim();
}

function tokenAmount(raw, decimals) {
  return Number(raw) / 10 ** decimals;
}

function nearlyEqual(left, right) {
  return Math.abs(left - right) <= Math.max(1e-12, Math.abs(right) * 1e-8);
}

function purchaseDate(timestamp) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Moscow',
  }).format(new Date(timestamp * 1000));
}

async function readTokenDetails(contract) {
  const walletArg = portfolio.wallet.slice(2).toLowerCase().padStart(64, '0');
  const calls = [
    { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: contract, data: '0x06fdde03' }, 'latest'] },
    { jsonrpc: '2.0', id: 2, method: 'eth_call', params: [{ to: contract, data: '0x95d89b41' }, 'latest'] },
    { jsonrpc: '2.0', id: 3, method: 'eth_call', params: [{ to: contract, data: '0x313ce567' }, 'latest'] },
    { jsonrpc: '2.0', id: 4, method: 'eth_call', params: [{ to: contract, data: `0x70a08231${walletArg}` }, 'latest'] },
  ];
  const response = await getJson(ROBINHOOD_RPC, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(calls),
  });
  const byId = new Map(response.map((item) => [item.id, item.result]));
  const decimals = Number(BigInt(byId.get(3) ?? '0x12'));
  return {
    name: decodeAbiString(byId.get(1)),
    symbol: decodeAbiString(byId.get(2)),
    decimals,
    balanceRaw: BigInt(byId.get(4) ?? '0x0').toString(),
  };
}

async function updateEthUsd() {
  const pairs = await getJson(`${DEXSCREENER}/${WETH}`);
  const candidates = pairs
    .filter((pair) => pair.baseToken?.address?.toLowerCase() === WETH.toLowerCase() && pair.quoteToken?.address?.toLowerCase() === USDG.toLowerCase())
    .sort((a, b) => Number(b.liquidity?.usd ?? 0) - Number(a.liquidity?.usd ?? 0));
  const price = Number(candidates[0]?.priceUsd);
  if (!price) throw new Error('пара WETH/USDG не найдена');
  portfolio.ethUsd = price;
}

async function updateTransactionCounter() {
  const currentNonce = Number(BigInt(await rpc('eth_getTransactionCount', [portfolio.wallet, 'latest'])));
  const previousNonce = portfolio.walletNonce ?? currentNonce;
  if (currentNonce > previousNonce) portfolio.sourceTransactionCount += currentNonce - previousNonce;
  portfolio.walletNonce = currentNonce;
}

async function discoverNewPurchases() {
  const latestBlock = Number(BigInt(await rpc('eth_blockNumber', [])));
  const firstBlock = (portfolio.lastScannedBlock ?? latestBlock) + 1;
  if (firstBlock > latestBlock) return 0;

  const walletTopic = `0x${portfolio.wallet.slice(2).toLowerCase().padStart(64, '0')}`;
  const logs = [];
  for (let fromBlock = firstBlock; fromBlock <= latestBlock; fromBlock += 100000) {
    const toBlock = Math.min(fromBlock + 99999, latestBlock);
    const chunk = await rpc('eth_getLogs', [{
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: `0x${toBlock.toString(16)}`,
      topics: [TRANSFER_TOPIC, null, walletTopic],
    }]);
    logs.push(...chunk);
  }

  const logsByTransaction = new Map();
  for (const log of logs) {
    const items = logsByTransaction.get(log.transactionHash) ?? [];
    items.push(log);
    logsByTransaction.set(log.transactionHash, items);
  }

  let discovered = 0;
  for (const [transactionHash, transactionLogs] of logsByTransaction) {
    const transaction = await rpc('eth_getTransactionByHash', [transactionHash]);
    if (!transaction || transaction.from?.toLowerCase() !== portfolio.wallet.toLowerCase()) continue;
    const spentWei = BigInt(transaction.value ?? '0x0');
    if (spentWei === 0n) continue;

    const candidateLogs = transactionLogs.filter((log) => ![WETH, USDG].some((address) => address.toLowerCase() === log.address.toLowerCase()));
    if (!candidateLogs.length) continue;
    const finalLog = candidateLogs.sort((a, b) => Number(BigInt(b.logIndex)) - Number(BigInt(a.logIndex)))[0];
    const contract = finalLog.address;
    const receivedRaw = candidateLogs
      .filter((log) => log.address.toLowerCase() === contract.toLowerCase())
      .reduce((sum, log) => sum + BigInt(log.data), 0n);
    const details = await readTokenDetails(contract);
    const block = await rpc('eth_getBlockByNumber', [transaction.blockNumber, false]);
    const date = purchaseDate(Number(BigInt(block.timestamp)));
    const spentEth = Number(spentWei) / 1e18;
    const received = tokenAmount(receivedRaw, details.decimals);
    const balance = tokenAmount(BigInt(details.balanceRaw), details.decimals);
    const existing = portfolio.positions.find((position) => position.contract.toLowerCase() === contract.toLowerCase());
    if (existing?.purchaseTxHashes?.includes(transactionHash)) continue;

    if (existing) {
      const oldSpent = existing.spentEth;
      existing.bought += received;
      existing.spentEth += spentEth;
      existing.entryEthUsd = (existing.entryEthUsd * oldSpent + portfolio.ethUsd * spentEth) / existing.spentEth;
      existing.purchaseCount = (existing.purchaseCount ?? 0) + 1;
      existing.purchaseDates = [...new Set([...(existing.purchaseDates ?? [existing.purchaseDateLabel]), date])];
      existing.purchaseDateLabel = existing.purchaseDates.join(' и ');
      existing.balanceRaw = details.balanceRaw;
      existing.balance = balance;
      existing.purchaseTxHashes = [...new Set([...(existing.purchaseTxHashes ?? []), transactionHash])];
      existing.discoverySource = 'rpc-txs';
    } else {
      portfolio.positions.push({
        name: details.name || details.symbol || contract,
        symbol: details.symbol || `${contract.slice(0, 6)}…${contract.slice(-4)}`,
        contract,
        bought: received,
        spentEth,
        sold: 0,
        realizedProceedsEth: 0,
        balance,
        balanceRaw: details.balanceRaw,
        purchaseDateLabel: date,
        purchaseDates: [date],
        purchaseCount: 1,
        entryEthUsd: portfolio.ethUsd,
        exitEthUsd: null,
        currentValueEth: null,
        pnlEth: null,
        pnlPct: null,
        marketCapUsd: null,
        currentPriceUsd: null,
        quoteProvider: null,
        quoteAsOf: null,
        confidence: 'Автоматически проверено по исходящей tx',
        purchaseTxHashes: [transactionHash],
        discoverySource: 'rpc-txs',
        decimals: details.decimals,
      });
    }
    discovered += 1;
    console.log(`Новая покупка: ${details.symbol || contract} за ${spentEth} ETH (${transactionHash})`);
  }

  portfolio.lastScannedBlock = latestBlock;
  return discovered;
}

async function discoverSales() {
  const latestBlock = Number(BigInt(await rpc('eth_blockNumber', [])));
  const firstBlock = (portfolio.lastSaleScannedBlock ?? SALE_SCAN_BOOTSTRAP_BLOCK) + 1;
  if (firstBlock > latestBlock) return 0;

  const walletTopic = `0x${portfolio.wallet.slice(2).toLowerCase().padStart(64, '0')}`;
  const positionsByContract = new Map(
    portfolio.positions.map((position) => [position.contract.toLowerCase(), position]),
  );
  const outgoingTransfers = [];
  for (let fromBlock = firstBlock; fromBlock <= latestBlock; fromBlock += 100000) {
    const toBlock = Math.min(fromBlock + 99999, latestBlock);
    const chunk = await rpc('eth_getLogs', [{
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: `0x${toBlock.toString(16)}`,
      topics: [TRANSFER_TOPIC, walletTopic],
    }]);
    outgoingTransfers.push(...chunk);
  }

  const groupedByTransaction = new Map();

  for (const transfer of outgoingTransfers) {
    const contract = transfer.address?.toLowerCase();
    if (!positionsByContract.has(contract)) continue;

    const transactionHash = transfer.transactionHash;
    const transactions = groupedByTransaction.get(transactionHash) ?? new Map();
    const current = transactions.get(contract) ?? {
      raw: 0n,
      decimals: positionsByContract.get(contract).decimals ?? 18,
    };
    current.raw += BigInt(transfer.data ?? '0x0');
    transactions.set(contract, current);
    groupedByTransaction.set(transactionHash, transactions);
  }

  let discovered = 0;
  for (const [transactionHash, transfersByContract] of groupedByTransaction) {
    if (transfersByContract.size !== 1) {
      console.warn(`Продажа ${transactionHash} пропущена: несколько токенов в одной транзакции.`);
      continue;
    }

    const [[contract, transfer]] = transfersByContract;
    const position = positionsByContract.get(contract);
    if (position.saleTxHashes?.includes(transactionHash)) continue;

    const receipt = await rpc('eth_getTransactionReceipt', [transactionHash]);
    if (!receipt || BigInt(receipt.status ?? '0x0') !== 1n) continue;
    const proceedsRaw = (receipt.logs ?? [])
      .filter((log) =>
        log.address?.toLowerCase() === WETH.toLowerCase()
        && log.topics?.[0]?.toLowerCase() === TRANSFER_TOPIC
        && log.topics?.[2]?.toLowerCase() === walletTopic)
      .reduce((sum, log) => sum + BigInt(log.data ?? '0x0'), 0n);
    const proceedsEth = Number(proceedsRaw) / 1e18;
    if (!(proceedsEth > 0)) continue;

    const block = await rpc('eth_getBlockByNumber', [receipt.blockNumber, false]);
    const timestamp = new Date(Number(BigInt(block.timestamp)) * 1000).toISOString();
    const sold = tokenAmount(transfer.raw, transfer.decimals);
    const previousSold = position.sold ?? 0;
    const previousProceeds = position.realizedProceedsEth ?? 0;
    const legacySale = !(position.saleTransactions?.length)
      && previousSold > 0
      && previousProceeds > 0
      && nearlyEqual(previousSold, sold)
      && nearlyEqual(previousProceeds, proceedsEth);
    const ethUsd = legacySale && position.exitEthUsd
      ? position.exitEthUsd
      : portfolio.ethUsd;
    const saleTransaction = {
      hash: transactionHash,
      timestamp,
      sold,
      proceedsEth,
      ethUsd,
    };

    position.saleTransactions = [...(position.saleTransactions ?? []), saleTransaction];
    position.saleTxHashes = [...new Set([...(position.saleTxHashes ?? []), transactionHash])];

    if (!legacySale) {
      const nextProceeds = previousProceeds + proceedsEth;
      position.sold = previousSold + sold;
      position.realizedProceedsEth = nextProceeds;
      position.exitEthUsd = nextProceeds
        ? ((position.exitEthUsd ?? 0) * previousProceeds + ethUsd * proceedsEth) / nextProceeds
        : null;
      discovered += 1;
      console.log(
        `Новая продажа: ${position.symbol} ${sold} за ${proceedsEth} ETH (${transactionHash})`,
      );
    } else {
      console.log(`Историческая продажа ${position.symbol} привязана к ${transactionHash}.`);
    }
  }

  portfolio.lastSaleScannedBlock = latestBlock;
  return discovered;
}

async function updateDexMarketData(position) {
  const pairs = await getJson(`${DEXSCREENER}/${position.contract}`);
  const contract = position.contract.toLowerCase();
  const trustedQuotes = new Set([WETH, USDG, NATIVE_ETH].map((address) => address.toLowerCase()));
  const basePairs = pairs.filter((pair) => pair.baseToken?.address?.toLowerCase() === contract && Number(pair.priceUsd) > 0);
  const trustedPairs = basePairs.filter((pair) => trustedQuotes.has(pair.quoteToken?.address?.toLowerCase()));
  const byLiquidity = (a, b) => Number(b.liquidity?.usd ?? 0) - Number(a.liquidity?.usd ?? 0);
  const mostLiquidPair = [...basePairs].sort(byLiquidity)[0];
  const mostLiquidTrustedPair = [...trustedPairs].sort(byLiquidity)[0];
  const trustedLiquidity = Number(mostLiquidTrustedPair?.liquidity?.usd ?? 0);
  const overallLiquidity = Number(mostLiquidPair?.liquidity?.usd ?? 0);
  const discoveredTokenHasWeakTrustedPool = position.discoverySource === 'rpc-txs'
    && trustedLiquidity < 1000
    && overallLiquidity > trustedLiquidity * 10;
  const selected = discoveredTokenHasWeakTrustedPool
    ? mostLiquidPair
    : (mostLiquidTrustedPair ?? mostLiquidPair);
  if (!selected) throw new Error('пара с USD/ETH-котировкой не найдена');

  position.currentPriceUsd = Number(selected.priceUsd);
  position.marketCapUsd = Number(selected.marketCap ?? selected.fdv) || null;
  const usesTrustedPair = trustedQuotes.has(selected.quoteToken?.address?.toLowerCase());
  position.marketDataProvider = usesTrustedPair ? 'DexScreener' : 'DexScreener (самая ликвидная пара)';
  position.marketPairUrl = selected.url ?? null;
  position.liquidityUsd = Number(selected.liquidity?.usd ?? 0);
  if (position.marketCapUsd && position.currentPriceUsd) {
    position.mcapSupply = position.marketCapUsd / position.currentPriceUsd;
  }
}

async function updateOnChainState(position) {
  const walletArg = portfolio.wallet.slice(2).toLowerCase().padStart(64, '0');
  const calls = [
    { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: position.contract, data: '0x18160ddd' }, 'latest'] },
    { jsonrpc: '2.0', id: 2, method: 'eth_call', params: [{ to: position.contract, data: '0x313ce567' }, 'latest'] },
    { jsonrpc: '2.0', id: 3, method: 'eth_call', params: [{ to: position.contract, data: `0x70a08231${walletArg}` }, 'latest'] },
  ];
  const response = await getJson(ROBINHOOD_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(calls),
  });
  const supplyHex = response.find((item) => item.id === 1)?.result;
  const decimalsHex = response.find((item) => item.id === 2)?.result;
  const balanceHex = response.find((item) => item.id === 3)?.result;
  if (!supplyHex || !decimalsHex || !balanceHex) {
    throw new Error('totalSupply/decimals/balanceOf не возвращены RPC');
  }

  const decimals = Number(BigInt(decimalsHex));
  const balanceRaw = BigInt(balanceHex).toString();
  if (position.balanceRaw !== balanceRaw) {
    position.currentValueEth = null;
    position.quoteProvider = null;
    position.quoteAsOf = null;
  }
  position.decimals = decimals;
  position.balanceRaw = balanceRaw;
  position.balance = tokenAmount(BigInt(balanceRaw), decimals);
  position.totalSupply = Number(BigInt(supplyHex)) / 10 ** decimals;
  position.mcapSupply = position.marketCapUsd && position.currentPriceUsd
    ? position.marketCapUsd / position.currentPriceUsd
    : position.totalSupply;
}

async function fetchUniswapQuote(position) {
  const apiKey = process.env.UNISWAP_API_KEY;
  if (!apiKey) return null;

  const response = await getJson(UNISWAP_QUOTE_API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'x-universal-router-version': '2.1.1',
    },
    body: JSON.stringify({
      type: 'EXACT_INPUT',
      amount: position.balanceRaw,
      tokenInChainId: Number(CHAIN_ID),
      tokenOutChainId: Number(CHAIN_ID),
      tokenIn: position.contract,
      tokenOut: WETH,
      swapper: portfolio.wallet,
      slippageTolerance: 1,
      routingPreference: 'BEST_PRICE',
    }),
  });

  const outputAmount = response?.quote?.output?.amount
    ?? response?.quote?.expectedAmountOut
    ?? response?.quote?.orderInfo?.outputs?.[0]?.startAmount;
  if (!outputAmount || !/^\d+$/.test(outputAmount)) {
    throw new Error('Uniswap не вернул корректное количество выходного WETH');
  }
  return {
    routing: response.routing ?? 'BEST_PRICE',
    buyAmount: BigInt(outputAmount),
  };
}

async function updateExecutableQuote(position) {
  if (BigInt(position.balanceRaw) === 0n) {
    position.currentValueEth = 0;
    position.quoteProvider = 'Onchain balance';
    position.quoteAsOf = new Date().toISOString();
    return true;
  }
  const quote = await fetchUniswapQuote(position);
  if (!quote) return false;
  position.currentValueEth = Number(quote.buyAmount) / 1e18;
  position.quoteProvider = `Uniswap Trading API (${quote.routing})`;
  position.quoteAsOf = new Date().toISOString();
  return true;
}

async function updateMarketFromSmallQuote(position) {
  if (position.marketCapUsd !== null || !position.totalSupply || !portfolio.ethUsd) return false;
  const divisor = 1000n;
  const smallSellAmount = BigInt(position.balanceRaw) / divisor || 1n;
  const smallPosition = { ...position, balanceRaw: smallSellAmount.toString() };
  const quote = await fetchUniswapQuote(smallPosition);
  if (!quote) return false;

  const tokenAmount = Number(smallSellAmount) / 10 ** (position.decimals ?? 18);
  const valueUsd = Number(quote.buyAmount) / 1e18 * portfolio.ethUsd;
  if (!tokenAmount || !valueUsd) return false;
  position.currentPriceUsd = valueUsd / tokenAmount;
  position.marketCapUsd = position.currentPriceUsd * position.totalSupply;
  position.mcapSupply = position.totalSupply;
  position.marketDataProvider = 'Uniswap Trading API (малая котировка)';
  return true;
}

try {
  await updateEthUsd();
} catch (error) {
  console.warn(`Цена ETH/USD не обновлена, сохранено последнее значение: ${error.message}`);
}

try {
  await updateTransactionCounter();
  await discoverNewPurchases();
} catch (error) {
  console.warn(`Новые покупки не просканированы, сохранено последнее состояние: ${error.message}`);
}

try {
  await discoverSales();
} catch (error) {
  console.warn(`Продажи не просканированы, сохранено последнее состояние: ${error.message}`);
}

if (!process.env.UNISWAP_API_KEY) {
  console.warn('UNISWAP_API_KEY не задан: новые исполнимые котировки пропущены.');
}

for (const position of portfolio.positions) {
  position.marketCapUsd = null;
  position.currentPriceUsd = null;
  try {
    await updateDexMarketData(position);
  } catch (error) {
    console.warn(`DexScreener ${position.symbol} не обновлён: ${error.message}`);
  }
  try {
    await updateOnChainState(position);
  } catch (error) {
    console.warn(`Onchain-состояние ${position.symbol} не обновлено: ${error.message}`);
  }
  try {
    await updateExecutableQuote(position);
  } catch (error) {
    console.warn(`Котировка ${position.symbol} не обновлена: ${error.message}`);
  }
  try {
    await updateMarketFromSmallQuote(position);
  } catch (error) {
    console.warn(`Резервный MCap ${position.symbol} не рассчитан: ${error.message}`);
  }

  const realizedProceedsEth = position.realizedProceedsEth ?? 0;
  if (typeof position.currentValueEth === 'number') {
    position.pnlEth = realizedProceedsEth + position.currentValueEth - position.spentEth;
    position.pnlPct = position.spentEth ? position.pnlEth / position.spentEth * 100 : 0;
  } else {
    position.pnlEth = null;
    position.pnlPct = null;
  }
}

portfolio.positions.sort((a, b) => (b.currentValueEth ?? -1) - (a.currentValueEth ?? -1));
const valuedPositions = portfolio.positions.filter((item) => typeof item.currentValueEth === 'number');
const valuedCostEth = valuedPositions.reduce((sum, item) => sum + item.spentEth, 0);
const pnlEth = valuedPositions.reduce((sum, item) => sum + item.pnlEth, 0);
portfolio.summary = {
  costEth: portfolio.positions.reduce((sum, item) => sum + item.spentEth, 0),
  valueEth: valuedPositions.reduce((sum, item) => sum + item.currentValueEth, 0),
  pnlEth,
  pnlPct: valuedCostEth ? pnlEth / valuedCostEth * 100 : 0,
  positionsCount: portfolio.positions.length,
  valuedPositionsCount: valuedPositions.length,
  valuedCostEth,
  realizedProceedsEth: valuedPositions.reduce((sum, item) => sum + (item.realizedProceedsEth ?? 0), 0),
};
portfolio.asOf = new Date().toISOString();

await fs.writeFile(DATA_PATH, `${JSON.stringify(portfolio, null, 2)}\n`);
await fs.writeFile(CACHE_PATH, `${JSON.stringify({
  asOf: portfolio.asOf,
  lastScannedBlock: portfolio.lastScannedBlock,
  lastSaleScannedBlock: portfolio.lastSaleScannedBlock,
  walletNonce: portfolio.walletNonce,
  sourceTransactionCount: portfolio.sourceTransactionCount,
  positions: portfolio.positions,
}, null, 2)}\n`);
console.log(
  `Обновлено: ${portfolio.positions.length} позиций, ${portfolio.sourceTransactionCount} транзакций, ` +
  `${valuedPositions.length} исполнимых котировок.`,
);
