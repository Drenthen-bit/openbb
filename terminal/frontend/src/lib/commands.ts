// Command-line grammar for the terminal.
//
//   AAPL                 -> load AAPL into the active link group
//   AAPL GP | GP AAPL    -> open a chart for AAPL
//   WEI                  -> open a function that needs no security
//   BUY 100 AAPL [LMT 230 | STP 210] [GTC]
//   SELL 50 AAPL
//   ALRT AAPL > 250 | ALRT AAPL < 200 | ALRT AAPL %> 3
//   PAGE 2 | NEW | SAVE name | LOAD name | MODE demo|live|auto | HELP

export type PanelType =
  | "chart" | "quote" | "monitor" | "news" | "options" | "fundamentals" | "yield" | "eco" | "earnings"
  | "world" | "fx" | "crypto" | "commodities" | "movers" | "sectors" | "portfolio" | "ticket"
  | "blotter" | "alerts" | "insights" | "analyst" | "correlation" | "filings" | "api" | "notes"
  | "help" | "settings" | "intraday";

export interface FunctionDef {
  type: PanelType;
  mnemonics: string[];
  title: string;
  description: string;
  needsSymbol: boolean;
  w: number;
  h: number;
  category: "Security" | "Markets" | "Macro" | "Trading" | "Research" | "System";
}

export const FUNCTIONS: FunctionDef[] = [
  { type: "chart", mnemonics: ["GP", "G", "CHART"], title: "Price Chart", description: "Candlestick chart with overlays and studies", needsSymbol: true, w: 6, h: 10, category: "Security" },
  { type: "intraday", mnemonics: ["GIP", "IGP"], title: "Intraday Chart", description: "Intraday price chart (5-minute bars)", needsSymbol: true, w: 6, h: 9, category: "Security" },
  { type: "quote", mnemonics: ["DES", "Q", "QUOTE"], title: "Description", description: "Quote, key statistics and company description", needsSymbol: true, w: 4, h: 10, category: "Security" },
  { type: "fundamentals", mnemonics: ["FA", "FIN"], title: "Financial Analysis", description: "Income statement, balance sheet, cash flow", needsSymbol: true, w: 6, h: 10, category: "Security" },
  { type: "options", mnemonics: ["OMON", "OPT"], title: "Option Monitor", description: "Option chain with greeks and IV smile", needsSymbol: true, w: 7, h: 11, category: "Security" },
  { type: "insights", mnemonics: ["TECH", "TA", "SIG"], title: "Technical Insights", description: "Trend, momentum and volatility signals", needsSymbol: true, w: 4, h: 10, category: "Security" },
  { type: "filings", mnemonics: ["CF", "FIL", "INS"], title: "Filings & Insiders", description: "Regulatory filings and insider transactions", needsSymbol: true, w: 5, h: 9, category: "Security" },
  { type: "news", mnemonics: ["N", "CN", "TOP", "NEWS"], title: "News", description: "Headlines for the security or market", needsSymbol: false, w: 4, h: 10, category: "Markets" },
  { type: "monitor", mnemonics: ["W", "MON", "WATCH"], title: "Monitor", description: "Watchlist monitor with live quotes", needsSymbol: false, w: 5, h: 10, category: "Markets" },
  { type: "world", mnemonics: ["WEI", "INDX"], title: "World Equity Indices", description: "Major global index levels", needsSymbol: false, w: 4, h: 10, category: "Markets" },
  { type: "movers", mnemonics: ["MOST", "MOV"], title: "Market Movers", description: "Top gainers, losers and most active", needsSymbol: false, w: 4, h: 10, category: "Markets" },
  { type: "sectors", mnemonics: ["IMAP", "SECT", "HEAT"], title: "Sector Heatmap", description: "Sector performance heatmap", needsSymbol: false, w: 4, h: 7, category: "Markets" },
  { type: "earnings", mnemonics: ["ERN", "EVTS", "EA"], title: "Earnings Calendar", description: "Upcoming earnings announcements", needsSymbol: false, w: 5, h: 9, category: "Markets" },
  { type: "yield", mnemonics: ["GC", "YCRV", "CURVE"], title: "Yield Curve", description: "US Treasury yield curve", needsSymbol: false, w: 5, h: 9, category: "Macro" },
  { type: "eco", mnemonics: ["ECO", "CAL"], title: "Economic Calendar", description: "Economic releases: actual vs consensus", needsSymbol: false, w: 6, h: 10, category: "Macro" },
  { type: "fx", mnemonics: ["FX", "FXIP", "WCR"], title: "Currencies", description: "Major FX crosses", needsSymbol: false, w: 4, h: 8, category: "Macro" },
  { type: "crypto", mnemonics: ["CRYP", "XBT", "CRYPTO"], title: "Crypto", description: "Major crypto assets", needsSymbol: false, w: 4, h: 7, category: "Macro" },
  { type: "commodities", mnemonics: ["CMDTY", "GLCO", "CMD"], title: "Commodities", description: "Energy, metals and agriculture", needsSymbol: false, w: 4, h: 8, category: "Macro" },
  { type: "ticket", mnemonics: ["TKT", "TRADE", "EMSX"], title: "Order Ticket", description: "Paper-trading order entry", needsSymbol: true, w: 3, h: 10, category: "Trading" },
  { type: "portfolio", mnemonics: ["PORT", "PRTU", "POS"], title: "Portfolio", description: "Positions and P&L (paper account)", needsSymbol: false, w: 6, h: 10, category: "Trading" },
  { type: "blotter", mnemonics: ["BLOT", "ORD", "ORDERS"], title: "Order Blotter", description: "Working and filled orders", needsSymbol: false, w: 6, h: 8, category: "Trading" },
  { type: "alerts", mnemonics: ["ALRT", "ALERTS"], title: "Alerts", description: "Price and change alerts", needsSymbol: false, w: 4, h: 8, category: "Trading" },
  { type: "analyst", mnemonics: ["AI", "ASK", "BQ"], title: "AI Analyst", description: "Ask Claude about the security or your book", needsSymbol: false, w: 5, h: 12, category: "Research" },
  { type: "correlation", mnemonics: ["CORR", "COR"], title: "Correlation Matrix", description: "Return correlations across a basket", needsSymbol: false, w: 5, h: 9, category: "Research" },
  { type: "api", mnemonics: ["API", "ODP", "OBB"], title: "OpenBB Data Explorer", description: "Run any OpenBB Platform command", needsSymbol: false, w: 7, h: 11, category: "Research" },
  { type: "notes", mnemonics: ["NOTE", "NOTES", "NSE"], title: "Notes", description: "Research notes, tagged by security", needsSymbol: false, w: 4, h: 8, category: "Research" },
  { type: "help", mnemonics: ["HELP", "?", "FUNC"], title: "Function Directory", description: "All functions and keyboard shortcuts", needsSymbol: false, w: 6, h: 11, category: "System" },
  { type: "settings", mnemonics: ["SET", "PREF", "CONFIG"], title: "Settings", description: "Data mode, provider credentials, layouts", needsSymbol: false, w: 5, h: 10, category: "System" },
];

