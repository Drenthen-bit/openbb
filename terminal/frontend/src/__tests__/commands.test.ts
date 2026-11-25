import { describe, expect, it } from "vitest";
import { parseCommand, suggest } from "../lib/commands";

describe("parseCommand", () => {
  it("loads a bare ticker", () => {
    expect(parseCommand("aapl")).toEqual({ kind: "load", symbol: "AAPL" });
  });
  it("opens a function for a ticker in either order", () => {
    const a = parseCommand("AAPL GP");
    const b = parseCommand("gp aapl");
    expect(a).toMatchObject({ kind: "open", symbol: "AAPL" });
    expect(b).toMatchObject({ kind: "open", symbol: "AAPL" });
    if (a?.kind === "open") expect(a.fn.type).toBe("chart");
  });
  it("ignores Bloomberg-style yellow keys", () => {
    expect(parseCommand("AAPL US <Equity> DES <GO>")).toMatchObject({ kind: "open", symbol: "AAPL" });
  });
  it("opens functions without a security", () => {
    const c = parseCommand("WEI");
    expect(c).toMatchObject({ kind: "open" });
    if (c?.kind === "open") {
      expect(c.fn.type).toBe("world");
      expect(c.symbol).toBeUndefined();
    }
  });
  it("parses market, limit, stop and stop-limit orders", () => {
    expect(parseCommand("BUY 100 AAPL")).toMatchObject({ kind: "order", side: "buy", quantity: 100, symbol: "AAPL", order_type: "market", tif: "day" });
    expect(parseCommand("sell 50 msft lmt 410.5 gtc")).toMatchObject({ side: "sell", order_type: "limit", limit_price: 410.5, tif: "gtc" });
    expect(parseCommand("SELL 10 TSLA STP 200")).toMatchObject({ order_type: "stop", stop_price: 200 });
    expect(parseCommand("BUY 10 TSLA STP 260 LMT 262")).toMatchObject({ order_type: "stop_limit", stop_price: 260, limit_price: 262 });
    expect(parseCommand("BUY AAPL 25")).toMatchObject({ quantity: 25, symbol: "AAPL" });
  });
  it("rejects malformed orders", () => {
    expect(parseCommand("BUY AAPL")).toMatchObject({ kind: "error" });
    expect(parseCommand("BUY -5 AAPL")).toMatchObject({ kind: "error" });
    expect(parseCommand("BUY 5 AAPL FOO")).toMatchObject({ kind: "error" });
  });
  it("parses alerts", () => {
    expect(parseCommand("ALRT AAPL > 250")).toEqual({ kind: "alert", symbol: "AAPL", condition: "above", value: 250 });
    expect(parseCommand("ALRT SPY %< -2")).toEqual({ kind: "alert", symbol: "SPY", condition: "change_below", value: -2 });
    expect(parseCommand("ALRT SPY <=500")).toEqual({ kind: "alert", symbol: "SPY", condition: "below", value: 500 });
  });
  it("handles navigation and system commands", () => {
    expect(parseCommand("PAGE 3")).toEqual({ kind: "page", index: 2 });
    expect(parseCommand("NEW Ideas")).toEqual({ kind: "newpage", name: "IDEAS" });
    expect(parseCommand("MODE demo")).toEqual({ kind: "mode", mode: "demo" });
    expect(parseCommand("MODE x")).toMatchObject({ kind: "error" });
    expect(parseCommand("")).toBeNull();
  });
});

describe("suggest", () => {
  it("suggests functions and symbols", () => {
    const s = suggest("OM", [{ symbol: "OMC", name: "Omnicom" }]);
    expect(s.map((x) => x.value)).toContain("OMON");
    expect(s.map((x) => x.value)).toContain("OMC");
  });
  it("suggests security functions after a ticker", () => {
    expect(suggest("AAPL G").map((x) => x.value)).toContain("AAPL GP");
  });
});
