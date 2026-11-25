import { useCallback, useMemo, useState } from "react";
import { api, type Quote, type Watchlist } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { useQuotes } from "../lib/stream";
import { fmtBig, fmtChange, fmtDate, fmtPct, fmtPrice, fmtTime, isNum, tone } from "../lib/format";
import { Chg, DataTable, Empty, ErrorState, Flash, Loading, SourceBadge, Tabs, type Column } from "../components/ui";
import type { PanelProps } from "./types";

// ---------------------------------------------------------------- Monitor
export function MonitorPanel({ panel, setOpts, setSymbol, run }: PanelProps) {
  const lists = useAsync(() => api.watchlists(), []);
  const wl: Watchlist | undefined = lists.data?.find((w) => w.id === panel.opts?.watchlist) ?? lists.data?.[0];
  const quotes = useQuotes(wl?.symbols ?? []);
  const [adding, setAdding] = useState("");

  const save = useCallback(
    async (symbols: string[]) => {
      if (!wl) return;
      await api.updateWatchlist(wl.id, { symbols });
      lists.reload();
    },
    [wl, lists],
  );

  const rows = (wl?.symbols ?? []).map((s) => ({ symbol: s, q: quotes[s] }));
  const cols: Column<{ symbol: string; q?: Quote }>[] = [
    { key: "symbol", label: "Ticker", render: (r) => <span className="sym">{r.symbol}</span> },
    { key: "last", label: "Last", align: "right", sortValue: (r) => r.q?.last, render: (r) => <Flash value={r.q?.last}>{fmtPrice(r.q?.last)}</Flash> },
    { key: "chg", label: "Net", align: "right", sortValue: (r) => r.q?.change, render: (r) => <Chg v={r.q?.change}>{fmtChange(r.q?.change)}</Chg> },
    { key: "pct", label: "%Chg", align: "right", sortValue: (r) => r.q?.change_percent, render: (r) => <Chg v={r.q?.change_percent}>{fmtPct(r.q?.change_percent)}</Chg> },
    { key: "bid", label: "Bid", align: "right", render: (r) => fmtPrice(r.q?.bid) },
    { key: "ask", label: "Ask", align: "right", render: (r) => fmtPrice(r.q?.ask) },
    { key: "vol", label: "Volume", align: "right", sortValue: (r) => r.q?.volume, render: (r) => fmtBig(r.q?.volume) },
    { key: "rng", label: "Day Range", align: "right", render: (r) => <RangeBar lo={r.q?.low} hi={r.q?.high} v={r.q?.last} /> },
    { key: "x", label: "", align: "center", render: (r) => (
      <button className="icon-btn" title="Remove" onClick={(e) => { e.stopPropagation(); save((wl?.symbols ?? []).filter((s) => s !== r.symbol)); }}>×</button>
    ) },
  ];
  const source = rows.find((r) => r.q)?.q?.source;

  return (
    <div className="panel-fill">
      <div className="toolbar">
        <select className="input" value={wl?.id ?? ""} onChange={(e) => setOpts({ watchlist: e.target.value })}>
          {lists.data?.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.symbols.length})
            </option>
          ))}
        </select>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const add = adding.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
            if (add.length) save([...(wl?.symbols ?? []), ...add]);
            setAdding("");
          }}
        >
          <input className="input" placeholder="+ add tickers" value={adding} onChange={(e) => setAdding(e.target.value)} style={{ width: 110 }} />
        </form>
        <button
          className="btn"
          onClick={async () => {
            const name = prompt("New watchlist name");
            if (name) {
              const w = await api.createWatchlist(name, []);
              await lists.reload();
              setOpts({ watchlist: w.id });
            }
          }}
        >
          New
        </button>
        {wl && (lists.data?.length ?? 0) > 1 && (
          <button
            className="btn"
            onClick={async () => {
              if (confirm(`Delete watchlist "${wl.name}"?`)) {
                await api.deleteWatchlist(wl.id);
                setOpts({ watchlist: undefined });
                lists.reload();
              }
            }}
          >
            Delete
          </button>
        )}
        <span className="grow" />
        <SourceBadge source={source} />
      </div>
      <div className="scroll">
        {lists.error ? (
          <ErrorState error={lists.error} onRetry={lists.reload} />
        ) : !wl ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty>Watchlist is empty — add tickers above.</Empty>
        ) : (
          <DataTable rows={rows} columns={cols} rowKey={(r) => r.symbol} onRowClick={(r) => setSymbol(r.symbol)} />
        )}
      </div>
      <div className="panel-foot">Click a row to load it into linked panels · <kbd className="clickable" onClick={() => run("GP")}>GP</kbd> opens a chart</div>
    </div>
  );
}

