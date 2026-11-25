// Number and date formatting helpers for dense terminal displays.

export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function fmtPrice(v: number | null | undefined, digits?: number): string {
  if (!isNum(v)) return "—";
  const d = digits ?? (Math.abs(v) >= 1000 ? 2 : Math.abs(v) >= 1 ? 2 : 4);
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function fmtChange(v: number | null | undefined, digits = 2): string {
  if (!isNum(v)) return "—";
  const s = v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return v > 0 ? `+${s}` : s;
}

/** Format a normalized fraction (0.0123) as a signed percentage (+1.23%). */
export function fmtPct(v: number | null | undefined, digits = 2, signed = true): string {
  if (!isNum(v)) return "—";
  const p = (v * 100).toFixed(digits);
  return `${signed && v > 0 ? "+" : ""}${p}%`;
}

export function fmtBig(v: number | null | undefined, digits = 2): string {
  if (!isNum(v)) return "—";
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1e12) return `${sign}${(a / 1e12).toFixed(digits)}T`;
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(digits)}M`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(digits)}K`;
  return `${sign}${a.toFixed(digits === 2 ? 0 : digits)}`;
}

export function fmtInt(v: number | null | undefined): string {
  if (!isNum(v)) return "—";
  return Math.round(v).toLocaleString("en-US");
}

export function fmtMoney(v: number | null | undefined, digits = 2): string {
  if (!isNum(v)) return "—";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtDate(v: unknown, withTime = false): string {
  if (v === null || v === undefined || v === "") return "—";
  const d = typeof v === "number" ? new Date(v * 1000) : new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  const date = d.toISOString().slice(0, 10);
  if (!withTime) return date;
  return `${date} ${d.toTimeString().slice(0, 5)}`;
}

export function fmtTime(v: unknown): string {
  if (v === null || v === undefined) return "—";
  const d = typeof v === "number" ? new Date(v * 1000) : new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toTimeString().slice(0, 5);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

export const tone = (v: number | null | undefined) => (!isNum(v) || v === 0 ? "flat" : v > 0 ? "up" : "down");

/** Humanize snake_case keys from OpenBB payloads. */
export function labelize(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b(eps|ebitda|ebit|pe|id|cik|url|sec|usd|iv|oi|dte)\b/gi, (m) => m.toUpperCase())
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** Generic cell formatter used by the auto-table. */
export function fmtAuto(key: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") {
    const k = key.toLowerCase();
    if (/(percent|pct|yield|margin|ratio_pct|growth|return)/.test(k) && Math.abs(v) < 5) return fmtPct(v);
    if (Math.abs(v) >= 1e6) return fmtBig(v);
    if (Number.isInteger(v)) return fmtInt(v);
    return fmtPrice(v);
  }
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return fmtDate(s, true);
  return s;
}
