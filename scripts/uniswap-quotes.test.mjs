import assert from 'node:assert/strict';
import test from 'node:test';
import { bestEthQuote, NATIVE_ETH, parseUniswapQuote, publicQuoteDiagnostic, quoteAnomaly, WETH } from './uniswap-quotes.mjs';

const position = {
  contract: '0x6245e67affa44a23077f0ea7f981a8dc743a0c47',
  balanceRaw: '1223578335170891469376457',
  balance: 1223578.3351708914,
  currentPriceUsd: 0.004742,
  liquidityUsd: 650000,
  marketDataProvider: 'DexScreener',
};

function response(tokenOut = WETH) {
  return {
    routing: 'CLASSIC',
    quote: {
      input: { token: position.contract, amount: position.balanceRaw },
      output: { token: tokenOut, amount: '2100000000000000000' },
      portionAmount: '1000000000000000',
    },
  };
}

test('FRONG: full balance in base units, ETH/WETH output and net fee', () => {
  for (const tokenOut of [WETH, NATIVE_ETH]) {
    assert.equal(parseUniswapQuote(response(tokenOut), position, tokenOut).buyAmount, 2099000000000000000n);
  }
});

test('reject a small-position response, different asset and malformed or excessive fee', () => {
  const small = response();
  small.quote.input.amount = '1223578335170891469376';
  assert.throws(() => parseUniswapQuote(small, position, WETH), /входного/);
  assert.throws(() => parseUniswapQuote(response(NATIVE_ETH), position, WETH), /выходной/);
  for (const portionAmount of ['abc', '2100000000000000001']) {
    const invalid = response();
    invalid.quote.portionAmount = portionAmount;
    assert.throws(() => parseUniswapQuote(invalid, position, WETH));
  }
});

test('choose better native ETH quote and preserve WETH quote when native route fails', async () => {
  const fetchQuote = async (_, tokenOut) => ({ tokenOut, buyAmount: tokenOut === WETH ? 4n : 2000n, routing: 'CLASSIC' });
  assert.equal((await bestEthQuote(position, fetchQuote)).tokenOut, NATIVE_ETH);
  const fallback = await bestEthQuote(position, async (_, tokenOut) => {
    if (tokenOut === NATIVE_ETH) throw Object.assign(new Error('404'), { status: 404 });
    return { tokenOut, buyAmount: 20n, routing: 'CLASSIC' };
  });
  assert.equal(fallback.buyAmount, 20n);
  assert.equal(fallback.candidates.length, 2);
  await assert.rejects(bestEthQuote(position, async () => { throw new Error('timeout'); }), /timeout/);
});

test('FRONG anomalous quote is flagged, credible loss/profit remain accepted', () => {
  assert.match(quoteAnomaly(position, 0.004665887563600958, 2679.22), /Аномальная/);
  assert.match(quoteAnomaly(position, 1000, 2679.22), /Аномальная/);
  assert.equal(quoteAnomaly(position, 2.1, 2679.22), null);
  assert.equal(quoteAnomaly(position, 0.3, 2679.22), null);
  // Large positions or indirect, untrusted market prices are not proof of an anomaly.
  assert.equal(quoteAnomaly({ ...position, liquidityUsd: 10000 }, 0.001, 2679.22), null);
  assert.equal(quoteAnomaly({ ...position, marketDataProvider: 'DexScreener (самая ликвидная пара)' }, 0.001, 2679.22), null);
});

test('rejected candidates retain both amounts and errors for diagnosis', async () => {
  await assert.rejects(bestEthQuote(position, async (_, tokenOut) => {
    throw Object.assign(new Error('Аномальная котировка'), {
      anomaly: true, valueEth: tokenOut === WETH ? 0.004 : 0.003,
      diagnostic: { routing: 'CLASSIC' },
    });
  }), (error) => {
    assert.equal(error.candidates.length, 2);
    assert.deepEqual(error.candidates.map((candidate) => candidate.valueEth), [0.004, 0.003]);
    assert.ok(error.candidates.every((candidate) => candidate.anomaly && candidate.error));
    return true;
  });
});

test('public diagnostic excludes credentials, permit payloads and signatures', () => {
  const original = response();
  original.headers = { 'x-api-key': 'DO_NOT_PUBLISH' };
  original.permitData = { signature: 'DO_NOT_PUBLISH' };
  original.quote.signature = 'DO_NOT_PUBLISH';
  original.quote.route = [[{ type: 'v4-pool', poolId: 'public-pool' }]];
  const diagnostic = publicQuoteDiagnostic(original);
  assert.equal(diagnostic.route[0][0].poolId, 'public-pool');
  assert.equal(diagnostic.input.amount, position.balanceRaw);
  assert.ok(!JSON.stringify(diagnostic).includes('DO_NOT_PUBLISH'));
  assert.equal(publicQuoteDiagnostic(null).input, null);
});
