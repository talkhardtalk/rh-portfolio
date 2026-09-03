import fs from 'node:fs/promises';

const DATA_PATH = new URL('../data/portfolio.json', import.meta.url);
const CACHE_PATH = new URL('../data/portfolio-cache.json', import.meta.url);
const BLOCKSCOUT = 'https://robinhoodchain.blockscout.com/api/v2';
const DEXSCREENER = 'https://api.dexscreener.com/token-pairs/v1/robinhood';
const ROBINHOOD_RPC = 'https://rpc.mainnet.chain.robinhood.com';
const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const NATIVE_ETH = '0x0000000000000000000000000000000000000000';
const CHAIN_ID = '4663';
const QUOTE_CACHE_MAX_AGE_MS = 2 * 60 * 60 * 1000;

const portfolio = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));

async function restoreLastSuccessfulQuotes() {
  try {
    const cache = JSON.parse(await fs.readFile(CACHE_PATH, 'utf8'));
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

await restoreLastSuccessfulQuotes();

async function getJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: 'application/json',
      'user-agent': 'RH-Portfolio/1.0 (+https://github.com)',
      ...options.headers,
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

async function countTransactions(address) {
  let url = `${BLOCKSCOUT}/addresses/${address}/transactions`;
  let count = 0;
  while (url) {
    const page = await getJson(url);
    count += page.items?.length ?? 0;
    if (!page.next_page_params) break;
    const query = new URLSearchParams(page.next_page_params).toString();
    url = `${BLOCKSCOUT}/addresses/${address}/transactions?${query}`;
  }
  return count;
}

async function updateBlockscoutMarketData(position) {
  const token = await getJson(`${BLOCKSCOUT}/tokens/${position.contract}`);
  if (position.marketCapUsd === null && token.circulating_market_cap) {
    position.marketCapUsd = Number(token.circulating_market_cap);
    position.marketDataProvider = 'Blockscout';
  }
  if (position.currentPriceUsd === null && token.exchange_rate) {
    position.currentPriceUsd = Number(token.exchange_rate);
  }
  const decimals = Number(token.decimals ?? 18);
  position.decimals = decimals;
  position.totalSupply = token.total_supply ? Number(token.total_supply) / 10 ** decimals : position.totalSupply;
  position.mcapSupply = position.marketCapUsd && position.currentPriceUsd
    ? position.marketCapUsd / position.currentPriceUsd
    : position.totalSupply;
  position.holders = Number(token.holders_count ?? 0);
}

async function updateDexMarketData(position) {
  const pairs = await getJson(`${DEXSCREENER}/${position.contract}`);
  const contract = position.contract.toLowerCase();
  const trustedQuotes = new Set([WETH, USDG, NATIVE_ETH].map((address) => address.toLowerCase()));
  const basePairs = pairs.filter((pair) => pair.baseToken?.address?.toLowerCase() === contract && Number(pair.priceUsd) > 0);
  const trustedPairs = basePairs.filter((pair) => trustedQuotes.has(pair.quoteToken?.address?.toLowerCase()));
  const candidates = trustedPairs.length ? trustedPairs : basePairs;
  const selected = candidates.sort((a, b) => Number(b.liquidity?.usd ?? 0) - Number(a.liquidity?.usd ?? 0))[0];
  if (!selected) throw new Error('пара с USD/ETH-котировкой не найдена');

  position.currentPriceUsd = Number(selected.priceUsd);
  position.marketCapUsd = Number(selected.marketCap ?? selected.fdv) || null;
  position.marketDataProvider = trustedPairs.length ? 'DexScreener' : 'DexScreener (нестандартная котировочная пара)';
  position.marketPairUrl = selected.url ?? null;
  position.liquidityUsd = Number(selected.liquidity?.usd ?? 0);
  if (position.marketCapUsd && position.currentPriceUsd) {
    position.mcapSupply = position.marketCapUsd / position.currentPriceUsd;
  }
}

async function updateSupply(position) {
  const calls = [
    { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: position.contract, data: '0x18160ddd' }, 'latest'] },
    { jsonrpc: '2.0', id: 2, method: 'eth_call', params: [{ to: position.contract, data: '0x313ce567' }, 'latest'] },
  ];
  const response = await getJson(ROBINHOOD_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(calls),
  });
  const supplyHex = response.find((item) => item.id === 1)?.result;
  const decimalsHex = response.find((item) => item.id === 2)?.result;
  if (!supplyHex || !decimalsHex) throw new Error('totalSupply/decimals не возвращены RPC');

  const decimals = Number(BigInt(decimalsHex));
  position.decimals = decimals;
  position.totalSupply = Number(BigInt(supplyHex)) / 10 ** decimals;
  position.mcapSupply = position.marketCapUsd && position.currentPriceUsd
    ? position.marketCapUsd / position.currentPriceUsd
    : position.totalSupply;
}

