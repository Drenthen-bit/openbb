import { describe, expect, it } from "vitest";
import { bollinger, ema, macd, rsi, sma } from "../lib/indicators";
import { fmtBig, fmtPct } from "../lib/format";

describe("indicators", () => {
  const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  it("sma", () => {
    expect(sma(v, 3).slice(0, 4)).toEqual([undefined, undefined, 2, 3]);
  });
  it("ema seeds from the sma", () => {
    const e = ema(v, 3);
    expect(e[2]).toBe(2);
    expect(e[3]).toBeCloseTo(3);
  });
  it("rsi is 100 for a monotonic rise and in range otherwise", () => {
    expect(rsi(v, 5)[9]).toBe(100);
    const zig = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i) * 5);
    const r = rsi(zig).filter((x) => x !== undefined) as number[];
    expect(r.every((x) => x >= 0 && x <= 100)).toBe(true);
  });
  it("macd lines align with input length", () => {
    const series = Array.from({ length: 60 }, (_, i) => 100 + i * 0.5 + Math.sin(i));
    const m = macd(series);
    expect(m.line).toHaveLength(60);
    expect(m.signal[59]).toBeDefined();
    expect(m.hist[59]).toBeCloseTo(m.line[59]! - m.signal[59]!);
  });
  it("bollinger bands bracket the mean", () => {
    const b = bollinger([...v, ...v], 5);
    expect(b.upper[10]!).toBeGreaterThan(b.mid[10]!);
    expect(b.lower[10]!).toBeLessThan(b.mid[10]!);
  });
});

describe("format", () => {
  it("formats big numbers and percents", () => {
    expect(fmtBig(2.5e12)).toBe("2.50T");
    expect(fmtBig(-3.2e6)).toBe("-3.20M");
    expect(fmtPct(0.0123)).toBe("+1.23%");
    expect(fmtPct(null)).toBe("—");
  });
});
