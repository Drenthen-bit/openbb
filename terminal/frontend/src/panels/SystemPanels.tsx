import { useState } from "react";
import { api } from "../lib/api";
import { FUNCTIONS } from "../lib/commands";
import { useAsync } from "../lib/hooks";
import { stream } from "../lib/stream";
import { defaultWorkspace, useWorkspace } from "../lib/workspace";
import { fmtDate } from "../lib/format";
import { ErrorState, KV, Loading } from "../components/ui";
import type { PanelProps } from "./types";

export function HelpPanel({ run }: PanelProps) {
  const cats = [...new Set(FUNCTIONS.map((f) => f.category))];
  return (
    <div className="panel-fill">
      <div className="scroll pad help">
        <h3>Command line</h3>
        <table className="tbl tbl-dense">
          <tbody>
            {[
              ["AAPL", "Load a security into the focused link group"],
              ["AAPL GP  ·  GP AAPL", "Open a function for a security"],
              ["BUY 100 AAPL", "Paper market order"],
              ["SELL 50 AAPL LMT 250 GTC", "Limit order (STP <px> for stops, both for stop-limit)"],
              ["ALRT AAPL > 250  ·  ALRT SPY %< -2", "Price or %-change alert"],
              ["PAGE 2  ·  NEW Ideas", "Switch page · create a page"],
              ["SAVE name  ·  LOAD name", "Save / load a named layout"],
              ["MODE demo|live|auto", "Switch the data source"],
            ].map(([a, b]) => (
              <tr key={a}>
                <td><kbd>{a}</kbd></td>
                <td>{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>Keyboard</h3>
        <table className="tbl tbl-dense">
          <tbody>
            {[
              ["/  or  `", "Focus the command line"],
              ["Esc", "Leave the command line / close suggestions"],
              ["Alt+1…9", "Switch page"],
              ["Alt+W", "Close focused panel"],
              ["Alt+M", "Maximize / restore focused panel"],
              ["Tab", "Accept suggestion"],
            ].map(([a, b]) => (
              <tr key={a}>
                <td><kbd>{a}</kbd></td>
                <td>{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>Linking</h3>
        <p>
          Each panel has a link color (A amber, B cyan, C magenta, or unlinked). Panels in the same group follow the same security; clicking a row in a monitor or table loads that security into its group.
        </p>
        {cats.map((c) => (
          <div key={c}>
            <h3>{c}</h3>
            <table className="tbl tbl-dense">
              <tbody>
                {FUNCTIONS.filter((f) => f.category === c).map((f) => (
                  <tr key={f.type} className="clickable" onClick={() => run(f.mnemonics[0])}>
                    <td style={{ width: 150 }}>
                      <span className="accent">{f.mnemonics[0]}</span>
                      {f.mnemonics.length > 1 && <span className="muted"> {f.mnemonics.slice(1).join(" ")}</span>}
                    </td>
                    <td>{f.title}</td>
                    <td className="muted">{f.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SettingsPanel(_: PanelProps) {
  const { ws, dispatch } = useWorkspace();
  const status = useAsync(() => api.status(), [], 10_000);
  const creds = useAsync(() => api.credentials(), []);
  const layouts = useAsync(() => api.layouts(), []);
  const [credName, setCredName] = useState("");
  const [credVal, setCredVal] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const s = status.data;

  const setMode = async (m: string) => {
    await api.setMode(m);
    stream.reset();
    status.reload();
  };

  return (
    <div className="panel-fill">
      <div className="scroll pad settings">
        <h3>Data source</h3>
        {status.error ? (
          <ErrorState error={status.error} onRetry={status.reload} />
        ) : !s ? (
          <Loading />
        ) : (
          <>
            <div className="seg">
              {(["auto", "live", "demo"] as const).map((m) => (
                <button key={m} className={`seg-btn ${s.requested_mode === m ? "active" : ""}`} onClick={() => setMode(m)}>
                  {m.toUpperCase()}
                </button>
              ))}
            </div>
            <KV
              items={[
                ["Active mode", <span className={s.mode === "live" ? "up" : "accent"}>{s.mode.toUpperCase()}</span>],
                ["OpenBB Platform", s.openbb ? "installed" : (s.openbb_error ?? "not installed")],
                ["Last probe", s.last_probe ? fmtDate(s.last_probe, true) : "—"],
                ["AI analyst", s.ai_available ? `on (${s.ai_model})` : "off"],
              ]}
            />
            {s.mode === "demo" && (
              <p className="muted small">
                Demo mode serves synthetic prices, news and fundamentals from a deterministic generator so the workspace is usable offline. Every panel shows a DEMO badge.
                {s.last_probe_error ? ` Live probe failed: ${s.last_probe_error}` : ""}
              </p>
            )}
            {!s.ai_available && s.ai_reason && <p className="muted small">AI: {s.ai_reason}</p>}
          </>
        )}

        <h3>Provider credentials</h3>
        <p className="muted small">Optional API keys for OpenBB providers (FRED, etc.). Set here for this server session only; to persist, add them to ~/.openbb_platform/user_settings.json.</p>
        {creds.error ? (
          <ErrorState error={creds.error} />
        ) : (
          <form
            className="row"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api.setCredential(credName, credVal);
                setMsg(`${credName} ${credVal ? "set" : "cleared"}`);
                setCredVal("");
                creds.reload();
              } catch (ex) {
                setMsg(ex instanceof Error ? ex.message : String(ex));
              }
            }}
          >
            <select className="input" value={credName} onChange={(e) => setCredName(e.target.value)}>
              <option value="">Choose credential…</option>
              {Object.entries(creds.data?.credentials ?? {}).map(([k, v]) => (
                <option key={k} value={k}>
                  {k} {v ? "✓" : ""}
                </option>
              ))}
            </select>
            <input className="input" type="password" autoComplete="off" value={credVal} onChange={(e) => setCredVal(e.target.value)} placeholder="value" />
            <button className="btn" disabled={!credName}>Set</button>
          </form>
        )}
        {msg && <div className="small">{msg}</div>}

        <h3>Layouts</h3>
        <div className="row">
          <button
            className="btn"
            onClick={async () => {
              const name = prompt("Layout name", ws.pages[ws.active]?.name ?? "My layout");
              if (name) {
                await api.saveLayout(name, ws);
                layouts.reload();
              }
            }}
          >
            Save current workspace
          </button>
          <button
            className="btn"
            onClick={() => {
              if (confirm("Reset the workspace to the default pages?")) dispatch({ t: "replace", ws: defaultWorkspace() });
            }}
          >
            Reset to default
          </button>
        </div>
        <table className="tbl tbl-dense">
          <tbody>
            {(layouts.data ?? []).map((l) => (
              <tr key={l.id}>
                <td>{l.name}</td>
                <td className="muted">{fmtDate(l.updated, true)}</td>
                <td style={{ textAlign: "right" }}>
                  <button className="btn btn-xs" onClick={async () => dispatch({ t: "replace", ws: (await api.layout(l.id)).data })}>Load</button>{" "}
                  <button className="btn btn-xs" onClick={() => api.deleteLayout(l.id).then(layouts.reload)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