async function fetch0xQuote(position, endpoint) {
  const apiKey = process.env.ZEROX_API_KEY;
  if (!apiKey) return null;

  const query = new URLSearchParams({
    chainId: CHAIN_ID,
    sellToken: position.contract,
    buyToken: WETH,
    sellAmount: position.balanceRaw,
    slippageBps: '100',
  });
  if (endpoint.endsWith('/quote')) {
    query.set('taker', portfolio.wallet);
    query.set('sellEntireBalance', 'true');
  }
  const quote = await getJson(`https://api.0x.org/swap/${endpoint}?${query}`, {
    headers: { '0x-api-key': apiKey, '0x-version': 'v2' },
  });
  return quote.buyAmount ? { endpoint, buyAmount: BigInt(quote.buyAmount) } : null;
}

async function updateExecutableQuote(position) {
  let primary = null;
  try {
    primary = await fetch0xQuote(position, 'allowance-holder/price');
  } catch (error) {
    console.warn(`Основной маршрут ${position.symbol} недоступен: ${error.message}`);
  }
  const spotValueEth = position.currentPriceUsd && portfolio.ethUsd
    ? position.balance * position.currentPriceUsd / portfolio.ethUsd
    : null;
  const primaryValueEth = primary ? Number(primary.buyAmount) / 1e18 : null;
  const needsRouteCheck = primaryValueEth === null || (spotValueEth && primaryValueEth < spotValueEth * 0.8);
  const quotes = primary ? [primary] : [];

  if (needsRouteCheck) {
    for (const endpoint of ['allowance-holder/quote', 'permit2/price']) {
      try {
        const alternative = await fetch0xQuote(position, endpoint);
        if (alternative) quotes.push(alternative);
      } catch (error) {
        console.warn(`Альтернативный маршрут ${position.symbol} (${endpoint}) недоступен: ${error.message}`);
      }
    }
  }

  const best = quotes.sort((a, b) => (a.buyAmount > b.buyAmount ? -1 : a.buyAmount < b.buyAmount ? 1 : 0))[0];
  if (!best) return false;
  position.currentValueEth = Number(best.buyAmount) / 1e18;
  position.quoteProvider = `0x Swap API (${best.endpoint})`;
  position.quoteAsOf = new Date().toISOString();
  return true;
}

async function updateMarketFromSmallQuote(position) {
  if (position.marketCapUsd !== null || !position.totalSupply || !portfolio.ethUsd) return false;
  const divisor = 1000n;
  const smallSellAmount = BigInt(position.balanceRaw) / divisor || 1n;
  const smallPosition = { ...position, balanceRaw: smallSellAmount.toString() };
  const quote = await fetch0xQuote(smallPosition, 'allowance-holder/price');
  if (!quote) return false;

  const tokenAmount = Number(smallSellAmount) / 10 ** (position.decimals ?? 18);
  const valueUsd = Number(quote.buyAmount) / 1e18 * portfolio.ethUsd;
  if (!tokenAmount || !valueUsd) return false;
  position.currentPriceUsd = valueUsd / tokenAmount;
  position.marketCapUsd = position.currentPriceUsd * position.totalSupply;
  position.mcapSupply = position.totalSupply;
  position.marketDataProvider = '0x Swap API (малая котировка)';
  return true;
}

try {
  portfolio.sourceTransactionCount = await countTransactions(portfolio.wallet);
} catch (error) {
  console.warn(`Список транзакций временно недоступен, сохранено последнее значение: ${error.message}`);
}

try {
  const weth = await getJson(`${BLOCKSCOUT}/tokens/${WETH}`);
  if (weth.exchange_rate) portfolio.ethUsd = Number(weth.exchange_rate);
} catch (error) {
  console.warn(`Цена ETH временно недоступна, сохранено последнее значение: ${error.message}`);
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
    await updateBlockscoutMarketData(position);
  } catch (error) {
    console.warn(`Blockscout ${position.symbol} не обновлён: ${error.message}`);
  }
  try {
    await updateSupply(position);
  } catch (error) {
    console.warn(`Supply ${position.symbol} не обновлён: ${error.message}`);
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
  positions: portfolio.positions.map((position) => ({
    contract: position.contract,
    currentValueEth: position.currentValueEth,
    quoteProvider: position.quoteProvider,
    quoteAsOf: position.quoteAsOf,
  })),
}, null, 2)}\n`);
console.log(
  `Обновлено: ${portfolio.positions.length} позиций, ${portfolio.sourceTransactionCount} транзакций, ` +
  `${valuedPositions.length} исполнимых котировок.`,
);