export function RangeBar({ lo, hi, v }: { lo?: number | null; hi?: number | null; v?: number | null }) {
  if (!isNum(lo) || !isNum(hi) || !isNum(v) || hi <= lo) return <span className="muted">—</span>;
  const pct = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  return (
    <span className="rangebar" title={`${fmtPrice(lo)} – ${fmtPrice(hi)}`}>
      <span className="rangebar-dot" style={{ left: `${pct * 100}%` }} />
    </span>
  );
}

// ---------------------------------------------------------------- Snapshot tables (indices, FX, crypto, commodities)
function SnapshotPanel({ loader, setSymbol, showRegion, unit }: { loader: () => Promise<any>; setSymbol: (s: string) => void; showRegion?: boolean; unit?: boolean }) {
  const { data, error, loading, reload } = useAsync(loader, [], 15_000);
  const rows: Record<string, any>[] = data?.data ?? [];
  const cols: Column<Record<string, any>>[] = [
    { key: "symbol", label: "Ticker", render: (r) => <span className="sym">{r.symbol}</span> },
    { key: "name", label: "Name", render: (r) => <span className="ellipsis">{r.name}</span> },
    ...(unit ? [{ key: "unit", label: "Unit", render: (r: Record<string, any>) => <span className="muted">{r.unit ?? r.units ?? ""}</span> }] : []),
    { key: "price", label: "Last", align: "right", render: (r) => <Flash value={r.price}>{fmtPrice(r.price ?? r.value)}</Flash> },
    { key: "change", label: "Net", align: "right", render: (r) => <Chg v={r.change}>{fmtChange(r.change)}</Chg> },
    { key: "change_percent", label: "%Chg", align: "right", render: (r) => <Chg v={r.change_percent}>{fmtPct(r.change_percent)}</Chg> },
  ];
  const grouped = showRegion ? groupBy(rows, (r) => r.region ?? "Other") : { "": rows };
  return (
    <div className="panel-fill">
      <div className="toolbar">
        <span className="grow" />
        <SourceBadge source={data?.source} provider={data?.provider} />
      </div>
      <div className="scroll">
        {error && !rows.length ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !rows.length ? (
          <Loading />
        ) : (
          Object.entries(grouped).map(([g, rs]) => (
            <div key={g}>
              {g && <div className="group-h">{g}</div>}
              <DataTable rows={rs} columns={cols} rowKey={(r) => r.symbol} onRowClick={(r) => r.symbol && setSymbol(r.symbol)} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function groupBy<T>(rows: T[], key: (r: T) => string) {
  const out: Record<string, T[]> = {};
  for (const r of rows) (out[key(r)] ??= []).push(r);
  return out;
}

export const WorldPanel = (p: PanelProps) => <SnapshotPanel loader={api.world} setSymbol={p.setSymbol} showRegion />;
export const FxPanel = (p: PanelProps) => <SnapshotPanel loader={api.fx} setSymbol={p.setSymbol} />;
export const CryptoPanel = (p: PanelProps) => <SnapshotPanel loader={api.crypto} setSymbol={p.setSymbol} />;
export const CommoditiesPanel = (p: PanelProps) => <SnapshotPanel loader={api.commodities} setSymbol={p.setSymbol} unit />;

// ---------------------------------------------------------------- Movers
export function MoversPanel({ panel, setOpts, setSymbol }: PanelProps) {
  const tab: string = panel.opts?.tab ?? "gainers";
  const { data, error, loading, reload } = useAsync(() => api.movers(), [], 30_000);
  const rows = data?.data?.[tab] ?? [];
  return (
    <div className="panel-fill">
      <div className="toolbar">
        <Tabs value={tab} onChange={(v) => setOpts({ tab: v })} options={[{ value: "gainers", label: "Gainers" }, { value: "losers", label: "Losers" }, { value: "active", label: "Most Active" }]} />
        <span className="grow" />
        <SourceBadge source={data?.source} provider={data?.provider} />
      </div>
      <div className="scroll">
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <Loading />
        ) : (
          <DataTable
            rows={rows}
            rowKey={(r) => r.symbol}
            onRowClick={(r) => setSymbol(r.symbol)}
            columns={[
              { key: "symbol", label: "Ticker", render: (r) => <span className="sym">{r.symbol}</span> },
              { key: "name", render: (r) => <span className="ellipsis">{r.name}</span> },
              { key: "price", label: "Last", align: "right", render: (r) => fmtPrice(r.price) },
              { key: "change_percent", label: "%Chg", align: "right", render: (r) => <Chg v={r.change_percent}>{fmtPct(r.change_percent)}</Chg> },
              { key: "volume", align: "right", render: (r) => fmtBig(r.volume) },
            ]}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Sector heatmap
export function SectorsPanel({ run }: PanelProps) {
  const { data, error, loading, reload } = useAsync(() => api.sectors(), [], 30_000);
  const rows: Record<string, any>[] = data?.data ?? [];
  const maxAbs = Math.max(0.005, ...rows.map((r) => Math.abs(r.change_percent ?? 0)));
  return (
    <div className="panel-fill">
      <div className="toolbar">
        <span className="muted">Sector performance, today</span>
        <span className="grow" />
        <SourceBadge source={data?.source} provider={data?.provider} />
      </div>
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !rows.length ? (
        <Loading />
      ) : (
        <div className="heatmap">
          {rows.map((r) => {
            const v = r.change_percent ?? 0;
            const a = Math.min(1, Math.abs(v) / maxAbs);
            return (
              <div
                key={r.sector}
                className={`heat-cell ${r.symbol ? "clickable" : ""}`}
                style={{ background: `color-mix(in srgb, ${v >= 0 ? "var(--up)" : "var(--down)"} ${Math.round(15 + a * 60)}%, var(--panel))` }}
                onClick={() => r.symbol && run(`${r.symbol} GP`)}
              >
                <div className="heat-name">{r.sector}</div>
                <div className="heat-val">{fmtPct(v)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- News
export function NewsPanel({ symbol, panel, setOpts }: PanelProps) {
  const scope: "security" | "market" = panel.opts?.scope ?? (symbol ? "security" : "market");
  const syms = scope === "security" && symbol ? [symbol] : undefined;
  const { data, error, loading, reload } = useAsync(() => api.news(syms, 50), [syms?.join(",")], 120_000);
  const [open, setOpen] = useState<number | null>(null);
  const rows = data?.data ?? [];
  return (
    <div className="panel-fill">
      <div className="toolbar">
        <Tabs value={scope} onChange={(v) => setOpts({ scope: v })} options={[{ value: "security", label: symbol ? `${symbol}` : "Security" }, { value: "market", label: "Top News" }]} />
        <span className="grow" />
        <SourceBadge source={data?.source} provider={data?.provider} />
      </div>
      <div className="scroll">
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !rows.length ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty>No headlines</Empty>
        ) : (
          <ul className="news">
            {rows.map((n, i) => (
              <li key={i} className={open === i ? "open" : ""} onClick={() => setOpen(open === i ? null : i)}>
                <span className="news-time">{fmtTime(n.date)}</span>
                <span className="news-title">{n.title}</span>
                <span className="news-src">{[n.source, typeof n.symbols === "string" ? n.symbols : ""].filter(Boolean).join(" · ")}</span>
                {open === i && (
                  <div className="news-body">
                    {n.excerpt && <p>{String(n.excerpt).slice(0, 800)}</p>}
                    {n.url && (
                      <a href={n.url} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>
                        Open story ↗
                      </a>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Calendars
export function EarningsPanel({ setSymbol }: PanelProps) {
  const { data, error, loading, reload } = useAsync(() => api.earnings(), [], 600_000);
  const rows = data?.data ?? [];
  return (
    <div className="panel-fill">
      <div className="toolbar">
        <span className="muted">Next two weeks</span>
        <span className="grow" />
        <SourceBadge source={data?.source} provider={data?.provider} />
      </div>
      <div className="scroll">
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !rows.length ? (
          <Loading />
        ) : (
          <DataTable
            rows={rows}
            onRowClick={(r) => r.symbol && setSymbol(r.symbol)}
            columns={[
              { key: "report_date", label: "Date", render: (r) => fmtDate(r.report_date) },
              { key: "symbol", label: "Ticker", render: (r) => <span className="sym">{r.symbol}</span> },
              { key: "name", render: (r) => <span className="ellipsis">{r.name}</span> },
              { key: "time", label: "When", render: (r) => r.time ?? r.reporting_time ?? "—" },
              { key: "eps_consensus", label: "EPS Est", align: "right", render: (r) => fmtPrice(r.eps_consensus) },
              { key: "eps_previous", label: "EPS Prior", align: "right", render: (r) => fmtPrice(r.eps_previous) },
            ]}
          />
        )}
      </div>
    </div>
  );
}

export function EcoPanel({ panel, setOpts }: PanelProps) {
  const { data, error, loading, reload } = useAsync(() => api.economic(), [], 300_000);
  const filter: string = panel.opts?.country ?? "ALL";
  const rows = useMemo(() => (data?.data ?? []).filter((r) => filter === "ALL" || r.country === filter), [data, filter]);
  const countries = useMemo(() => ["ALL", ...new Set((data?.data ?? []).map((r) => r.country).filter(Boolean))], [data]);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="panel-fill">
      <div className="toolbar">
        <select className="input" value={filter} onChange={(e) => setOpts({ country: e.target.value })}>
          {countries.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <span className="grow" />
        <SourceBadge source={data?.source} provider={data?.provider} />
      </div>
      <div className="scroll">
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !rows.length ? (
          <Loading />
        ) : (
          <DataTable
            rows={rows}
            rowClass={(r) => (String(r.date).slice(0, 10) === today ? "row-today" : "")}
            columns={[
              { key: "date", label: "Date/Time", render: (r) => fmtDate(r.date, true) },
              { key: "country", label: "Ctry" },
              { key: "event", render: (r) => <span className="ellipsis">{r.event}</span> },
              { key: "importance", label: "Imp", render: (r) => <span className={r.importance === "High" || r.importance === 3 ? "accent" : "muted"}>{String(r.importance ?? "")}</span> },
              { key: "actual", align: "right", render: (r) => <SurpriseCell actual={r.actual} consensus={r.consensus} unit={r.unit} /> },
              { key: "consensus", label: "Survey", align: "right", render: (r) => fmtVal(r.consensus, r.unit) },
              { key: "previous", label: "Prior", align: "right", render: (r) => fmtVal(r.previous, r.unit) },
            ]}
          />
        )}
      </div>
    </div>
  );
}

const fmtVal = (v: unknown, unit?: string) => (v === null || v === undefined || v === "" ? "—" : `${v}${unit && unit !== "" && typeof v === "number" ? unit : ""}`);

function SurpriseCell({ actual, consensus, unit }: { actual: unknown; consensus: unknown; unit?: string }) {
  if (actual === null || actual === undefined || actual === "") return <span className="muted">—</span>;
  const a = Number(actual);
  const c = Number(consensus);
  const t = Number.isFinite(a) && Number.isFinite(c) ? tone(a - c) : "flat";
  return <span className={t}>{fmtVal(actual, unit)}</span>;
}
