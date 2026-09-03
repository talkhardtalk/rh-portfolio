import { ArrowDownRight, ArrowUpRight, ExternalLink, RefreshCw, Wallet } from 'lucide-react';
import portfolioJson from '@/data/portfolio.json';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type Position = {
  name: string;
  symbol: string;
  contract: string;
  bought: number;
  spentEth: number;
  sold: number;
  realizedProceedsEth: number;
  balance: number;
  balanceRaw: string;
  purchaseDateLabel: string;
  purchaseCount: number;
  currentValueEth: number | null;
  pnlEth: number | null;
  pnlPct: number | null;
  marketCapUsd: number | null;
  currentPriceUsd: number | null;
  quoteProvider: string | null;
  confidence: string;
};

type Portfolio = Omit<typeof portfolioJson, 'positions'> & { positions: Position[] };
const portfolio = portfolioJson as Portfolio;

const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 4 });
const eth = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 });

export const dynamic = 'force-static';

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function compactEth(value: number | null) {
  return value === null ? '—' : value.toExponential(4);
}

function displayEth(value: number | null) {
  return value === null ? '—' : eth.format(value);
}

function matchaUrl(position: Position) {
  const padded = position.balanceRaw.padStart(19, '0');
  const whole = padded.slice(0, -18);
  const fraction = padded.slice(-18).replace(/0+$/, '');
  const sellAmount = fraction ? `${whole}.${fraction}` : whole;
  const query = new URLSearchParams({
    buyAddress: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
    buyChain: '4663',
    sellAddress: position.contract,
    sellChain: '4663',
    sellAmount,
  });
  return `https://matcha.xyz/tokens/robinhood/${position.contract}?${query}`;
}

