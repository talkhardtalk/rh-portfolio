import fs from 'node:fs/promises';

const DATA_PATH = new URL('../data/portfolio.json', import.meta.url);
const BLOCKSCOUT = 'https://robinhoodchain.blockscout.com/api/v2';
const ROBINHOOD_RPC = 'https://rpc.mainnet.chain.robinhood.com';
const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
const CHAIN_ID = '4663';

const portfolio = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));

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

async function updateMarketData(position) {
  const token = await getJson(`${BLOCKSCOUT}/tokens/${position.contract}`);
  position.marketCapUsd = token.circulating_market_cap ? Number(token.circulating_market_cap) : null;
  position.currentPriceUsd = token.exchange_rate ? Number(token.exchange_rate) : null;
  const decimals = Number(token.decimals ?? 18);
  position.totalSupply = token.total_supply ? Number(token.total_supply) / 10 ** decimals : null;
  position.mcapSupply = position.marketCapUsd && position.currentPriceUsd
    ? position.marketCapUsd / position.currentPriceUsd
    : position.totalSupply;
  position.holders = Number(token.holders_count ?? 0);
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
  position.totalSupply = Number(BigInt(supplyHex)) / 10 ** decimals;
  position.mcapSupply = position.marketCapUsd && position.currentPriceUsd
    ? position.marketCapUsd / position.currentPriceUsd
    : position.totalSupply;
}

async function updateExecutableQuote(position) {
  const apiKey = process.env.ZEROX_API_KEY;
  if (!apiKey) return false;

  const query = new URLSearchParams({
    chainId: CHAIN_ID,
    sellToken: position.contract,
    buyToken: WETH,
    sellAmount: position.balanceRaw,
    taker: portfolio.wallet,
    slippageBps: '100',
  });
  const quote = await getJson(`https://api.0x.org/swap/allowance-holder/price?${query}`, {
    headers: { '0x-api-key': apiKey, '0x-version': 'v2' },
  });
  if (!quote.buyAmount) return false;
  position.currentValueEth = Number(quote.buyAmount) / 1e18;
  position.quoteProvider = '0x Swap API';
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
  try {
    await updateMarketData(position);
  } catch (error) {
    console.warn(`MCap ${position.symbol} не обновлён: ${error.message}`);
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
console.log(
  `Обновлено: ${portfolio.positions.length} позиций, ${portfolio.sourceTransactionCount} транзакций, ` +
  `${valuedPositions.length} исполнимых котировок.`,
);
