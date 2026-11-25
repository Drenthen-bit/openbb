import { useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { api, type Envelope, type Status } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { fmtDate, fmtPct, isNum } from "../lib/format";
import { AutoTable, Empty, ErrorState, Loading, SourceBadge, Tabs } from "../components/ui";
import type { PanelProps } from "./types";

// ---------------------------------------------------------------- AI analyst
const PRESETS = [
  "Give me a one-paragraph read on this security: trend, momentum, and what stands out.",
  "What are the key risks to watch here, based on the data?",
  "Summarize the latest headlines and whether price action confirms them.",
  "How do the fundamentals look: growth, margins, and trajectory?",
];

export function AnalystPanel({ symbol, panel, setOpts }: PanelProps) {
  const status = useAsync<Status>(() => api.status(), []);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string>(panel.opts?.lastAnswer ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const withPf: boolean = panel.opts?.portfolio ?? false;
  const scoped: boolean = panel.opts?.scoped ?? true;

  const ask = async (q: string) => {
    if (!q.trim()) return;
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setBusy(true);
    setErr(null);
    setAnswer("");
    let acc = "";
    try {
      await api.analyst(q, scoped ? (symbol ?? null) : null, withPf, (chunk) => {
        acc += chunk;
        setAnswer(acc);
      }, ac.signal);
      setOpts({ lastAnswer: acc.slice(0, 20000), lastQuestion: q });
    } catch (e) {
      if ((e as Error).name !== "AbortError") setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const unavailable = status.data && !status.data.ai_available;
  return (
    <div className="panel-fill">
      <div className="toolbar">
        <label className="check">
          <input type="checkbox" checked={scoped} onChange={(e) => setOpts({ scoped: e.target.checked })} /> {symbol ?? "security"} context
        </label>
        <label className="check">
          <input type="checkbox" checked={withPf} onChange={(e) => setOpts({ portfolio: e.target.checked })} /> portfolio
        </label>
        <span className="grow" />
        {status.data?.ai_model && <span className="badge">{status.data.ai_model}</span>}
      </div>
      {unavailable ? (
        <div className="state">
          <div>AI analyst is off.</div>
          <div className="muted small">{status.data?.ai_reason}</div>
        </div>
      ) : (
        <>
          <div className="scroll pad analyst-out">
            {!answer && !busy && !err && (
              <div className="presets">
                {PRESETS.map((p) => (
                  <button key={p} className="preset" onClick={() => { setQuestion(p); ask(p); }}>
                    {p}
                  </button>
                ))}
              </div>
            )}
            {panel.opts?.lastQuestion && answer && <div className="muted small">Q: {panel.opts.lastQuestion}</div>}
            {answer && <ReactMarkdown>{answer}</ReactMarkdown>}
            {busy && !answer && <Loading label="Analyzing" />}
            {err && <ErrorState error={err} />}
          </div>
          <form
            className="analyst-in"
            onSubmit={(e) => {
              e.preventDefault();
              setOpts({ lastQuestion: question });
              ask(question);
            }}
          >
            <textarea
              className="input"
              rows={2}
              value={question}
              placeholder={`Ask about ${symbol ?? "the market"}… (Enter to send)`}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  setOpts({ lastQuestion: question });
                  ask(question);
                }
              }}
            />
            {busy ? (
              <button type="button" className="btn" onClick={() => abort.current?.abort()}>Stop</button>
            ) : (
              <button className="btn" disabled={!question.trim()}>Ask</button>
            )}
          </form>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Yield curve
export function YieldPanel({ panel, setOpts }: PanelProps) {
  const compare: string = panel.opts?.compare ?? "";
  const cur = useAsync(() => api.yieldCurve(), [], 600_000);
  const prev = useAsync(() => (compare ? api.yieldCurve(compare) : Promise.resolve(undefined)), [compare]);
  const rows = cur.data?.data ?? [];
  const prows = prev.data?.data ?? [];
  const W = 600, H = 250, L = 45, R = 15, T = 10, B = 28;
  const all = [...rows, ...prows].filter((r) => isNum(r.rate) && isNum(r.years));
  const label = (m: string) => String(m).replace("month_", "").replace("year_", "").toUpperCase() + (String(m).startsWith("month") ? "M" : "Y");
  const content = useMemo(() => {
    if (!all.length) return null;
    const ys = all.map((r) => r.rate as number);
    const yMin = Math.min(...ys) - 0.002, yMax = Math.max(...ys) + 0.002;
    // log-ish maturity axis so the short end is readable
    const xf = (yrs: number) => Math.log(1 + yrs * 4);
    const xMax = xf(Math.max(...all.map((r) => r.years)));
    const x = (yrs: number) => L + (xf(yrs) / xMax) * (W - L - R);
    const y = (v: number) => T + (1 - (v - yMin) / (yMax - yMin)) * (H - T - B);
    const path = (rs: Record<string, any>[]) => rs.filter((r) => isNum(r.rate)).map((r, i) => `${i ? "L" : "M"}${x(r.years).toFixed(1)},${y(r.rate).toFixed(1)}`).join(" ");
    const yt = Array.from({ length: 5 }, (_, i) => yMin + ((yMax - yMin) * i) / 4);
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="svgchart">
        {yt.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="gridline" />
            <text x={L - 4} y={y(v) + 3} textAnchor="end" className="axis">{fmtPct(v, 2, false)}</text>
          </g>
        ))}
        {rows.map((r) => (
          <text key={r.maturity} x={x(r.years)} y={H - 8} textAnchor="middle" className="axis">{label(r.maturity)}</text>
        ))}
        {prows.length > 0 && <path d={path(prows)} className="line-c2 dashed" />}
        <path d={path(rows)} className="line-c1 thick" />
        {rows.filter((r) => isNum(r.rate)).map((r) => (
          <g key={`p${r.maturity}`}>
            <circle cx={x(r.years)} cy={y(r.rate)} r={3} className="dot-c1" />
            <text x={x(r.years)} y={y(r.rate) - 7} textAnchor="middle" className="axis val">{(r.rate * 100).toFixed(2)}</text>
          </g>
        ))}
      </svg>
    );
  }, [rows, prows]); // eslint-disable-line react-hooks/exhaustive-deps

  const r2 = rows.find((r) => r.maturity === "year_2")?.rate;
  const r10 = rows.find((r) => r.maturity === "year_10")?.rate;
  const r3m = rows.find((r) => r.maturity === "month_3")?.rate;
  return (
    <div className="panel-fill">
      <div className="toolbar">
        <span className="muted">US Treasury · {rows[0]?.date ?? ""}</span>
        <span>2s10s <b className={isNum(r10) && isNum(r2) && r10 < r2 ? "down" : "up"}>{isNum(r10) && isNum(r2) ? `${((r10 - r2) * 10000).toFixed(0)}bp` : "—"}</b></span>
        <span>3m10y <b className={isNum(r10) && isNum(r3m) && r10 < r3m ? "down" : "up"}>{isNum(r10) && isNum(r3m) ? `${((r10 - r3m) * 10000).toFixed(0)}bp` : "—"}</b></span>
        <label className="muted small">
          vs <input className="input" type="date" value={compare} onChange={(e) => setOpts({ compare: e.target.value })} />
        </label>
        <span className="grow" />
        <SourceBadge source={cur.data?.source} provider={cur.data?.provider} />
      </div>
      <div className="scroll pad">
        {cur.error ? <ErrorState error={cur.error} onRetry={cur.reload} /> : cur.loading && !rows.length ? <Loading /> : content}
        {prev.error && <div className="state-error small">Comparison: {prev.error}</div>}
        {compare && prows.length > 0 && <div className="legend"><span className="sw sw-c1" />Latest <span className="sw sw-c2" />{prows[0]?.date}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Correlation
export function CorrelationPanel({ panel, setOpts, symbol }: PanelProps) {
  const basket: string = panel.opts?.basket ?? "SPY,QQQ,TLT,GLD,XLE,AAPL,MSFT,NVDA";
  const [draft, setDraft] = useState(basket);
  const syms = basket.split(/[\s,]+/).filter(Boolean);
  const { data, error, loading, reload } = useAsync(() => api.correlation(syms), [basket]);
  const m = data?.data;
  return (
    <div className="panel-fill">
      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); setOpts({ basket: draft.toUpperCase() }); }}>
        <input className="input grow" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button className="btn">Run</button>
        {symbol && !syms.includes(symbol) && (
          <button type="button" className="btn" onClick={() => { const b = `${basket},${symbol}`; setDraft(b); setOpts({ basket: b }); }}>
            + {symbol}
          </button>
        )}
        <SourceBadge source={data?.source} provider={data?.provider} />
      </form>
      <div className="scroll pad">
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !m ? (
          <Loading />
        ) : !m?.symbols.length ? (
          <Empty>No data</Empty>
        ) : (
          <>
            <table className="corr">
              <thead>
                <tr>
                  <th />
                  {m.symbols.map((s) => <th key={s}>{s}</th>)}
                </tr>
              </thead>
              <tbody>
                {m.symbols.map((a, i) => (
                  <tr key={a}>
                    <th>{a}</th>
                    {m.matrix[i].map((v, j) => (
                      <td key={j} style={{ background: v === null ? undefined : `color-mix(in srgb, ${v >= 0 ? "var(--up)" : "var(--down)"} ${Math.round(Math.abs(v) * 70)}%, var(--panel))` }}>
                        {v === null ? "—" : v.toFixed(2)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="muted small">Pearson correlation of daily returns · {m.observations} observations</div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- API explorer
export function ApiPanel({ panel, setOpts, symbol }: PanelProps) {
  const cmds = useAsync(() => api.obbCommands(), []);
  const [filter, setFilter] = useState("");
  const path: string = panel.opts?.path ?? "equity.price.historical";
  const [params, setParams] = useState<string>(panel.opts?.params ?? `symbol=${symbol ?? "AAPL"}`);
  const providers = cmds.data?.commands[path] ?? [];
  const provider: string = panel.opts?.provider && providers.includes(panel.opts.provider) ? panel.opts.provider : (providers[0] ?? "");
  const [res, setRes] = useState<Envelope<Record<string, any>[]> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useMemo(() => Object.keys(cmds.data?.commands ?? {}).filter((c) => c.includes(filter.toLowerCase())), [cmds.data, filter]);

  const run = async () => {
    setBusy(true);
    setErr(null);
    setRes(null);
    try {
      const obj: Record<string, string> = {};
      for (const part of params.split(/[\n&]+/)) {
        const [k, ...v] = part.split("=");
        if (k.trim()) obj[k.trim()] = v.join("=").trim();
      }
      setOpts({ params });
      setRes(await api.obbRun(path, provider || null, obj));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!res?.data.length) return;
    const keys = [...new Set(res.data.flatMap((r) => Object.keys(r)))];
    const esc = (v: unknown) => (v === null || v === undefined ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const csv = [keys.join(","), ...res.data.map((r) => keys.map((k) => esc(typeof r[k] === "object" ? JSON.stringify(r[k]) : r[k])).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${path.replace(/\./g, "_")}.csv`;
    a.click();
  };

  return (
    <div className="panel-fill api-explorer">
      <div className="api-side">
        <input className="input" placeholder={`Filter ${Object.keys(cmds.data?.commands ?? {}).length} commands`} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="scroll">
          {cmds.error ? (
            <ErrorState error={cmds.error} />
          ) : (
            list.map((c) => (
              <div key={c} className={`api-cmd ${c === path ? "active" : ""}`} onClick={() => setOpts({ path: c, provider: undefined })}>
                {c}
              </div>
            ))
          )}
        </div>
      </div>
      <div className="api-main">
        <div className="toolbar">
          <span className="accent">obb.{path}</span>
          <select className="input" value={provider} onChange={(e) => setOpts({ provider: e.target.value })}>
            {providers.map((p) => <option key={p}>{p}</option>)}
          </select>
          <button className="btn" onClick={run} disabled={busy}>{busy ? "Running…" : "Run ▶"}</button>
          {res?.data.length ? <button className="btn" onClick={download}>CSV</button> : null}
          <span className="grow" />
          <a className="muted small" href="/odp/docs" target="_blank" rel="noreferrer">REST docs ↗</a>
          {res && <SourceBadge source={res.source} provider={res.provider} />}
        </div>
        <textarea className="input mono" rows={2} value={params} onChange={(e) => setParams(e.target.value)} placeholder="symbol=AAPL&start_date=2024-01-01 (one per line or &-separated)" />
        <div className="scroll">
          {err && <ErrorState error={err} />}
          {busy && <Loading label="Querying OpenBB" />}
          {res && <AutoTable rows={res.data} maxCols={20} />}
          {!res && !err && !busy && <Empty>Pick a command, set parameters, press Run. Requires network access to the provider.</Empty>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Notes
export function NotesPanel({ symbol, panel, setOpts }: PanelProps) {
  const scope: string = panel.opts?.scope ?? "all";
  const { data, error, loading, reload } = useAsync(() => api.notes(scope === "security" ? symbol : undefined), [scope, symbol]);
  const [body, setBody] = useState("");
  return (
    <div className="panel-fill">
      <div className="toolbar">
        <Tabs value={scope} onChange={(v) => setOpts({ scope: v })} options={[{ value: "all", label: "All notes" }, { value: "security", label: symbol ?? "Security" }]} />
      </div>
      <form
        className="note-in"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!body.trim()) return;
          await api.addNote(symbol ?? null, body);
          setBody("");
          reload();
        }}
      >
        <textarea className="input" rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder={`Note${symbol ? ` on ${symbol}` : ""}…`} />
        <button className="btn">Save</button>
      </form>
      <div className="scroll">
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <Loading />
        ) : !data?.length ? (
          <Empty>No notes</Empty>
        ) : (
          <ul className="notes">
            {data.map((n) => (
              <li key={n.id}>
                <div className="muted small">
                  {fmtDate(n.created, true)} {n.symbol && <span className="sym">{n.symbol}</span>}
                  <button className="icon-btn" onClick={() => api.deleteNote(n.id).then(reload)}>×</button>
                </div>
                <div className="note-body">{n.body}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