const BY_MNEMONIC = new Map<string, FunctionDef>();
for (const f of FUNCTIONS) for (const m of f.mnemonics) BY_MNEMONIC.set(m, f);

export const functionFor = (type: PanelType) => FUNCTIONS.find((f) => f.type === type)!;
export const lookupMnemonic = (m: string) => BY_MNEMONIC.get(m.toUpperCase());

export type Command =
  | { kind: "open"; fn: FunctionDef; symbol?: string }
  | { kind: "load"; symbol: string }
  | {
      kind: "order";
      side: "buy" | "sell";
      quantity: number;
      symbol: string;
      order_type: "market" | "limit" | "stop" | "stop_limit";
      limit_price?: number;
      stop_price?: number;
      tif: "day" | "gtc";
    }
  | { kind: "alert"; symbol: string; condition: "above" | "below" | "change_above" | "change_below"; value: number }
  | { kind: "page"; index: number }
  | { kind: "newpage"; name?: string }
  | { kind: "save"; name: string }
  | { kind: "load_layout"; name: string }
  | { kind: "mode"; mode: "auto" | "live" | "demo" }
  | { kind: "error"; message: string };

const SYMBOL_RE = /^\^?[A-Z0-9][A-Z0-9.\-=/]{0,14}$/;
const isSymbol = (t: string) => SYMBOL_RE.test(t);
const num = (t: string | undefined) => (t !== undefined && t !== "" && !Number.isNaN(Number(t)) ? Number(t) : undefined);

// Words that are never treated as securities on their own.
const RESERVED = new Set(["BUY", "SELL", "ALRT", "PAGE", "NEW", "SAVE", "LOAD", "MODE", "GO"]);

