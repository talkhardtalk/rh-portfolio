export const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
export const NATIVE_ETH = '0x0000000000000000000000000000000000000000';
export const QUOTE_VALIDATION_VERSION = 1;

const sameToken = (left, right) => left?.toLowerCase() === right?.toLowerCase();
const rawAmount = (value) => typeof value === 'string' && /^\d+$/.test(value);

export function publicQuoteDiagnostic(response) {
  const quote = response?.quote;
  return {
    routing: response?.routing ?? null,
    input: quote?.input ?? null,
    output: quote?.output ?? null,
    portionAmount: quote?.portionAmount ?? '0',
    route: quote?.route ?? null,
    priceImpact: quote?.priceImpact ?? null,
    txFailureReasons: quote?.txFailureReasons ?? response?.txFailureReasons ?? null,
  };
}

export function parseUniswapQuote(response, position, tokenOut) {
  const quote = response?.quote;
  const input = quote?.input;
  const output = quote?.output;
  if (!sameToken(input?.token, position.contract)
    || !rawAmount(input?.amount) || BigInt(input.amount) !== BigInt(position.balanceRaw)) {
    throw new Error('Uniswap вернул котировку другого входного токена или количества');
  }
  if (!sameToken(output?.token, tokenOut) || !rawAmount(output?.amount)) {
    throw new Error('Uniswap вернул некорректный выходной токен или количество ETH/WETH');
  }
  const fee = quote.portionAmount ?? '0';
  if (!rawAmount(fee)) throw new Error('Uniswap вернул некорректную комиссию');
  const buyAmount = BigInt(output.amount) - BigInt(fee);
  if (buyAmount < 0n) throw new Error('Комиссия Uniswap превышает выходную сумму');
  return {
    routing: response.routing ?? 'BEST_PRICE',
    tokenOut,
    buyAmount,
    // Only public quote fields; never API headers, permit payloads or signatures.
    diagnostic: publicQuoteDiagnostic(response),
  };
}

export function quoteAnomaly(position, valueEth, ethUsd) {
  const spotUsd = position.balance * position.currentPriceUsd;
  const trustedMarket = position.marketDataProvider === 'DexScreener';
  const comparableLiquidity = position.liquidityUsd >= 10_000
    && spotUsd > 0 && spotUsd <= position.liquidityUsd * 0.05;
  if (!trustedMarket || !comparableLiquidity || !(ethUsd > 0)) return null;
  const ratio = valueEth * ethUsd / spotUsd;
  if (!Number.isFinite(ratio) || ratio < 0.01 || ratio > 100) {
    return 'Аномальная котировка: результат отличается от спотовой оценки более чем в 100 раз. Требуется проверка маршрута, ликвидности и комиссий.';
  }
  return null;
}

export async function bestEthQuote(position, fetchQuote) {
  const results = await Promise.allSettled([WETH, NATIVE_ETH].map((token) => fetchQuote(position, token)));
  const candidates = results.flatMap((result, index) => result.status === 'fulfilled' && result.value
    ? [{ tokenOut: [WETH, NATIVE_ETH][index], valueEth: Number(result.value.buyAmount) / 1e18, routing: result.value.routing }]
    : [{
      tokenOut: [WETH, NATIVE_ETH][index],
      error: result.status === 'rejected' ? result.reason.message : 'API key unavailable',
      ...(result.status === 'rejected' && result.reason.anomaly
        ? { anomaly: true, valueEth: result.reason.valueEth, routing: result.reason.diagnostic?.routing } : {}),
    }]);
  const quotes = results.filter((result) => result.status === 'fulfilled' && result.value).map((result) => result.value);
  if (!quotes.length) {
    const failure = results.find((result) => result.status === 'rejected'
      && ![400, 404, 422].includes(result.reason.status)) ?? results.find((result) => result.status === 'rejected');
    if (failure) throw Object.assign(failure.reason, { candidates });
    return null;
  }
  const quote = quotes.reduce((best, candidate) => candidate.buyAmount > best.buyAmount ? candidate : best);
  return { ...quote, candidates };
}
