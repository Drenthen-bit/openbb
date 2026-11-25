// WebSocket quote stream with reference-counted symbol subscriptions.
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { Alert, Order, Quote, Status } from "./api";

type Listener = () => void;
export type StreamEvent =
  | { type: "order"; data: Order }
  | { type: "alert"; data: Alert }
  | { type: "status"; data: Status };

class QuoteStream {
  private ws: WebSocket | null = null;
  private quotes = new Map<string, Quote>();
  private prev = new Map<string, number>();
  private refs = new Map<string, number>();
  private listeners = new Set<Listener>();
  private eventListeners = new Set<(e: StreamEvent) => void>();
  private version = 0;
  private retry = 0;
  connected = false;
  private connListeners = new Set<Listener>();

  connect() {
    if (this.ws) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/terminal/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setConnected(true);
      this.sendSet();
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "quotes") {
        for (const q of msg.data as Quote[]) {
          const old = this.quotes.get(q.symbol);
          if (old?.last != null) this.prev.set(q.symbol, old.last);
          this.quotes.set(q.symbol, { ...q, source: msg.source });
        }
        this.version++;
        this.listeners.forEach((l) => l());
      } else if (msg.type === "order" || msg.type === "alert" || msg.type === "status") {
        this.eventListeners.forEach((l) => l(msg));
      }
    };
    ws.onclose = () => {
      this.ws = null;
      this.setConnected(false);
      const delay = Math.min(10000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => ws.close();
  }

  private setConnected(v: boolean) {
    this.connected = v;
    this.connListeners.forEach((l) => l());
  }

  private sendSet() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op: "set", symbols: [...this.refs.keys()] }));
    }
  }

  retain(symbols: string[]) {
    let changed = false;
    for (const s of symbols) {
      const n = this.refs.get(s) ?? 0;
      if (n === 0) changed = true;
      this.refs.set(s, n + 1);
    }
    if (changed) this.sendSet();
  }

  release(symbols: string[]) {
    let changed = false;
    for (const s of symbols) {
      const n = (this.refs.get(s) ?? 1) - 1;
      if (n <= 0) {
        this.refs.delete(s);
        changed = true;
      } else this.refs.set(s, n);
    }
    if (changed) this.sendSet();
  }

  /** Clear cached quotes, e.g. after switching data mode, and resubscribe. */
  reset() {
    this.quotes.clear();
    this.prev.clear();
    this.version++;
    this.listeners.forEach((l) => l());
    this.sendSet();
  }

  get(symbol: string) {
    return this.quotes.get(symbol);
  }
  prevLast(symbol: string) {
    return this.prev.get(symbol);
  }
  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getVersion = () => this.version;
  onEvent(l: (e: StreamEvent) => void) {
    this.eventListeners.add(l);
    return () => {
      this.eventListeners.delete(l);
    };
  }
  onConnection = (l: Listener) => {
    this.connListeners.add(l);
    return () => this.connListeners.delete(l);
  };
  getConnected = () => this.connected;
}

export const stream = new QuoteStream();

/** Subscribe to live quotes for symbols; re-renders on every tick. */
export function useQuotes(symbols: string[]): Record<string, Quote | undefined> {
  const key = symbols.filter(Boolean).map((s) => s.toUpperCase()).sort().join(",");
  useEffect(() => {
    const list = key ? key.split(",") : [];
    stream.retain(list);
    return () => stream.release(list);
  }, [key]);
  const version = useSyncExternalStore(stream.subscribe, stream.getVersion);
  return useMemo(() => {
    const out: Record<string, Quote | undefined> = {};
    for (const s of key ? key.split(",") : []) out[s] = stream.get(s);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);
}

export function useQuote(symbol: string | null | undefined): Quote | undefined {
  const qs = useQuotes(symbol ? [symbol] : []);
  return symbol ? qs[symbol.toUpperCase()] : undefined;
}

export function useConnected() {
  return useSyncExternalStore(stream.onConnection, stream.getConnected);
}

export function useStreamEvents(handler: (e: StreamEvent) => void) {
  useEffect(() => stream.onEvent(handler), [handler]);
}