export function parseCommand(input: string): Command | null {
  const raw = input.trim();
  if (!raw) return null;
  const tokens = raw.toUpperCase().split(/\s+/).filter((t) => !["<EQUITY>", "<GO>", "EQUITY", "US"].includes(t));
  const [head, ...rest] = tokens;
  if (!head) return null;

  if (head === "BUY" || head === "SELL") {
    // BUY 100 AAPL [LMT 230] [STP 220] [GTC]   or   BUY AAPL 100
    let qty = num(rest[0]);
    let sym = rest[1];
    let i = 2;
    if (qty === undefined) {
      sym = rest[0];
      qty = num(rest[1]);
    }
    if (!sym || !isSymbol(sym) || qty === undefined || qty <= 0) {
      return { kind: "error", message: `Usage: ${head} <qty> <symbol> [LMT <px>] [STP <px>] [GTC]` };
    }
    let limit: number | undefined;
    let stop: number | undefined;
    let tif: "day" | "gtc" = "day";
    for (; i < rest.length; i++) {
      const t = rest[i];
      if (t === "LMT" || t === "LIMIT" || t === "@") limit = num(rest[++i]);
      else if (t === "STP" || t === "STOP") stop = num(rest[++i]);
      else if (t === "GTC") tif = "gtc";
      else if (t === "DAY") tif = "day";
      else if (t.startsWith("@")) limit = num(t.slice(1));
      else return { kind: "error", message: `Unrecognized order term "${t}"` };
    }
    const order_type = limit !== undefined && stop !== undefined ? "stop_limit" : limit !== undefined ? "limit" : stop !== undefined ? "stop" : "market";
    return { kind: "order", side: head === "BUY" ? "buy" : "sell", quantity: qty, symbol: sym, order_type, limit_price: limit, stop_price: stop, tif };
  }

  if (head === "ALRT" && rest.length >= 2) {
    // ALRT AAPL > 250 | ALRT AAPL >250 | ALRT AAPL %> 3
    const sym = rest[0];
    const expr = rest.slice(1).join("");
    const m = expr.match(/^(%?)(>=|<=|>|<)(-?\d+(?:\.\d+)?)$/);
    if (!isSymbol(sym) || !m) return { kind: "error", message: "Usage: ALRT <symbol> > <price>  |  ALRT <symbol> %< -3" };
    const pct = m[1] === "%";
    const up = m[2].startsWith(">");
    return {
      kind: "alert",
      symbol: sym,
      condition: pct ? (up ? "change_above" : "change_below") : up ? "above" : "below",
      value: Number(m[3]),
    };
  }

  if (head === "PAGE" && rest[0]) {
    const n = num(rest[0]);
    return n ? { kind: "page", index: n - 1 } : { kind: "error", message: "Usage: PAGE <number>" };
  }
  if (head === "NEW") return { kind: "newpage", name: rest.join(" ") || undefined };
  if (head === "SAVE") return rest.length ? { kind: "save", name: rest.join(" ") } : { kind: "error", message: "Usage: SAVE <layout name>" };
  if (head === "LOAD" && rest.length) return { kind: "load_layout", name: rest.join(" ") };
  if (head === "MODE") {
    const m = (rest[0] ?? "").toLowerCase();
    if (m === "auto" || m === "live" || m === "demo") return { kind: "mode", mode: m };
    return { kind: "error", message: "Usage: MODE auto|live|demo" };
  }

  // <FUNCTION> [SYMBOL]
  const fnHead = lookupMnemonic(head);
  if (fnHead) {
    const sym = rest.find((t) => isSymbol(t) && !lookupMnemonic(t));
    return { kind: "open", fn: fnHead, symbol: sym };
  }
  // <SYMBOL> [FUNCTION]
  if (isSymbol(head) && !RESERVED.has(head)) {
    const fn = rest.map(lookupMnemonic).find(Boolean);
    if (fn) return { kind: "open", fn, symbol: head };
    if (rest.length === 0) return { kind: "load", symbol: head };
  }
  return { kind: "error", message: `Unknown command "${raw}". Type HELP for the function list.` };
}

export interface Suggestion {
  label: string;
  detail: string;
  value: string;
}

/** Autocomplete suggestions for the command line. */
export function suggest(input: string, symbols: { symbol: string; name: string }[] = []): Suggestion[] {
  const raw = input.trim().toUpperCase();
  if (!raw) return [];
  const parts = raw.split(/\s+/);
  const last = parts[parts.length - 1];
  const out: Suggestion[] = [];
  if (parts.length === 1) {
    for (const f of FUNCTIONS) {
      const m = f.mnemonics.find((x) => x.startsWith(last));
      if (m) out.push({ label: m, detail: f.title, value: m });
    }
    for (const s of symbols) {
      if (s.symbol.startsWith(last) || s.name.toUpperCase().includes(last)) out.push({ label: s.symbol, detail: s.name, value: s.symbol });
    }
  } else if (isSymbol(parts[0]) && !lookupMnemonic(parts[0])) {
    for (const f of FUNCTIONS.filter((f) => f.needsSymbol)) {
      const m = f.mnemonics.find((x) => x.startsWith(last));
      if (m) out.push({ label: `${parts[0]} ${m}`, detail: f.title, value: `${parts[0]} ${m}` });
    }
  }
  return out.slice(0, 10);
}
