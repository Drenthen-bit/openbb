import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import GridLayout, { WidthProvider, type Layout } from "react-grid-layout";
import { api, type Status } from "./lib/api";
import { FUNCTIONS, functionFor, parseCommand, suggest, type Suggestion } from "./lib/commands";
import { useAsync } from "./lib/hooks";
import { stream, useConnected, useQuotes, useStreamEvents, type StreamEvent } from "./lib/stream";
import { LINK_GROUPS, focusedGroup, panelSymbol, useWorkspace, type LinkGroup, type PanelState } from "./lib/workspace";
import { fmtPct, fmtPrice, tone } from "./lib/format";
import { PANELS } from "./panels/registry";

const Grid = WidthProvider(GridLayout);

interface Toast {
  id: number;
  text: string;
  kind: "info" | "ok" | "warn" | "err";
}

let toastId = 0;

export default function App() {
  const { ws, dispatch } = useWorkspace();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [maximized, setMaximized] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const cmdRef = useRef<HTMLInputElement>(null);

  const toast = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = ++toastId;
    setToasts((t) => [...t.slice(-4), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "err" ? 7000 : 4500);
  }, []);

  useEffect(() => {
    stream.connect();
    api.status().then(setStatus).catch(() => undefined);
  }, []);

  const onEvent = useCallback(
    (e: StreamEvent) => {
      if (e.type === "status") setStatus(e.data);
      if (e.type === "order" && e.data.status === "filled") {
        const o = e.data;
        toast(`FILL ${o.side.toUpperCase()} ${o.quantity} ${o.symbol} @ ${fmtPrice(o.filled_price)}`, "ok");
      }
      if (e.type === "order" && e.data.status === "rejected") toast(`REJECTED ${e.data.symbol}: ${e.data.reason}`, "err");
      if (e.type === "alert") {
        const a = e.data;
        toast(`ALERT ${a.symbol} ${a.condition.replace("_", " ")} ${a.value} — now ${fmtPrice(a.triggered_price)}`, "warn");
        if ("Notification" in window && Notification.permission === "granted") new Notification(`${a.symbol} alert`, { body: `${a.condition} ${a.value} @ ${a.triggered_price}` });
      }
    },
    [toast],
  );
  useStreamEvents(onEvent);

  const run = useCallback(
    async (input: string): Promise<boolean> => {
      const cmd = parseCommand(input);
      if (!cmd) return false;
      try {
        switch (cmd.kind) {
          case "open":
            dispatch({ t: "open", type: cmd.fn.type, symbol: cmd.symbol });
            return true;
          case "load": {
            const g = focusedGroup(ws);
            dispatch({ t: "link", group: g, symbol: cmd.symbol });
            const page = ws.pages[ws.active];
            if (!page.panels.some((p) => p.link === g)) dispatch({ t: "open", type: "quote", symbol: cmd.symbol });
            return true;
          }
          case "order": {
            const o = await api.submitOrder(cmd);
            toast(
              o.status === "filled"
                ? `FILLED ${o.side.toUpperCase()} ${o.quantity} ${o.symbol} @ ${fmtPrice(o.filled_price)}`
                : o.status === "rejected"
                  ? `REJECTED ${o.symbol}: ${o.reason}`
                  : `WORKING ${o.side.toUpperCase()} ${o.quantity} ${o.symbol} ${o.order_type.toUpperCase()}`,
              o.status === "rejected" ? "err" : "ok",
            );
            return true;
          }
          case "alert":
            await api.addAlert(cmd);
            toast(`Alert set: ${cmd.symbol} ${cmd.condition.replace("_", " ")} ${cmd.value}`, "ok");
            if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => undefined);
            return true;
          case "page":
            dispatch({ t: "page", index: cmd.index });
            return true;
          case "newpage":
            dispatch({ t: "addPage", name: cmd.name });
            return true;
          case "save":
            await api.saveLayout(cmd.name, ws);
            toast(`Layout "${cmd.name}" saved`, "ok");
            return true;
          case "load_layout": {
            const all = await api.layouts();
            const hit = all.find((l) => l.name.toLowerCase() === cmd.name.toLowerCase());
            if (!hit) {
              toast(`No layout named "${cmd.name}"`, "err");
              return false;
            }
            dispatch({ t: "replace", ws: (await api.layout(hit.id)).data });
            toast(`Layout "${hit.name}" loaded`, "ok");
            return true;
          }
          case "mode": {
            const s = await api.setMode(cmd.mode);
            setStatus(s);
            stream.reset();
            toast(`Data mode: requested ${cmd.mode.toUpperCase()}, active ${s.mode.toUpperCase()}`, s.mode === cmd.mode || cmd.mode === "auto" ? "ok" : "warn");
            return true;
          }
          case "error":
            toast(cmd.message, "err");
            return false;
        }
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), "err");
        return false;
      }
    },
    [dispatch, ws, toast],
  );

  // global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
      if (!typing && (e.key === "/" || e.key === "`")) {
        e.preventDefault();
        cmdRef.current?.focus();
      } else if (e.altKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        dispatch({ t: "page", index: Number(e.key) - 1 });
      } else if (e.altKey && e.key.toLowerCase() === "w" && ws.focused) {
        e.preventDefault();
        dispatch({ t: "close", id: ws.focused });
      } else if (e.altKey && e.key.toLowerCase() === "m" && ws.focused) {
        e.preventDefault();
        setMaximized((m) => (m === ws.focused ? null : ws.focused));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, ws.focused]);

  const page = ws.pages[ws.active];
  useEffect(() => setMaximized(null), [ws.active]);
  const mainRef = useRef<HTMLElement>(null);
  const rowHeight = useRowHeight(mainRef);
  const narrow = useNarrow();
  const [launcher, setLauncher] = useState(false);

  return (
    <div className="app">
      <TopBar run={run} cmdRef={cmdRef} status={status} onMenu={() => setLauncher(true)} />
      {launcher && <Launcher run={run} onClose={() => setLauncher(false)} />}
      <TickerTape run={run} />
      <div className="pages">
        {ws.pages.map((p, i) => (
          <button
            key={p.id}
            className={`page-tab ${i === ws.active ? "active" : ""}`}
            onClick={() => dispatch({ t: "page", index: i })}
            onDoubleClick={() => {
              const name = prompt("Rename page", p.name);
              if (name) dispatch({ t: "renamePage", index: i, name });
            }}
            title="Double-click to rename"
          >
            <span className="page-num">{i + 1}</span> {p.name}
            {i === ws.active && (
              <span
                className="page-x"
                title="Rename page"
                onClick={(e) => {
                  e.stopPropagation();
                  const name = prompt("Rename page", p.name);
                  if (name) dispatch({ t: "renamePage", index: i, name });
                }}
              >
                ✎
              </span>
            )}
            {ws.pages.length > 1 && i === ws.active && (
              <span
                className="page-x"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Close page "${p.name}"?`)) dispatch({ t: "removePage", index: i });
                }}
              >
                ×
              </span>
            )}
          </button>
        ))}
        <button className="page-tab add" onClick={() => dispatch({ t: "addPage" })} title="New page">
          +
        </button>
        <span className="grow" />
        <LinkBar />
      </div>
      <main className="workspace" ref={mainRef}>
        {page.panels.length === 0 && (
          <div className="state big-empty">
            Empty page. Type a function in the command line — e.g. <kbd>AAPL GP</kbd>, <kbd>WEI</kbd>, <kbd>HELP</kbd> — or
            <button className="btn" onClick={() => setLauncher(true)}>
              open the function menu
            </button>
          </div>
        )}
        {maximized && page.panels.find((p) => p.id === maximized) ? (
          <div className="maximized">
            <PanelFrame panel={page.panels.find((p) => p.id === maximized)!} run={run} maximized onMaximize={() => setMaximized(null)} />
          </div>
        ) : narrow ? (
          <div className="stack">
            {[...page.panels]
              .sort((a, b) => a.y - b.y || a.x - b.x)
              .map((p) => (
                <div key={p.id} className="stack-item" style={{ height: Math.max(340, p.h * 34) }}>
                  <PanelFrame panel={p} run={run} onMaximize={() => setMaximized(p.id)} />
                </div>
              ))}
          </div>
        ) : (
          <Grid
            className="grid"
            layout={page.panels.map((p) => ({ i: p.id, x: p.x, y: p.y, w: p.w, h: p.h, minW: 2, minH: 3 }))}
            cols={12}
            rowHeight={rowHeight}
            margin={[4, 4]}
            containerPadding={[4, 4]}
            draggableHandle=".panel-drag"
            draggableCancel=".no-drag"
            onLayoutChange={(l: Layout[]) => dispatch({ t: "layout", layout: l })}
            resizeHandles={["se", "e", "s"]}
          >
            {page.panels.map((p) => (
              <div key={p.id}>
                <PanelFrame panel={p} run={run} onMaximize={() => setMaximized(p.id)} />
              </div>
            ))}
          </Grid>
        )}
      </main>
      <StatusBar status={status} />
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

/** True when the viewport is too narrow for the 12-column grid (e.g. iPad portrait). */
function useNarrow() {
  const query = "(max-width: 899px)";
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

/** Touch-friendly function menu: every function as a large button, grouped by category. */
function Launcher({ run, onClose }: { run: (s: string) => Promise<boolean>; onClose: () => void }) {
  const { ws } = useWorkspace();
  const group = focusedGroup(ws);
  const [sym, setSym] = useState(ws.links[group]);
  const cats = [...new Set(FUNCTIONS.map((f) => f.category))];
  const open = (mnemonic: string, needsSymbol: boolean) => {
    run(needsSymbol && sym ? `${sym} ${mnemonic}` : mnemonic);
    onClose();
  };
  return (
    <div className="launcher-backdrop" onClick={onClose}>
      <div className="launcher" onClick={(e) => e.stopPropagation()}>
        <div className="launcher-head">
          <span className="accent">FUNCTIONS</span>
          <label className="muted">
            Security <input className="input" value={sym} onChange={(e) => setSym(e.target.value.toUpperCase())} style={{ width: 110 }} />
          </label>
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="scroll">
          {cats.map((c) => (
            <div key={c}>
              <h3>{c}</h3>
              <div className="launcher-grid">
                {FUNCTIONS.filter((f) => f.category === c).map((f) => (
                  <button key={f.type} className="launcher-btn" onClick={() => open(f.mnemonics[0], f.needsSymbol)}>
                    <span className="accent">{f.mnemonics[0]}</span>
                    <span>{f.title}</span>
                    <span className="muted small">{f.description}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Size grid rows so a 22-row layout fills the visible workspace. */
const LAYOUT_ROWS = 22;
function useRowHeight(ref: React.RefObject<HTMLElement>) {
  const [h, setH] = useState(30);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const avail = el.clientHeight - 8; // container padding
      setH(Math.max(18, Math.floor(avail / LAYOUT_ROWS - 4))); // minus vertical margin per row
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return h;
}

// ---------------------------------------------------------------- panel frame
const PanelFrame = memo(function PanelFrame({ panel, run, maximized, onMaximize }: { panel: PanelState; run: (s: string) => Promise<boolean>; maximized?: boolean; onMaximize: () => void }) {
  const { ws, dispatch } = useWorkspace();
  const def = functionFor(panel.type);
  const Comp = PANELS[panel.type];
  const symbol = panelSymbol(ws, panel);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const focused = ws.focused === panel.id;

  const setSymbol = useCallback(
    (s: string) => {
      const sym = s.trim().toUpperCase();
      if (!sym) return;
      if (panel.link) dispatch({ t: "link", group: panel.link, symbol: sym });
      else dispatch({ t: "update", id: panel.id, patch: { symbol: sym } });
    },
    [dispatch, panel.id, panel.link],
  );
  const setOpts = useCallback((opts: Record<string, any>) => dispatch({ t: "opts", id: panel.id, opts }), [dispatch, panel.id]);
  const runCmd = useCallback((c: string) => void run(c), [run]);
  const cycleLink = () => {
    const order: (LinkGroup | null)[] = [...LINK_GROUPS, null];
    const next = order[(order.indexOf(panel.link) + 1) % order.length];
    dispatch({ t: "update", id: panel.id, patch: { link: next, symbol: next ? undefined : symbol } });
  };

  return (
    <section className={`panel ${focused ? "focused" : ""}`} onMouseDown={() => dispatch({ t: "focus", id: panel.id })}>
      <header className="panel-head">
        <button className={`link-dot link-${panel.link ?? "none"} no-drag`} onClick={cycleLink} title={panel.link ? `Linked to group ${panel.link} (click to change)` : "Unlinked (click to link)"}>
          {panel.link ?? "·"}
        </button>
        {(def.needsSymbol || symbol) &&
          (editing ? (
            <form
              className="no-drag"
              onSubmit={(e) => {
                e.preventDefault();
                setSymbol(draft);
                setEditing(false);
              }}
            >
              <input autoFocus className="input sym-input" value={draft} onChange={(e) => setDraft(e.target.value.toUpperCase())} onBlur={() => setEditing(false)} />
            </form>
          ) : (
            <button
              className="panel-sym no-drag"
              onClick={() => {
                setDraft(symbol ?? "");
                setEditing(true);
              }}
              title="Change security"
            >
              {symbol ?? "—"}
            </button>
          ))}
        <span className="panel-title panel-drag">
          <span className="mnemonic">{def.mnemonics[0]}</span> {def.title}
        </span>
        <button className="icon-btn no-drag" onClick={onMaximize} title={maximized ? "Restore (Alt+M)" : "Maximize (Alt+M)"}>
          {maximized ? "❐" : "□"}
        </button>
        <button className="icon-btn no-drag" onClick={() => dispatch({ t: "close", id: panel.id })} title="Close (Alt+W)">
          ×
        </button>
      </header>
      <div className="panel-body no-drag">
        <Comp panel={panel} symbol={symbol} setSymbol={setSymbol} setOpts={setOpts} run={runCmd} />
      </div>
    </section>
  );
});

// ---------------------------------------------------------------- top bar & command line
function TopBar({ run, cmdRef, status, onMenu }: { run: (s: string) => Promise<boolean>; cmdRef: React.RefObject<HTMLInputElement>; status: Status | null; onMenu: () => void }) {
  const { ws } = useWorkspace();
  const [value, setValue] = useState("");
  const [sel, setSel] = useState(0);
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("odp-cmd-history") ?? "[]");
    } catch {
      return [];
    }
  });
  const [hIdx, setHIdx] = useState(-1);
  const [remote, setRemote] = useState<{ symbol: string; name: string }[]>([]);

  useEffect(() => {
    const last = value.trim().split(/\s+/).pop() ?? "";
    if (last.length < 1 || value.trim().split(/\s+/).length > 1) {
      setRemote([]);
      return;
    }
    const id = setTimeout(() => {
      api.search(last).then((r) => setRemote(r.data)).catch(() => setRemote([]));
    }, 150);
    return () => clearTimeout(id);
  }, [value]);

  const sugg: Suggestion[] = useMemo(() => suggest(value, remote), [value, remote]);
  const submit = async (v: string) => {
    if (!v.trim()) return;
    const ok = await run(v);
    if (ok) {
      const h = [v, ...history.filter((x) => x !== v)].slice(0, 50);
      setHistory(h);
      try {
        localStorage.setItem("odp-cmd-history", JSON.stringify(h));
      } catch {
        /* ignore */
      }
      setValue("");
      setOpen(false);
      setHIdx(-1);
    }
  };
  const group = focusedGroup(ws);

  return (
    <div className="topbar">
      <button className="menu-btn" onClick={onMenu} title="Function menu">
        ☰ <span className="menu-label">MENU</span>
      </button>
      <div className="brand" title="ODP Terminal — built on the OpenBB Open Data Platform">
        <span className="brand-mark">ODP</span> TERMINAL
      </div>
      <div className="cmd">
        <span className={`cmd-group link-${group}`} title={`Commands load into link group ${group} (focus a panel to change)`}>
          {group} · {ws.links[group]}
        </span>
        <input
          ref={cmdRef}
          className="cmd-input"
          value={value}
          spellCheck={false}
          autoComplete="off"
          placeholder="Type a ticker or function — AAPL GP · WEI · BUY 100 MSFT · HELP   (press / to focus)"
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
            setSel(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if ((e.key === "/" || e.key === "`") && !value) {
              e.preventDefault();
            } else if (e.key === "Enter") {
              e.preventDefault();
              const typed = parseCommand(value);
              submit((!typed || typed.kind === "error") && open && sugg[sel] ? sugg[sel].value : value);
            } else if (e.key === "Tab" && sugg.length) {
              e.preventDefault();
              setValue(sugg[sel].value + " ");
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              if (open && sugg.length) setSel((s) => Math.min(s + 1, sugg.length - 1));
              else if (hIdx > 0) {
                setHIdx(hIdx - 1);
                setValue(history[hIdx - 1]);
              }
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              if (open && sugg.length && sel > 0) setSel((s) => s - 1);
              else if (history.length && hIdx < history.length - 1) {
                setOpen(false);
                setHIdx(hIdx + 1);
                setValue(history[hIdx + 1]);
              }
            } else if (e.key === "Escape") {
              setOpen(false);
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        <button className="cmd-go" onClick={() => submit(value)}>
          GO
        </button>
        {open && sugg.length > 0 && (
          <ul className="sugg">
            {sugg.map((s, i) => (
              <li key={s.value} className={i === sel ? "active" : ""} onMouseDown={() => submit(s.value)} onMouseEnter={() => setSel(i)}>
                <span className="accent">{s.label}</span>
                <span className="muted">{s.detail}</span>
              </li>
            ))}
            <li className="sugg-hint muted">Enter runs · Tab completes · ↑↓ select</li>
          </ul>
        )}
      </div>
      <Clock />
      <span className={`mode-pill mode-${status?.mode ?? "unknown"}`} title={status?.mode === "demo" ? "Synthetic data — not real market prices" : "Live data from OpenBB providers"}>
        {status ? (status.mode === "demo" ? "DEMO DATA" : "LIVE") : "…"}
      </span>
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const ny = now.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false });
  const ldn = now.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour12: false, hour: "2-digit", minute: "2-digit" });
  const tky = now.toLocaleTimeString("en-GB", { timeZone: "Asia/Tokyo", hour12: false, hour: "2-digit", minute: "2-digit" });
  return (
    <div className="clock">
      <span>NY {ny}</span>
      <span className="muted">LDN {ldn}</span>
      <span className="muted">TKY {tky}</span>
    </div>
  );
}

const TAPE = ["SPY", "QQQ", "IWM", "DIA", "TLT", "GLD", "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "JPM", "XOM"];

function TickerTape({ run }: { run: (s: string) => Promise<boolean> }) {
  const quotes = useQuotes(TAPE);
  const items = TAPE.map((s) => ({ s, q: quotes[s] }));
  return (
    <div className="tape">
      <div className="tape-inner">
        {[...items, ...items].map(({ s, q }, i) => (
          <span key={i} className="tape-item" onClick={() => run(s)}>
            <span className="sym">{s}</span> {fmtPrice(q?.last)} <span className={tone(q?.change_percent)}>{fmtPct(q?.change_percent)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function LinkBar() {
  const { ws, dispatch } = useWorkspace();
  return (
    <div className="linkbar">
      {LINK_GROUPS.map((g) => (
        <span key={g} className={`link-chip link-${g}`} title={`Link group ${g}`}>
          {g}
          <input
            className="link-input"
            value={ws.links[g]}
            onChange={(e) => dispatch({ t: "link", group: g, symbol: e.target.value })}
            spellCheck={false}
          />
        </span>
      ))}
    </div>
  );
}

function StatusBar({ status }: { status: Status | null }) {
  const connected = useConnected();
  const s = useAsync(() => api.status(), [], 30_000);
  const st = s.data ?? status;
  return (
    <footer className="statusbar">
      <span className={connected ? "up" : "down"}>● {connected ? "STREAM CONNECTED" : "STREAM RECONNECTING"}</span>
      <span>
        DATA:{" "}
        <b className={st?.mode === "live" ? "up" : "accent"}>
          {st?.mode?.toUpperCase() ?? "…"}
        </b>
        {st && st.requested_mode !== st.mode ? ` (requested ${st.requested_mode})` : st?.requested_mode === "auto" ? " (auto)" : ""}
      </span>
      {st?.mode === "demo" && <span className="accent">Synthetic prices for demonstration — not real market data</span>}
      <span className="grow" />
      <span className="muted">Paper trading only · not investment advice</span>
      <span className="muted">Powered by OpenBB Open Data Platform</span>
    </footer>
  );
}
