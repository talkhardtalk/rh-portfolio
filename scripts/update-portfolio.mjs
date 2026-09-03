import fs from 'node:fs/promises';

const DATA_PATH = new URL('../data/portfolio.json', import.meta.url);
const BLOCKSCOUT = 'https://robinhoodchain.blockscout.com/api/v2';
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
  if (token.circulating_market_cap) position.marketCapUsd = Number(token.circulating_market_cap);
  if (token.exchange_rate) position.currentPriceUsd = Number(token.exchange_rate);
  position.holders = Number(token.holders_count ?? 0);
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

for (const position of portfolio.positions) {
  try {
    await updateMarketData(position);
  } catch (error) {
    console.warn(`MCap ${position.symbol} не обновлён: ${error.message}`);
  }
  try {
    await updateExecutableQuote(position);
  } catch (error) {
    console.warn(`Котировка ${position.symbol} не обновлена: ${error.message}`);
  }

  const realizedProceedsEth = position.realizedProceedsEth ?? position.sold * (position.avgSellEth ?? 0);
  position.pnlEth = realizedProceedsEth + position.currentValueEth - position.spentEth;
  position.pnlPct = position.spentEth ? position.pnlEth / position.spentEth * 100 : 0;
}

portfolio.positions.sort((a, b) => b.currentValueEth - a.currentValueEth);
portfolio.summary = {
  costEth: portfolio.positions.reduce((sum, item) => sum + item.spentEth, 0),
  valueEth: portfolio.positions.reduce((sum, item) => sum + item.currentValueEth, 0),
  pnlEth: portfolio.positions.reduce((sum, item) => sum + item.pnlEth, 0),
  pnlPct: 0,
  positionsCount: portfolio.positions.length,
};
portfolio.summary.pnlPct = portfolio.summary.costEth
  ? portfolio.summary.pnlEth / portfolio.summary.costEth * 100
  : 0;
portfolio.asOf = new Date().toISOString();

await fs.writeFile(DATA_PATH, `${JSON.stringify(portfolio, null, 2)}\n`);
console.log(`Обновлено: ${portfolio.positions.length} позиций, ${portfolio.sourceTransactionCount} транзакций.`);