function Metric({ label, value, detail, positive }: { label: string; value: string; detail: string; positive?: boolean }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong className={positive === undefined ? '' : positive ? 'positive' : 'negative'}>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

export default function Home() {
  const positions = [...portfolio.positions].sort((a, b) => {
    const valueDelta = (b.currentValueEth ?? -1) - (a.currentValueEth ?? -1);
    return valueDelta || a.symbol.localeCompare(b.symbol);
  });
  const updated = new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Moscow',
  }).format(new Date(portfolio.asOf));
  const pnlPositive = portfolio.summary.pnlEth >= 0;

  return (
    <main className="min-h-screen">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="site-header">
        <div className="brand-mark">RH</div>
        <div>
          <p className="eyebrow">Robinhood Chain</p>
          <h1>RH Portfolio</h1>
        </div>
        <div className="header-actions">
          <a className="wallet-link" href={`https://robinhoodchain.blockscout.com/address/${portfolio.wallet}?tab=txs`} target="_blank" rel="noreferrer">
            <Wallet size={15} /> {shortAddress(portfolio.wallet)} <ExternalLink size={13} />
          </a>
          <form action="." method="get">
            <Button variant="outline" size="sm" type="submit"><RefreshCw size={14} /> Обновить</Button>
          </form>
        </div>
      </header>

      <section className="dashboard-shell">
        <div className="intro-row">
          <div>
            <p className="section-kicker">Портфель</p>
            <h2>Позиции, подтверждённые транзакциями</h2>
          </div>
          <div className="freshness"><span className="live-dot" />Обновлено {updated} МСК</div>
        </div>

        <div className="metrics-grid">
          <Metric label="Затрачено" value={`${eth.format(portfolio.summary.costEth)} ETH`} detail={`все ${portfolio.summary.positionsCount} позиций`} />
          <Metric label="Текущая оценка" value={`${eth.format(portfolio.summary.valueEth)} ETH`} detail={`${portfolio.summary.valuedPositionsCount} из ${portfolio.summary.positionsCount} оценено`} />
          <Metric label="PnL оценённых" value={`${pnlPositive ? '+' : ''}${eth.format(portfolio.summary.pnlEth)} ETH`} detail={`${pnlPositive ? '+' : ''}${number.format(portfolio.summary.pnlPct)}% · с учётом продаж`} positive={pnlPositive} />
          <Metric label="Позиций" value={String(portfolio.summary.positionsCount)} detail={`${portfolio.sourceTransactionCount} txs · без спам-трансферов`} />
        </div>

        <div className="table-card">
          <div className="table-heading">
            <div><h3>Текущие позиции</h3><p>Сначала — позиции с наибольшей доступной оценкой в ETH</p></div>
            <Badge variant="outline">Источник покупок: вкладка txs ({portfolio.sourceTransactionCount})</Badge>
          </div>
          <div className="table-scroll">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Токен</TableHead>
                  <TableHead>Дата покупки</TableHead>
                  <TableHead className="text-right">Куплено</TableHead>
                  <TableHead className="text-right">Затрачено, ETH</TableHead>
                  <TableHead className="text-right">Ср. покупка</TableHead>
                  <TableHead className="text-right">Продано</TableHead>
                  <TableHead className="text-right">Ср. продажа</TableHead>
                  <TableHead className="text-right">Остаток</TableHead>
                  <TableHead className="text-right">Сейчас, ETH</TableHead>
                  <TableHead className="text-right">PnL, ETH</TableHead>
                  <TableHead className="text-right">MCap</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {positions.map((position) => {
                  const avgBuyEth = position.spentEth / position.bought;
                  const avgSellEth = position.sold ? position.realizedProceedsEth / position.sold : null;
                  const hasPnl = position.pnlEth !== null && position.pnlPct !== null;
                  return (
                    <TableRow key={position.contract}>
                      <TableCell>
                        <div className="token-cell">
                          <span className="token-icon">{position.symbol.slice(0, 1)}</span>
                          <div>
                            <a href={matchaUrl(position)} target="_blank" rel="noreferrer">{position.symbol} <ExternalLink size={12} /></a>
                            <small>{shortAddress(position.contract)} · {position.quoteProvider ?? position.confidence}</small>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="date-cell">{position.purchaseDateLabel}<small>{position.purchaseCount} {position.purchaseCount === 1 ? 'покупка' : 'покупки'}</small></TableCell>
                      <TableCell className="text-right tabular-nums">{number.format(position.bought)}</TableCell>
                      <TableCell className="text-right tabular-nums">{eth.format(position.spentEth)}</TableCell>
                      <TableCell className="text-right tabular-nums tiny-number">{compactEth(avgBuyEth)}</TableCell>
                      <TableCell className="text-right tabular-nums">{number.format(position.sold)}</TableCell>
                      <TableCell className="text-right tabular-nums tiny-number">{compactEth(avgSellEth)}</TableCell>
                      <TableCell className="text-right tabular-nums">{number.format(position.balance)}</TableCell>
                      <TableCell className="text-right tabular-nums value-cell">{displayEth(position.currentValueEth)}</TableCell>
                      <TableCell className={`text-right tabular-nums ${hasPnl ? (position.pnlEth! >= 0 ? 'positive' : 'negative') : 'muted-cell'}`}>
                        {hasPnl ? (
                          <><span className="pnl-line">{position.pnlEth! >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{position.pnlEth! >= 0 ? '+' : ''}{eth.format(position.pnlEth!)}</span><small>{position.pnlPct! >= 0 ? '+' : ''}{number.format(position.pnlPct!)}%</small></>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{position.marketCapUsd === null ? '—' : usd.format(position.marketCapUsd)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>

        <section className="audit-card">
          <div><p className="section-kicker">Методика</p><h3>Как считается PnL</h3></div>
          <p>Выручка от продаж плюс оценка остатка минус полная себестоимость. Сейчас PnL рассчитан по {portfolio.summary.valuedPositionsCount} позициям с доступной котировкой; пустые цены не считаются нулём. Покупки отобраны только из 44 обычных транзакций.</p>
          <div className="audit-status"><span className="status-mark">✓</span><div><strong>Продажи и связанные адреса учтены</strong><small>FRONG: 4 покупки · BOWYER: частичная продажа</small></div></div>
        </section>

        <footer>
          <span>Данные носят аналитический характер.</span>
          <a href={portfolio.sources.blockscout} target="_blank" rel="noreferrer">Blockscout</a>
          <a href={portfolio.sources.matcha} target="_blank" rel="noreferrer">Matcha</a>
        </footer>
      </section>
    </main>
  );
}
