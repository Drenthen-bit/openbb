// Shared presentational components.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Source } from "../lib/api";
import { fmtAuto, labelize, tone, isNum } from "../lib/format";

export function SourceBadge({ source, provider }: { source?: Source | string; provider?: string | null }) {
  if (!source) return null;
  if (source === "demo") return <span className="badge badge-demo" title="Synthetic data from the offline demo engine — not real market data">DEMO</span>;
  if (source === "directory") return <span className="badge" title="Built-in symbol directory">DIR</span>;
  return (
    <span className="badge badge-live" title={`Live data via OpenBB${provider ? ` · ${provider}` : ""}`}>
      LIVE{provider ? ` · ${provider.toUpperCase()}` : ""}
    </span>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return <div className="state">{label}…</div>;
}

export function ErrorState({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="state state-error">
      <div>{error}</div>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="state">{children}</div>;
}

/** A value that flashes green/red when it changes. */
export function Flash({ value, children, className = "" }: { value: number | null | undefined; children: ReactNode; className?: string }) {
  const prev = useRef(value);
  const [cls, setCls] = useState("");
  useEffect(() => {
    if (isNum(value) && isNum(prev.current) && value !== prev.current) {
      setCls(value > prev.current ? "flash-up" : "flash-down");
      const id = setTimeout(() => setCls(""), 600);
      prev.current = value;
      return () => clearTimeout(id);
    }
    prev.current = value;
  }, [value]);
  return <span className={`${className} ${cls}`}>{children}</span>;
}

export function Chg({ v, children }: { v: number | null | undefined; children: ReactNode }) {
  return <span className={tone(v)}>{children}</span>;
}

export interface Column<T> {
  key: string;
  label?: string;
  align?: "left" | "right" | "center";
  render?: (row: T) => ReactNode;
  sortValue?: (row: T) => number | string | null | undefined;
  width?: number | string;
}

export function DataTable<T extends Record<string, any>>({
  rows,
  columns,
  onRowClick,
  rowKey,
  initialSort,
  dense = true,
  rowClass,
  maxRows,
}: {
  rows: T[];
  columns: Column<T>[];
  onRowClick?: (row: T) => void;
  rowKey?: (row: T, i: number) => string;
  initialSort?: { key: string; dir: 1 | -1 };
  dense?: boolean;
  rowClass?: (row: T) => string;
  maxRows?: number;
}) {
  const [sort, setSort] = useState(initialSort);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    const val = (r: T) => (col?.sortValue ? col.sortValue(r) : r[sort.key]);
    return [...rows].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      return (va > vb ? 1 : -1) * sort.dir;
    });
  }, [rows, columns, sort]);
  const shown = maxRows ? sorted.slice(0, maxRows) : sorted;
  return (
    <table className={`tbl ${dense ? "tbl-dense" : ""}`}>
      <thead>
        <tr>
          {columns.map((c) => (
            <th
              key={c.key}
              style={{ textAlign: c.align ?? "left", width: c.width }}
              onClick={() => setSort((s) => ({ key: c.key, dir: s?.key === c.key ? ((-s.dir) as 1 | -1) : -1 }))}
            >
              {c.label ?? labelize(c.key)}
              {sort?.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {shown.map((r, i) => (
          <tr key={rowKey ? rowKey(r, i) : i} onClick={onRowClick ? () => onRowClick(r) : undefined} className={`${onRowClick ? "clickable" : ""} ${rowClass?.(r) ?? ""}`}>
            {columns.map((c) => (
              <td key={c.key} style={{ textAlign: c.align ?? "left" }}>
                {c.render ? c.render(r) : fmtAuto(c.key, r[c.key])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A table that infers its columns from the records. */
export function AutoTable({ rows, maxCols = 14, onRowClick }: { rows: Record<string, any>[]; maxCols?: number; onRowClick?: (r: Record<string, any>) => void }) {
  const columns = useMemo(() => {
    const keys: string[] = [];
    for (const r of rows.slice(0, 50)) for (const k of Object.keys(r)) if (!keys.includes(k) && typeof r[k] !== "object") keys.push(k);
    return keys.slice(0, maxCols).map((k) => ({
      key: k,
      align: (rows.some((r) => typeof r[k] === "number") ? "right" : "left") as "right" | "left",
    }));
  }, [rows, maxCols]);
  if (!rows.length) return <Empty>No rows</Empty>;
  return <DataTable rows={rows} columns={columns} onRowClick={onRowClick} />;
}

export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="tabs">
      {options.map((o) => (
        <button key={o.value} className={`tab ${value === o.value ? "active" : ""}`} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function KV({ items }: { items: [string, ReactNode][] }) {
  return (
    <div className="kv">
      {items.map(([k, v]) => (
        <div className="kv-row" key={k}>
          <span className="kv-k">{k}</span>
          <span className="kv-v">{v}</span>
        </div>
      ))}
    </div>
  );
}

/** Compact sparkline drawn as an inline SVG polyline. */
export function Sparkline({ values, width = 80, height = 18 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - ((v - min) / span) * height).toFixed(1)}`).join(" ");
  const up = values[values.length - 1] >= values[0];
  return (
    <svg width={width} height={height} className="spark">
      <polyline points={pts} fill="none" stroke={up ? "var(--up)" : "var(--down)"} strokeWidth="1.2" />
    </svg>
  );
}
