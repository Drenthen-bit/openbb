// Typed client for the ODP Terminal backend.

export type Source = "live" | "demo" | "directory";

export interface Envelope<T> {
  source: Source;
  provider: string | null;
  data: T;
  [k: string]: unknown;
}

export interface Quote {
  symbol: string;
  name?: string | null;
  exchange?: string | null;
  last: number | null;
  bid?: number | null;
  ask?: number | null;
  bid_size?: number | null;
  ask_size?: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  prev_close?: number | null;
  change?: number | null;
  change_percent?: number | null;
  volume?: number | null;
  year_high?: number | null;
  year_low?: number | null;
  market_cap?: number | null;
  currency?: string | null;
  timestamp?: string;
  source?: Source;
}

export interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Status {
  mode: "live" | "demo";
  requested_mode: "auto" | "live" | "demo";
  openbb: boolean;
  openbb_error: string | null;
  last_probe: number | null;
  last_probe_error: string | null;
  ai_available: boolean;
  ai_reason: string | null;
  ai_model: string | null;
  server_time: number;
  uptime: number;
  clients: number;
}

export interface Order {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  order_type: string;
  limit_price: number | null;
  stop_price: number | null;
  tif: string;
  status: string;
  filled_price: number | null;
  filled_at: number | null;
  reason: string | null;
  created: number;
  data_source: string | null;
}

export interface Position {
  symbol: string;
  quantity: number;
  avg_cost: number;
  last: number;
  market_value: number;
  unrealized_pnl: number;
  unrealized_pct: number | null;
  day_pnl: number;
  weight: number | null;
  priced: boolean;
  source: Source | null;
}

export interface Portfolio {
  account: { id: string; name: string; cash: number; initial_cash: number; realized_pnl: number };
  positions: Position[];
  cash: number;
  market_value: number;
  equity: number;
  unrealized_pnl: number;
  realized_pnl: number;
  day_pnl: number;
  total_return: number | null;
  gross_exposure: number;
  source: Source;
}

export interface Alert {
  id: string;
  symbol: string;
  condition: "above" | "below" | "change_above" | "change_below";
  value: number;
  note: string | null;
  status: string;
  created: number;
  triggered_at: number | null;
  triggered_price: number | null;
}

export interface Watchlist {
  id: string;
  name: string;
  symbols: string[];
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) window.dispatchEvent(new Event("odp-auth-required"));
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? j);
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

const q = (params: Record<string, string | number | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : "";
};

const T = "/terminal";

