import { ArrowDownRight, ArrowUpRight, ExternalLink, RefreshCw, Wallet } from 'lucide-react';
import portfolio from '@/data/portfolio.json';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 4 });
const eth = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 });

export const dynamic = 'force-static';

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function optionalEth(value: unknown) {
  return typeof value === 'number' ? value.toExponential(4) : '—';
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
  const positions = [...portfolio.positions].sort((a, b) => b.currentValueEth - a.currentValueEth);
  const updated = new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Moscow',
  }).format(new Date(portfolio.asOf));

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
          <Metric label="Затрачено" value={`${eth.format(portfolio.summary.costEth)} ETH`} detail="полная себестоимость" />
          <Metric label="Текущая оценка" value={`${eth.format(portfolio.summary.valueEth)} ETH`} detail="чистый выход по котировке" />
          <Metric label="PnL" value={`${portfolio.summary.pnlEth >= 0 ? '+' : ''}${eth.format(portfolio.summary.pnlEth)} ETH`} detail={`${portfolio.summary.pnlPct >= 0 ? '+' : ''}${number.format(portfolio.summary.pnlPct)}%`} positive={portfolio.summary.pnlEth >= 0} />
          <Metric label="Позиций" value={String(portfolio.summary.positionsCount)} detail="без спам-трансферов" />
        </div>

        <div className="table-card">
          <div className="table-heading">
            <div><h3>Текущие позиции</h3><p>Отсортировано по реализуемой стоимости</p></div>
            <Badge variant="outline">Источник: txs + 0x quote</Badge>
          </div>
          <div className="table-scroll">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Токен</TableHead>
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
                {positions.map((position) => (
                  <TableRow key={position.contract}>
                    <TableCell>
                      <div className="token-cell">
                        <span className="token-icon">{position.symbol.slice(0, 1)}</span>
                        <div>
                          <a href={position.matchaUrl} target="_blank" rel="noreferrer">{position.symbol} <ExternalLink size={12} /></a>
                          <small>{shortAddress(position.contract)}</small>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{number.format(position.bought)}</TableCell>
                    <TableCell className="text-right tabular-nums">{eth.format(position.spentEth)}</TableCell>
                    <TableCell className="text-right tabular-nums tiny-number">{position.avgBuyEth.toExponential(4)}</TableCell>
                    <TableCell className="text-right tabular-nums">{number.format(position.sold)}</TableCell>
                    <TableCell className="text-right tabular-nums">{optionalEth(position.avgSellEth)}</TableCell>
                    <TableCell className="text-right tabular-nums">{number.format(position.balance)}</TableCell>
                    <TableCell className="text-right tabular-nums value-cell">{eth.format(position.currentValueEth)}</TableCell>
                    <TableCell className={`text-right tabular-nums ${position.pnlEth >= 0 ? 'positive' : 'negative'}`}>
                      <span className="pnl-line">{position.pnlEth >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{position.pnlEth >= 0 ? '+' : ''}{eth.format(position.pnlEth)}</span>
                      <small>{position.pnlPct >= 0 ? '+' : ''}{number.format(position.pnlPct)}%</small>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{usd.format(position.marketCapUsd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <section className="audit-card">
          <div><p className="section-kicker">Методика</p><h3>Как считается PnL</h3></div>
          <p>Выручка от продаж плюс чистая котировка продажи остатка минус полная себестоимость. Внутренние переводы между связанными кошельками не считаются повторной покупкой или продажей.</p>
          <div className="audit-status"><span className="status-mark">✓</span><div><strong>FRONG проверен вручную</strong><small>4 покупки · 0 продаж · связанные адреса учтены</small></div></div>
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
