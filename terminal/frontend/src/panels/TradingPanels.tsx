import { useCallback, useEffect, useState } from "react";
import { api, type Order } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { useQuote, useQuotes, useStreamEvents, type StreamEvent } from "../lib/stream";
import { fmtBig, fmtChange, fmtDate, fmtInt, fmtMoney, fmtPct, fmtPrice, isNum, tone } from "../lib/format";
import { Chg, DataTable, Empty, ErrorState, Flash, KV, Loading, SourceBadge, Tabs } from "../components/ui";
import type { PanelProps } from "./types";

/** Reload when an order or alert event arrives over the stream. */
function useReloadOn(types: StreamEvent["type"][], reload: () => void) {
  const handler = useCallback((e: StreamEvent) => types.includes(e.type) && reload(), [reload, types.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  useStreamEvents(handler);
}

// ---------------------------------------------------------------- Ticket
export function TicketPanel({ symbol, setSymbol }: PanelProps) {
  const q = useQuote(symbol);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [qty, setQty] = useState("100");
  const [type, setType] = useState("market");
  const [limit, setLimit] = useState("");
  const [stop, setStop] = useState("");
  const [tif, setTif] = useState("day");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sym, setSym] = useState(symbol ?? "");
  useEffect(() => setSym(symbol ?? ""), [symbol]);

  const n = Number(qty);
  const px = type === "limit" || type === "stop_limit" ? Number(limit) : type === "stop" ? Number(stop) : side === "buy" ? (q?.ask ?? q?.last) : (q?.bid ?? q?.last);
  const notional = isNum(n) && isNum(px) ? n * px : null;

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const o = await api.submitOrder({
        symbol: sym,
        side,
        quantity: n,
        order_type: type,
        limit_price: type === "limit" || type === "stop_limit" ? Number(limit) : null,
        stop_price: type === "stop" || type === "stop_limit" ? Number(stop) : null,
        tif,
      });
      setMsg({
        ok: o.status !== "rejected",
        text:
          o.status === "filled"
            ? `FILLED ${o.side.toUpperCase()} ${fmtInt(o.quantity)} ${o.symbol} @ ${fmtPrice(o.filled_price)}`
            : o.status === "rejected"
              ? `REJECTED: ${o.reason}`
              : `WORKING ${o.side.toUpperCase()} ${fmtInt(o.quantity)} ${o.symbol} ${o.order_type.toUpperCase()}`,
      });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel-fill">
      <div className="scroll pad ticket">
        <div className="ticket-banner">PAPER TRADING · simulated fills, no real orders</div>
        <label>
          Security
          <input className="input" value={sym} onChange={(e) => setSym(e.target.value.toUpperCase())} onBlur={() => sym && sym !== symbol && setSymbol(sym)} />
        </label>
        <div className="ticket-quote">
          <div>
            <div className="muted small">BID</div>
            <Flash value={q?.bid} className="down big">{fmtPrice(q?.bid)}</Flash>
          </div>
          <div>
            <div className="muted small">LAST</div>
            <Flash value={q?.last} className="big">{fmtPrice(q?.last)}</Flash>
            <div className={`small ${tone(q?.change_percent)}`}>{fmtPct(q?.change_percent)}</div>
          </div>
          <div>
            <div className="muted small">ASK</div>
            <Flash value={q?.ask} className="up big">{fmtPrice(q?.ask)}</Flash>
          </div>
        </div>
        <div className="seg full">
          <button className={`seg-btn buy ${side === "buy" ? "active" : ""}`} onClick={() => setSide("buy")}>BUY</button>
          <button className={`seg-btn sell ${side === "sell" ? "active" : ""}`} onClick={() => setSide("sell")}>SELL</button>
        </div>
        <label>
          Quantity
          <input className="input" type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <div className="qty-presets">
          {[10, 100, 500, 1000].map((v) => (
            <button key={v} className="btn" onClick={() => setQty(String(v))}>{v}</button>
          ))}
        </div>
        <label>
          Type
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="market">Market</option>
            <option value="limit">Limit</option>
            <option value="stop">Stop</option>
            <option value="stop_limit">Stop Limit</option>
          </select>
        </label>
        {(type === "limit" || type === "stop_limit") && (
          <label>
            Limit
            <input className="input" type="number" step="0.01" value={limit} placeholder={fmtPrice(q?.last)} onChange={(e) => setLimit(e.target.value)} />
          </label>
        )}
        {(type === "stop" || type === "stop_limit") && (
          <label>
            Stop
            <input className="input" type="number" step="0.01" value={stop} placeholder={fmtPrice(q?.last)} onChange={(e) => setStop(e.target.value)} />
          </label>
        )}
        <label>
          Time in force
          <select className="input" value={tif} onChange={(e) => setTif(e.target.value)}>
            <option value="day">Day</option>
            <option value="gtc">GTC</option>
          </select>
        </label>
        <KV items={[["Est. notional", fmtMoney(notional)]]} />
        <button className={`btn btn-wide ${side}`} disabled={busy || !sym || !(n > 0)} onClick={submit}>
          {busy ? "Sending…" : `${side.toUpperCase()} ${qty || 0} ${sym}`}
        </button>
        {msg && <div className={msg.ok ? "ok-msg" : "state-error small"}>{msg.text}</div>}
        <p className="muted small">Tip: type <kbd>BUY 100 {sym || "AAPL"} LMT 200</kbd> in the command line.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Portfolio
export function PortfolioPanel({ setSymbol }: PanelProps) {
  const pf = useAsync(() => api.portfolio(), [], 5_000);
  const hist = useAsync(() => api.portfolioHistory(), [], 60_000);
  useReloadOn(["order"], pf.reload);
  const p = pf.data;
  const syms = p?.positions.map((x) => x.symbol) ?? [];
  const live = useQuotes(syms);

  if (pf.error && !p) return <ErrorState error={pf.error} onRetry={pf.reload} />;
  if (!p) return <Loading />;

  const rows = p.positions.map((pos) => {
    const q = live[pos.symbol];
    const last = q?.last ?? pos.last;
    return { ...pos, last, market_value: pos.quantity * last, unrealized_pnl: (last - pos.avg_cost) * pos.quantity };
  });
  const mv = rows.reduce((s, r) => s + r.market_value, 0);
  const unreal = rows.reduce((s, r) => s + r.unrealized_pnl, 0);
  const equity = p.cash + mv;
  const totalRet = p.account.initial_cash ? equity / p.account.initial_cash - 1 : null;
  const eq = hist.data ?? [];

  return (
    <div className="panel-fill">
      <div className="toolbar">
        <span className="muted">{p.account.name}</span>
        <span className="grow" />
        <button
          className="btn"
          onClick={async () => {
            const v = prompt("Reset paper account. Starting cash:", "1000000");
            if (v && Number(v) > 0) {
              await api.resetPortfolio(Number(v));
              pf.reload();
              hist.reload();
            }
          }}
        >
          Reset
        </button>
        <SourceBadge source={p.source} />
      </div>
      <div className="pf-summary">
        <div><div className="muted small">EQUITY</div><div className="big">{fmtMoney(equity, 0)}</div></div>
        <div><div className="muted small">CASH</div><div>{fmtMoney(p.cash, 0)}</div></div>
        <div><div className="muted small">UNREALIZED</div><div className={tone(unreal)}>{fmtMoney(unreal, 0)}</div></div>
        <div><div className="muted small">REALIZED</div><div className={tone(p.realized_pnl)}>{fmtMoney(p.realized_pnl, 0)}</div></div>
        <div><div className="muted small">TOTAL RET</div><div className={tone(totalRet)}>{fmtPct(totalRet)}</div></div>
      </div>
      {eq.length > 1 && <EquityCurve points={eq.map((x) => x.equity)} />}
      <div className="scroll">
        {rows.length === 0 ? (
          <Empty>No positions. Use the order ticket (TKT) or type BUY 100 AAPL.</Empty>
        ) : (
          <DataTable
            rows={rows}
            rowKey={(r) => r.symbol}
            onRowClick={(r) => setSymbol(r.symbol)}
            columns={[
              { key: "symbol", label: "Ticker", render: (r) => <span className="sym">{r.symbol}</span> },
              { key: "quantity", label: "Qty", align: "right", render: (r) => <span className={r.quantity < 0 ? "down" : ""}>{fmtInt(r.quantity)}</span> },
              { key: "avg_cost", label: "Avg Cost", align: "right", render: (r) => fmtPrice(r.avg_cost) },
              { key: "last", label: "Last", align: "right", render: (r) => <Flash value={r.last}>{fmtPrice(r.last)}</Flash> },
              { key: "market_value", label: "Mkt Val", align: "right", render: (r) => fmtBig(r.market_value) },
              { key: "unrealized_pnl", label: "Unrl P&L", align: "right", render: (r) => <Chg v={r.unrealized_pnl}>{fmtChange(r.unrealized_pnl, 0)}</Chg> },
              { key: "pct", label: "%", align: "right", sortValue: (r) => r.unrealized_pnl / Math.abs(r.avg_cost * r.quantity || 1), render: (r) => <Chg v={r.unrealized_pnl}>{fmtPct(r.avg_cost ? r.unrealized_pnl / Math.abs(r.avg_cost * r.quantity) : null)}</Chg> },
              { key: "weight", label: "Wt", align: "right", render: (r) => fmtPct(equity ? r.market_value / equity : null, 1, false) },
            ]}
          />
        )}
      </div>
    </div>
  );
}

function EquityCurve({ points }: { points: number[] }) {
  const W = 600, H = 60;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const d = points.map((v, i) => `${i ? "L" : "M"}${((i / (points.length - 1)) * W).toFixed(1)},${(H - 4 - ((v - min) / span) * (H - 8)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="equity-curve">
      <path d={d} fill="none" stroke={points[points.length - 1] >= points[0] ? "var(--up)" : "var(--down)"} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ---------------------------------------------------------------- Blotter
export function BlotterPanel({ panel, setOpts }: PanelProps) {
  const { data, error, loading, reload } = useAsync(() => api.orders(), [], 10_000);
  useReloadOn(["order"], reload);
  const filter: string = panel.opts?.filter ?? "all";
  const rows = (data ?? []).filter((o) => filter === "all" || (filter === "working" ? o.status === "open" : o.status === filter));
  return (
    <div className="panel-fill">
      <div className="toolbar">
        <Tabs value={filter} onChange={(v) => setOpts({ filter: v })} options={[{ value: "all", label: "All" }, { value: "working", label: "Working" }, { value: "filled", label: "Filled" }, { value: "cancelled", label: "Cancelled" }]} />
      </div>
      <div className="scroll">
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty>No orders</Empty>
        ) : (
          <DataTable<Order>
            rows={rows}
            rowKey={(r) => r.id}
            columns={[
              { key: "created", label: "Time", render: (r) => fmtDate(r.created, true) },
              { key: "side", render: (r) => <span className={r.side === "buy" ? "up" : "down"}>{r.side.toUpperCase()}</span> },
              { key: "quantity", label: "Qty", align: "right", render: (r) => fmtInt(r.quantity) },
              { key: "symbol", label: "Ticker", render: (r) => <span className="sym">{r.symbol}</span> },
              { key: "order_type", label: "Type", render: (r) => r.order_type.toUpperCase() },
              { key: "limit_price", label: "Lmt", align: "right", render: (r) => fmtPrice(r.limit_price) },
              { key: "stop_price", label: "Stp", align: "right", render: (r) => fmtPrice(r.stop_price) },
              { key: "tif", label: "TIF", render: (r) => r.tif.toUpperCase() },
              { key: "status", render: (r) => <span className={`status status-${r.status}`} title={r.reason ?? ""}>{r.status === "open" ? "WORKING" : r.status.toUpperCase()}</span> },
              { key: "filled_price", label: "Fill", align: "right", render: (r) => fmtPrice(r.filled_price) },
              { key: "data_source", label: "Src", render: (r) => (r.data_source ? <SourceBadge source={r.data_source} /> : "") },
              {
                key: "x",
                label: "",
                render: (r) =>
                  r.status === "open" ? (
                    <button className="btn btn-xs" onClick={() => api.cancelOrder(r.id).then(reload)}>
                      Cancel
                    </button>
                  ) : null,
              },
            ]}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Alerts
export function AlertsPanel({ symbol }: PanelProps) {
  const { data, error, loading, reload } = useAsync(() => api.alerts(), [], 15_000);
  useReloadOn(["alert"], reload);
  const [sym, setSym] = useState(symbol ?? "");
  const [cond, setCond] = useState("above");
  const [val, setVal] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setSym(symbol ?? ""), [symbol]);
  const q = useQuote(sym || undefined);
  const syms = [...new Set((data ?? []).filter((a) => a.status === "active").map((a) => a.symbol))];
  const quotes = useQuotes(syms);

  return (
    <div className="panel-fill">
      <form
        className="toolbar"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          try {
            await api.addAlert({ symbol: sym, condition: cond, value: Number(val) });
            setVal("");
            reload();
          } catch (ex) {
            setErr(ex instanceof Error ? ex.message : String(ex));
          }
        }}
      >
        <input className="input" style={{ width: 70 }} value={sym} onChange={(e) => setSym(e.target.value.toUpperCase())} placeholder="Ticker" />
        <select className="input" value={cond} onChange={(e) => setCond(e.target.value)}>
          <option value="above">Price ≥</option>
          <option value="below">Price ≤</option>
          <option value="change_above">%Chg ≥</option>
          <option value="change_below">%Chg ≤</option>
        </select>
        <input className="input" style={{ width: 80 }} type="number" step="any" value={val} onChange={(e) => setVal(e.target.value)} placeholder={cond.startsWith("change") ? "%" : fmtPrice(q?.last)} />
        <button className="btn" disabled={!sym || val === ""}>Add</button>
        {err && <span className="state-error small">{err}</span>}
      </form>
      <div className="scroll">
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <Loading />
        ) : !data?.length ? (
          <Empty>No alerts. Try ALRT AAPL &gt; 250 in the command line.</Empty>
        ) : (
          <DataTable
            rows={data}
            rowKey={(r) => r.id}
            columns={[
              { key: "symbol", label: "Ticker", render: (r) => <span className="sym">{r.symbol}</span> },
              { key: "condition", label: "Condition", render: (r) => `${r.condition.startsWith("change") ? "%Chg" : "Price"} ${r.condition.endsWith("above") ? "≥" : "≤"} ${r.value}${r.condition.startsWith("change") ? "%" : ""}` },
              { key: "now", label: "Now", align: "right", render: (r) => (r.condition.startsWith("change") ? fmtPct(quotes[r.symbol]?.change_percent) : fmtPrice(quotes[r.symbol]?.last)) },
              { key: "status", render: (r) => <span className={`status status-${r.status}`}>{r.status.toUpperCase()}</span> },
              { key: "triggered_at", label: "Triggered", render: (r) => (r.triggered_at ? `${fmtDate(r.triggered_at, true)} @ ${fmtPrice(r.triggered_price)}` : "—") },
              { key: "x", label: "", render: (r) => <button className="icon-btn" onClick={() => api.deleteAlert(r.id).then(reload)}>×</button> },
            ]}
          />
        )}
      </div>
    </div>
  );
}
