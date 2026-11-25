import { useMemo, useState } from "react";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { useQuote } from "../lib/stream";
import { fmtBig, fmtChange, fmtDate, fmtInt, fmtPct, fmtPrice, isNum, labelize, tone } from "../lib/format";
import { AutoTable, Chg, DataTable, Empty, ErrorState, Flash, KV, Loading, SourceBadge, Tabs } from "../components/ui";
import type { PanelProps } from "./types";

const NeedSymbol = () => <Empty>Enter a security (type a ticker in the command line)</Empty>;

// ---------------------------------------------------------------- DES
export function QuotePanel({ symbol, run }: PanelProps) {
  const q = useQuote(symbol);
  const prof = useAsync(() => (symbol ? api.profile(symbol) : Promise.resolve(undefined)), [symbol]);
  if (!symbol) return <NeedSymbol />;
  const p = prof.data?.data ?? {};
  const pos52 = isNum(q?.year_high) && isNum(q?.year_low) && isNum(q?.last) && q!.year_high! > q!.year_low! ? (q!.last! - q!.year_low!) / (q!.year_high! - q!.year_low!) : null;
  return (
    <div className="panel-fill">
      <div className="scroll pad">
        <div className="des-head">
          <div>
            <div className="des-sym">{symbol}</div>
            <div className="des-name">{q?.name ?? p.name ?? ""}</div>
            <div className="muted">{[q?.exchange ?? p.exchange, p.sector, p.industry].filter(Boolean).join(" · ")}</div>
          </div>
          <div className="des-px">
            <Flash value={q?.last} className="des-last">
              {fmtPrice(q?.last)}
            </Flash>
            <div className={tone(q?.change)}>
              {fmtChange(q?.change)} ({fmtPct(q?.change_percent)})
            </div>
            <SourceBadge source={q?.source ?? prof.data?.source} provider={prof.data?.provider} />
          </div>
        </div>
        <div className="des-grid">
          <KV
            items={[
              ["Bid / Ask", `${fmtPrice(q?.bid)} / ${fmtPrice(q?.ask)}`],
              ["Size", `${fmtInt(q?.bid_size)} × ${fmtInt(q?.ask_size)}`],
              ["Open", fmtPrice(q?.open)],
              ["Day Range", `${fmtPrice(q?.low)} – ${fmtPrice(q?.high)}`],
              ["Prev Close", fmtPrice(q?.prev_close)],
              ["Volume", fmtBig(q?.volume)],
            ]}
          />
          <KV
            items={[
              ["52W Range", `${fmtPrice(q?.year_low)} – ${fmtPrice(q?.year_high)}`],
              ["52W Position", pos52 === null ? "—" : fmtPct(pos52, 0, false)],
              ["Market Cap", fmtBig(q?.market_cap ?? p.market_cap)],
              ["P/E", isNum(p.pe_ratio) ? p.pe_ratio.toFixed(1) : "—"],
              ["Beta", isNum(p.beta) ? p.beta.toFixed(2) : "—"],
              ["Div Yield", isNum(p.dividend_yield) ? fmtPct(p.dividend_yield, 2, false) : "—"],
            ]}
          />
        </div>
        {prof.error && <div className="state-error small">Profile: {prof.error}</div>}
        {(p.ceo || p.employees || p.hq_country || p.website) && (
          <KV
            items={[
              ...(p.ceo ? ([["CEO", p.ceo]] as [string, string][]) : []),
              ...(p.employees ? ([["Employees", fmtInt(p.employees)]] as [string, string][]) : []),
              ...(p.hq_country ? ([["HQ", p.hq_country]] as [string, string][]) : []),
              ...(p.website ? ([["Web", <a href={String(p.website).startsWith("http") ? p.website : `https://${p.website}`} target="_blank" rel="noreferrer noopener">{p.website}</a>]] as [string, any][]) : []),
            ]}
          />
        )}
        {p.description && <p className="des-desc">{p.description}</p>}
        <div className="quick-links">
          {["GP", "FA", "OMON", "TECH", "CF", "N", "TKT", "AI"].map((m) => (
            <button key={m} className="btn" onClick={() => run(`${symbol} ${m}`)}>
              {m}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- FA
const FA_ORDER: Record<string, string[]> = {
  income: ["revenue", "total_revenue", "cost_of_revenue", "gross_profit", "operating_expenses", "operating_income", "ebitda", "interest_expense", "pretax_income", "income_tax", "income_tax_expense", "net_income", "eps_diluted", "diluted_earnings_per_share"],
  balance: ["cash_and_equivalents", "cash_and_cash_equivalents", "short_term_investments", "accounts_receivable", "inventory", "total_current_assets", "property_plant_equipment", "goodwill_and_intangibles", "total_assets", "total_current_liabilities", "long_term_debt", "total_liabilities", "total_equity", "total_shareholders_equity"],
  cash: ["net_income", "depreciation_amortization", "stock_based_compensation", "operating_cash_flow", "net_cash_from_operating_activities", "capital_expenditure", "free_cash_flow", "acquisitions", "investing_cash_flow", "dividends_paid", "share_repurchases", "financing_cash_flow"],
};
const META_KEYS = new Set(["period_ending", "fiscal_period", "fiscal_year", "symbol", "cik", "currency", "filing_date", "accepted_date", "reported_currency", "period", "date"]);

export function FundamentalsPanel({ symbol, panel, setOpts }: PanelProps) {
  const statement: string = panel.opts?.statement ?? "income";
  const period: string = panel.opts?.period ?? "annual";
  const { data, error, loading, reload } = useAsync(
    () => (symbol ? api.fundamentals(symbol, statement, period, period === "annual" ? 5 : 8) : Promise.resolve(undefined)),
    [symbol, statement, period],
  );
  const rows = useMemo(() => [...(data?.data ?? [])].sort((a, b) => String(b.period_ending ?? b.date).localeCompare(String(a.period_ending ?? a.date))), [data]);
  const lineItems = useMemo(() => {
    const keys = new Set<string>();
    for (const r of rows) for (const [k, v] of Object.entries(r)) if (!META_KEYS.has(k) && typeof v === "number") keys.add(k);
    const order = FA_ORDER[statement] ?? [];
    return [...keys].sort((a, b) => (order.indexOf(a) === -1 ? 999 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 999 : order.indexOf(b)));
  }, [rows, statement]);
  if (!symbol) return <NeedSymbol />;
  return (
    <div className="panel-fill">
      <div className="toolbar">
        <Tabs value={statement} onChange={(v) => setOpts({ statement: v })} options={[{ value: "income", label: "Income" }, { value: "balance", label: "Balance Sheet" }, { value: "cash", label: "Cash Flow" }]} />
        <Tabs value={period} onChange={(v) => setOpts({ period: v })} options={[{ value: "annual", label: "Annual" }, { value: "quarter", label: "Quarterly" }]} />
        <span className="grow" />
        <SourceBadge source={data?.source} provider={data?.provider} />
      </div>
      <div className="scroll">
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !rows.length ? (
          <Loading />
        ) : !rows.length ? (
          <Empty>No statements</Empty>
        ) : (
          <table className="tbl tbl-dense fa">
            <thead>
              <tr>
                <th>{symbol} · {labelize(statement)}</th>
                {rows.map((r, i) => (
                  <th key={i} style={{ textAlign: "right" }}>
                    {r.fiscal_period && r.fiscal_period !== "FY" ? `${r.fiscal_period} ` : ""}
                    {String(r.period_ending ?? r.date ?? "").slice(0, period === "annual" ? 4 : 7)}
                  </th>
                ))}
                <th style={{ textAlign: "right" }}>Growth</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((k) => {
                const latest = rows[0]?.[k];
                const prior = rows[1]?.[k];
                const g = isNum(latest) && isNum(prior) && prior !== 0 ? latest / Math.abs(prior) - Math.sign(prior) : null;
                return (
                  <tr key={k}>
                    <td>{labelize(k)}</td>
                    {rows.map((r, i) => (
                      <td key={i} style={{ textAlign: "right" }}>
                        {/eps|per_share/.test(k) ? fmtPrice(r[k]) : fmtBig(r[k])}
                      </td>
                    ))}
                    <td style={{ textAlign: "right" }}>
                      <Chg v={g}>{fmtPct(g, 1)}</Chg>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- OMON
export function OptionsPanel({ symbol, panel, setOpts }: PanelProps) {
  const { data, error, loading, reload } = useAsync(() => (symbol ? api.options(symbol) : Promise.resolve(undefined)), [symbol], 60_000);
  const rows = data?.data ?? [];
  const expirations = useMemo(() => [...new Set(rows.map((r) => String(r.expiration).slice(0, 10)))].sort(), [rows]);
  const exp: string = panel.opts?.expiration && expirations.includes(panel.opts.expiration) ? panel.opts.expiration : expirations[0];
  const width: number = panel.opts?.width ?? 10;
  const view: string = panel.opts?.view ?? "chain";
  const spot = rows.find((r) => isNum(r.underlying_price))?.underlying_price as number | undefined;
  const q = useQuote(symbol);
  const px = q?.last ?? spot;

  const chain = useMemo(() => {
    const byStrike = new Map<number, { call?: any; put?: any }>();
    for (const r of rows) {
      if (String(r.expiration).slice(0, 10) !== exp) continue;
      const k = Number(r.strike);
      const e = byStrike.get(k) ?? {};
      if (String(r.option_type).toLowerCase().startsWith("c")) e.call = r;
      else e.put = r;
      byStrike.set(k, e);
    }
    let strikes = [...byStrike.keys()].sort((a, b) => a - b);
    if (px && strikes.length) {
      const atm = strikes.reduce((best, k) => (Math.abs(k - px) < Math.abs(best - px) ? k : best), strikes[0]);
      const i = strikes.indexOf(atm);
      strikes = strikes.slice(Math.max(0, i - width), i + width + 1);
    }
    return strikes.map((k) => ({ strike: k, ...byStrike.get(k)! }));
  }, [rows, exp, px, width]);

  const totals = useMemo(() => {
    let cOI = 0, pOI = 0, cV = 0, pV = 0;
    for (const r of rows) {
      if (String(r.expiration).slice(0, 10) !== exp) continue;
      const call = String(r.option_type).toLowerCase().startsWith("c");
      if (call) { cOI += r.open_interest ?? 0; cV += r.volume ?? 0; } else { pOI += r.open_interest ?? 0; pV += r.volume ?? 0; }
    }
    return { cOI, pOI, cV, pV };
  }, [rows, exp]);

  if (!symbol) return <NeedSymbol />;
  const cell = (r: any, k: string, f: (v: any) => string = (v) => fmtPrice(v, 2)) => (r && r[k] !== undefined && r[k] !== null ? f(r[k]) : "—");
  const iv = (v: number) => fmtPct(v, 1, false);
  return (
    <div className="panel-fill">
      <div className="toolbar">
        <select className="input" value={exp ?? ""} onChange={(e) => setOpts({ expiration: e.target.value })}>
          {expirations.map((e) => {
            const dte = Math.ceil((new Date(e).getTime() - Date.now()) / 86400000);
            return (
              <option key={e} value={e}>
                {e} ({Math.max(dte, 0)}d)
              </option>
            );
          })}
        </select>
        <select className="input" value={width} onChange={(e) => setOpts({ width: Number(e.target.value) })}>
          {[5, 10, 15, 25, 50].map((w) => (
            <option key={w} value={w}>
              ±{w} strikes
            </option>
          ))}
        </select>
        <Tabs value={view} onChange={(v) => setOpts({ view: v })} options={[{ value: "chain", label: "Chain" }, { value: "smile", label: "IV Smile" }, { value: "oi", label: "OI Profile" }]} />
        <span className="muted">
          Spot {fmtPrice(px)} · P/C OI {totals.cOI ? (totals.pOI / totals.cOI).toFixed(2) : "—"} · P/C Vol {totals.cV ? (totals.pV / totals.cV).toFixed(2) : "—"}
        </span>
        <span className="grow" />
        <SourceBadge source={data?.source} provider={data?.provider} />
      </div>
      <div className="scroll">
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !rows.length ? (
          <Loading />
        ) : !chain.length ? (
          <Empty>No option chain</Empty>
        ) : view === "smile" ? (
          <SmileChart chain={chain} spot={px} />
        ) : view === "oi" ? (
          <OIChart chain={chain} spot={px} />
        ) : (
          <table className="tbl tbl-dense chain">
            <thead>
              <tr>
                <th colSpan={7} className="calls-h">CALLS</th>
                <th className="strike-h">Strike</th>
                <th colSpan={7} className="puts-h">PUTS</th>
              </tr>
              <tr>
                {["Bid", "Ask", "Last", "IV", "Δ", "Vol", "OI"].map((h) => (
                  <th key={`c${h}`} style={{ textAlign: "right" }}>{h}</th>
                ))}
                <th />
                {["Bid", "Ask", "Last", "IV", "Δ", "Vol", "OI"].map((h) => (
                  <th key={`p${h}`} style={{ textAlign: "right" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chain.map((row) => {
                const itmC = px !== undefined && row.strike < px;
                const itmP = px !== undefined && row.strike > px;
                return (
                  <tr key={row.strike}>
                    <td className={itmC ? "itm" : ""}>{cell(row.call, "bid")}</td>
                    <td className={itmC ? "itm" : ""}>{cell(row.call, "ask")}</td>
                    <td className={itmC ? "itm" : ""}>{cell(row.call, "last_trade_price")}</td>
                    <td className={itmC ? "itm" : ""}>{cell(row.call, "implied_volatility", iv)}</td>
                    <td className={itmC ? "itm" : ""}>{cell(row.call, "delta", (v) => Number(v).toFixed(2))}</td>
                    <td className={itmC ? "itm" : ""}>{cell(row.call, "volume", fmtInt)}</td>
                    <td className={itmC ? "itm" : ""}>{cell(row.call, "open_interest", fmtInt)}</td>
                    <td className="strike">{fmtPrice(row.strike)}</td>
                    <td className={itmP ? "itm" : ""}>{cell(row.put, "bid")}</td>
                    <td className={itmP ? "itm" : ""}>{cell(row.put, "ask")}</td>
                    <td className={itmP ? "itm" : ""}>{cell(row.put, "last_trade_price")}</td>
                    <td className={itmP ? "itm" : ""}>{cell(row.put, "implied_volatility", iv)}</td>
                    <td className={itmP ? "itm" : ""}>{cell(row.put, "delta", (v) => Number(v).toFixed(2))}</td>
                    <td className={itmP ? "itm" : ""}>{cell(row.put, "volume", fmtInt)}</td>
                    <td className={itmP ? "itm" : ""}>{cell(row.put, "open_interest", fmtInt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function SvgFrame({ children, xTicks, yTicks, w = 600, h = 260 }: { children: React.ReactNode; xTicks: { x: number; label: string }[]; yTicks: { y: number; label: string }[]; w?: number; h?: number }) {
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="svgchart" preserveAspectRatio="none">
      {yTicks.map((t) => (
        <g key={`y${t.label}${t.y}`}>
          <line x1={40} x2={w - 10} y1={t.y} y2={t.y} className="gridline" />
          <text x={36} y={t.y + 3} textAnchor="end" className="axis">{t.label}</text>
        </g>
      ))}
      {xTicks.map((t) => (
        <text key={`x${t.label}${t.x}`} x={t.x} y={h - 6} textAnchor="middle" className="axis">{t.label}</text>
      ))}
      {children}
    </svg>
  );
}

function scale(d0: number, d1: number, r0: number, r1: number) {
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

function ticks(min: number, max: number, n = 5) {
  const step = (max - min) / (n - 1 || 1);
  return Array.from({ length: n }, (_, i) => min + step * i);
}

function SmileChart({ chain, spot }: { chain: { strike: number; call?: any; put?: any }[]; spot?: number }) {
  const W = 600, H = 260;
  const pts = (side: "call" | "put") => chain.filter((r) => isNum(r[side]?.implied_volatility)).map((r) => [r.strike, r[side].implied_volatility as number] as const);
  const all = [...pts("call"), ...pts("put")];
  if (!all.length) return <Empty>No implied volatility in this chain</Empty>;
  const xs = chain.map((r) => r.strike);
  const ys = all.map((p) => p[1]);
  const x = scale(Math.min(...xs), Math.max(...xs), 45, W - 15);
  const yMin = Math.min(...ys) * 0.95, yMax = Math.max(...ys) * 1.05;
  const y = scale(yMin, yMax, H - 25, 10);
  const path = (p: readonly (readonly [number, number])[]) => p.map(([a, b], i) => `${i ? "L" : "M"}${x(a).toFixed(1)},${y(b).toFixed(1)}`).join(" ");
  return (
    <div className="pad">
      <SvgFrame w={W} h={H} yTicks={ticks(yMin, yMax).map((v) => ({ y: y(v), label: fmtPct(v, 0, false) }))} xTicks={ticks(Math.min(...xs), Math.max(...xs)).map((v) => ({ x: x(v), label: fmtPrice(v, 0) }))}>
        <path d={path(pts("call"))} className="line-c1" />
        <path d={path(pts("put"))} className="line-c2" />
        {spot !== undefined && <line x1={x(spot)} x2={x(spot)} y1={10} y2={H - 25} className="spotline" />}
      </SvgFrame>
      <div className="legend"><span className="sw sw-c1" />Calls <span className="sw sw-c2" />Puts <span className="sw sw-spot" />Spot</div>
    </div>
  );
}

function OIChart({ chain, spot }: { chain: { strike: number; call?: any; put?: any }[]; spot?: number }) {
  const W = 600, H = 260;
  const max = Math.max(1, ...chain.map((r) => Math.max(r.call?.open_interest ?? 0, r.put?.open_interest ?? 0)));
  const xs = chain.map((r) => r.strike);
  const x = scale(Math.min(...xs), Math.max(...xs), 50, W - 20);
  const bw = Math.max(2, ((W - 70) / chain.length) * 0.4);
  const y = scale(0, max, H - 25, 10);
  return (
    <div className="pad">
      <SvgFrame w={W} h={H} yTicks={ticks(0, max).map((v) => ({ y: y(v), label: fmtBig(v, 0) }))} xTicks={ticks(Math.min(...xs), Math.max(...xs)).map((v) => ({ x: x(v), label: fmtPrice(v, 0) }))}>
        {chain.map((r) => (
          <g key={r.strike}>
            <rect x={x(r.strike) - bw} width={bw} y={y(r.call?.open_interest ?? 0)} height={H - 25 - y(r.call?.open_interest ?? 0)} className="bar-c1" />
            <rect x={x(r.strike)} width={bw} y={y(r.put?.open_interest ?? 0)} height={H - 25 - y(r.put?.open_interest ?? 0)} className="bar-c2" />
          </g>
        ))}
        {spot !== undefined && <line x1={x(spot)} x2={x(spot)} y1={10} y2={H - 25} className="spotline" />}
      </SvgFrame>
      <div className="legend"><span className="sw sw-c1" />Call OI <span className="sw sw-c2" />Put OI <span className="sw sw-spot" />Spot</div>
    </div>
  );
}

// ---------------------------------------------------------------- TECH
export function InsightsPanel({ symbol }: PanelProps) {
  const { data, error, loading, reload } = useAsync(() => (symbol ? api.insights(symbol) : Promise.resolve(undefined)), [symbol], 120_000);
  if (!symbol) return <NeedSymbol />;
  const d = data?.data;
  const s = d?.stats ?? {};
  return (
    <div className="panel-fill">
      <div className="toolbar">
        {d && <span className={`bias bias-${d.bias}`}>{String(d.bias).toUpperCase()} · score {d.score > 0 ? `+${d.score}` : d.score}</span>}
        <span className="grow" />
        <SourceBadge source={data?.source} provider={data?.provider} />
      </div>
      <div className="scroll pad">
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !d ? (
          <Loading />
        ) : (
          <>
            <ul className="signals">
              {(d?.signals ?? []).map((sg: any, i: number) => (
                <li key={i} className={`sig-${sg.type}`}>
                  <span className="sig-dot" />
                  {sg.text}
                </li>
              ))}
              {!d?.signals?.length && <li className="muted">No signals.</li>}
            </ul>
            <div className="des-grid">
              <KV
                items={[
                  ["1D", <Chg v={s.return_1d}>{fmtPct(s.return_1d)}</Chg>],
                  ["1W", <Chg v={s.return_1w}>{fmtPct(s.return_1w)}</Chg>],
                  ["1M", <Chg v={s.return_1m}>{fmtPct(s.return_1m)}</Chg>],
                  ["3M", <Chg v={s.return_3m}>{fmtPct(s.return_3m)}</Chg>],
                  ["YTD", <Chg v={s.return_ytd}>{fmtPct(s.return_ytd)}</Chg>],
                  ["1Y", <Chg v={s.return_1y}>{fmtPct(s.return_1y)}</Chg>],
                  ["Max DD 1Y", <span className="down">{fmtPct(s.max_drawdown_1y)}</span>],
                ]}
              />
              <KV
                items={[
                  ["SMA 20/50/200", `${fmtPrice(s.sma20)} / ${fmtPrice(s.sma50)} / ${fmtPrice(s.sma200)}`],
                  ["RSI 14", isNum(s.rsi14) ? s.rsi14.toFixed(1) : "—"],
                  ["MACD / Sig", `${isNum(s.macd) ? s.macd.toFixed(2) : "—"} / ${isNum(s.macd_signal) ? s.macd_signal.toFixed(2) : "—"}`],
                  ["ATR 14", fmtPrice(s.atr14)],
                  ["Vol 20D / 1Y", `${fmtPct(s.realized_vol_20d, 1, false)} / ${fmtPct(s.realized_vol_1y, 1, false)}`],
                  ["Bollinger", `${fmtPrice(s.bollinger_lower)} – ${fmtPrice(s.bollinger_upper)}`],
                  ["Vol vs 20D avg", isNum(s.volume_ratio) ? `${s.volume_ratio.toFixed(2)}x` : "—"],
                ]}
              />
            </div>
            <p className="muted small">Rule-based signals computed from daily bars. Educational, not a recommendation.</p>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- CF
export function FilingsPanel({ symbol, panel, setOpts }: PanelProps) {
  const tab: string = panel.opts?.tab ?? "filings";
  const { data, error, loading, reload } = useAsync(
    () => (symbol ? (tab === "filings" ? api.filings(symbol) : api.insider(symbol)) : Promise.resolve(undefined)),
    [symbol, tab],
  );
  const [form, setForm] = useState("");
  if (!symbol) return <NeedSymbol />;
  const rows = (data?.data ?? []).filter((r) => !form || String(r.report_type ?? r.form_type ?? "").toUpperCase().includes(form.toUpperCase()));
  return (
    <div className="panel-fill">
      <div className="toolbar">
        <Tabs value={tab} onChange={(v) => setOpts({ tab: v })} options={[{ value: "filings", label: "Filings" }, { value: "insider", label: "Insiders" }]} />
        {tab === "filings" && <input className="input" placeholder="form filter (10-K)" value={form} onChange={(e) => setForm(e.target.value)} style={{ width: 120 }} />}
        <span className="grow" />
        <SourceBadge source={data?.source} provider={data?.provider} />
      </div>
      <div className="scroll">
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !rows.length ? (
          <Loading />
        ) : tab === "filings" ? (
          <DataTable
            rows={rows}
            columns={[
              { key: "filing_date", label: "Date", render: (r) => fmtDate(r.filing_date ?? r.date) },
              { key: "report_type", label: "Form", render: (r) => <span className="accent">{r.report_type ?? r.form_type}</span> },
              { key: "description", render: (r) => <span className="ellipsis">{r.description ?? r.primary_doc_description ?? r.report_date ?? ""}</span> },
              {
                key: "url",
                label: "",
                render: (r) => {
                  const u = r.report_url ?? r.filing_detail_url ?? r.url;
                  return u ? (
                    <a href={u} target="_blank" rel="noreferrer noopener">
                      open ↗
                    </a>
                  ) : (
                    ""
                  );
                },
              },
            ]}
          />
        ) : rows.length && rows[0].owner_name !== undefined ? (
          <DataTable
            rows={rows}
            columns={[
              { key: "transaction_date", label: "Date", render: (r) => fmtDate(r.transaction_date ?? r.filing_date) },
              { key: "owner_name", label: "Insider", render: (r) => <span className="ellipsis">{r.owner_name}</span> },
              { key: "owner_title", label: "Title", render: (r) => <span className="ellipsis muted">{r.owner_title ?? ""}</span> },
              { key: "transaction_type", label: "Type", render: (r) => <span className={/sale|sell|S-/i.test(String(r.transaction_type ?? r.acquisition_or_disposition)) ? "down" : "up"}>{r.transaction_type ?? r.acquisition_or_disposition ?? "—"}</span> },
              { key: "securities_transacted", label: "Shares", align: "right", render: (r) => fmtInt(r.securities_transacted) },
              { key: "transaction_price", label: "Price", align: "right", render: (r) => fmtPrice(r.transaction_price) },
              { key: "value", align: "right", render: (r) => fmtBig(r.value ?? (isNum(r.securities_transacted) && isNum(r.transaction_price) ? r.securities_transacted * r.transaction_price : null)) },
            ]}
          />
        ) : (
          <AutoTable rows={rows} />
        )}
      </div>
    </div>
  );
}