export const api = {
  status: () => request<Status>("GET", `${T}/status`),
  setMode: (mode: string) => request<Status>("POST", `${T}/mode`, { mode }),
  quotes: (symbols: string[]) => request<Envelope<Quote[]>>("GET", `${T}/quote${q({ symbols: symbols.join(",") })}`),
  history: (symbol: string, interval = "1d", start?: string) =>
    request<Envelope<Bar[]>>("GET", `${T}/history${q({ symbol, interval, start })}`),
  profile: (symbol: string) => request<Envelope<Record<string, any>>>("GET", `${T}/profile${q({ symbol })}`),
  fundamentals: (symbol: string, statement: string, period: string, limit = 5) =>
    request<Envelope<Record<string, any>[]>>("GET", `${T}/fundamentals${q({ symbol, statement, period, limit })}`),
  news: (symbols?: string[], limit = 40) =>
    request<Envelope<Record<string, any>[]>>("GET", `${T}/news${q({ symbols: symbols?.join(","), limit })}`),
  options: (symbol: string) => request<Envelope<Record<string, any>[]>>("GET", `${T}/options${q({ symbol })}`),
  yieldCurve: (date?: string) => request<Envelope<Record<string, any>[]>>("GET", `${T}/yield_curve${q({ date })}`),
  economic: () => request<Envelope<Record<string, any>[]>>("GET", `${T}/calendar/economic`),
  earnings: () => request<Envelope<Record<string, any>[]>>("GET", `${T}/calendar/earnings`),
  world: () => request<Envelope<Record<string, any>[]>>("GET", `${T}/world`),
  fx: () => request<Envelope<Record<string, any>[]>>("GET", `${T}/fx`),
  crypto: () => request<Envelope<Record<string, any>[]>>("GET", `${T}/crypto`),
  commodities: () => request<Envelope<Record<string, any>[]>>("GET", `${T}/commodities`),
  movers: () => request<Envelope<Record<string, Record<string, any>[]>>>("GET", `${T}/movers`),
  sectors: () => request<Envelope<Record<string, any>[]>>("GET", `${T}/sectors`),
  search: (query: string) => request<Envelope<{ symbol: string; name: string; kind: string }[]>>("GET", `${T}/search${q({ q: query })}`),
  filings: (symbol: string) => request<Envelope<Record<string, any>[]>>("GET", `${T}/filings${q({ symbol })}`),
  insider: (symbol: string) => request<Envelope<Record<string, any>[]>>("GET", `${T}/insider${q({ symbol })}`),
  insights: (symbol: string) => request<Envelope<Record<string, any>>>("GET", `${T}/insights${q({ symbol })}`),
  correlation: (symbols: string[]) =>
    request<Envelope<{ symbols: string[]; matrix: (number | null)[][]; observations: number }>>(
      "GET",
      `${T}/correlation${q({ symbols: symbols.join(",") })}`,
    ),
  obbCommands: () => request<{ commands: Record<string, string[]> }>("GET", `${T}/obb/commands`),
  obbRun: (path: string, provider: string | null, params: Record<string, unknown>) =>
    request<Envelope<Record<string, any>[]>>("POST", `${T}/obb/run`, { path, provider, params }),
  credentials: () => request<{ credentials: Record<string, boolean> }>("GET", `${T}/credentials`),
  setCredential: (name: string, value: string) => request("POST", `${T}/credentials`, { name, value }),
  watchlists: () => request<Watchlist[]>("GET", `${T}/watchlists`),
  createWatchlist: (name: string, symbols: string[]) => request<Watchlist>("POST", `${T}/watchlists`, { name, symbols }),
  updateWatchlist: (id: string, patch: Partial<Watchlist>) => request<Watchlist>("PATCH", `${T}/watchlists/${id}`, patch),
  deleteWatchlist: (id: string) => request("DELETE", `${T}/watchlists/${id}`),
  layouts: () => request<{ id: string; name: string; updated: number }[]>("GET", `${T}/layouts`),
  layout: (id: string) => request<{ id: string; name: string; data: any }>("GET", `${T}/layouts/${id}`),
  saveLayout: (name: string, data: unknown, id?: string) => request<{ id: string }>("POST", `${T}/layouts`, { id, name, data }),
  deleteLayout: (id: string) => request("DELETE", `${T}/layouts/${id}`),
  portfolio: () => request<Portfolio>("GET", `${T}/portfolio`),
  portfolioHistory: () => request<{ ts: number; equity: number }[]>("GET", `${T}/portfolio/history`),
  resetPortfolio: (cash: number) => request<Portfolio>("POST", `${T}/portfolio/reset`, { cash }),
  orders: () => request<Order[]>("GET", `${T}/orders`),
  submitOrder: (o: {
    symbol: string;
    side: string;
    quantity: number;
    order_type: string;
    limit_price?: number | null;
    stop_price?: number | null;
    tif?: string;
  }) => request<Order>("POST", `${T}/orders`, o),
  cancelOrder: (id: string) => request<Order>("DELETE", `${T}/orders/${id}`),
  alerts: () => request<Alert[]>("GET", `${T}/alerts`),
  addAlert: (a: { symbol: string; condition: string; value: number; note?: string }) => request<Alert>("POST", `${T}/alerts`, a),
  deleteAlert: (id: string) => request("DELETE", `${T}/alerts/${id}`),
  notes: (symbol?: string) => request<{ id: string; symbol: string | null; body: string; created: number }[]>("GET", `${T}/notes${q({ symbol })}`),
  addNote: (symbol: string | null, body: string) => request("POST", `${T}/notes`, { symbol, body }),
  deleteNote: (id: string) => request("DELETE", `${T}/notes/${id}`),
  analyst: async (question: string, symbol: string | null, includePortfolio: boolean, onChunk: (s: string) => void, signal?: AbortSignal) => {
    const res = await fetch(`${T}/analyst`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, symbol, include_portfolio: includePortfolio }),
      signal,
    });
    if (!res.ok || !res.body) {
      let msg = res.statusText;
      try {
        msg = (await res.json()).detail ?? msg;
      } catch {
        /* ignore */
      }
      throw new ApiError(res.status, msg);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onChunk(dec.decode(value, { stream: true }));
    }
  },
};
