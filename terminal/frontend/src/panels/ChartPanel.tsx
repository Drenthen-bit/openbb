import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { api, type Bar } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { bollinger, ema, macd, rsi, sma, vwap } from "../lib/indicators";
import { useQuote } from "../lib/stream";
import { fmtBig, fmtPct, fmtPrice, tone } from "../lib/format";
import { ErrorState, Loading, SourceBadge } from "../components/ui";
import type { PanelProps } from "./types";

const RANGES: Record<string, { interval: string; days: number }> = {
  "1D": { interval: "5m", days: 1 },
  "5D": { interval: "15m", days: 5 },
  "1M": { interval: "1d", days: 31 },
  "3M": { interval: "1d", days: 92 },
  "6M": { interval: "1d", days: 183 },
  YTD: { interval: "1d", days: -1 },
  "1Y": { interval: "1d", days: 366 },
  "5Y": { interval: "1W", days: 365 * 5 },
};

const STUDIES = ["SMA20", "SMA50", "SMA200", "EMA21", "BB", "VWAP", "VOL", "RSI", "MACD"] as const;
type Study = (typeof STUDIES)[number];

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";

function toTime(d: string, intraday: boolean): Time {
  return (intraday ? (Math.floor(new Date(d).getTime() / 1000) as UTCTimestamp) : d.slice(0, 10)) as Time;
}

export default function ChartPanel({ symbol, panel, setOpts }: PanelProps) {
  const range: string = panel.opts?.range ?? (panel.type === "intraday" ? "1D" : "1Y");
  const style: "candle" | "line" | "area" = panel.opts?.style ?? "candle";
  const studies: Study[] = panel.opts?.studies ?? ["SMA50", "SMA200", "VOL"];
  const cfg = RANGES[range] ?? RANGES["1Y"];
  const intraday = cfg.interval.endsWith("m") || cfg.interval.endsWith("h");

  // Visible range start, plus an earlier fetch start so long averages are warmed up.
  const { start, fetchStart } = useMemo(() => {
    if (intraday) return { start: undefined, fetchStart: undefined };
    const d = new Date();
    if (cfg.days === -1) d.setMonth(0, 1);
    else d.setDate(d.getDate() - cfg.days);
    const visible = d.toISOString().slice(0, 10);
    const warm = new Date(d);
    warm.setDate(warm.getDate() - (cfg.interval === "1W" ? 7 * 210 : 300));
    return { start: visible, fetchStart: warm.toISOString().slice(0, 10) };
  }, [cfg.days, cfg.interval, intraday]);

  const { data, error, loading, reload } = useAsync(
    () => (symbol ? api.history(symbol, cfg.interval, fetchStart) : Promise.resolve(undefined)),
    [symbol, cfg.interval, fetchStart],
    intraday ? 60_000 : undefined,
  );
  const bars: Bar[] = useMemo(() => {
    let b = data?.data ?? [];
    if (intraday && cfg.days === 1 && b.length) {
      const lastDay = b[b.length - 1].date.slice(0, 10);
      b = b.filter((x) => x.date.slice(0, 10) === lastDay);
    }
    return b;
  }, [data, intraday, cfg.days]);
  const quote = useQuote(symbol);

  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<"Candlestick" | "Line" | "Area"> | null>(null);
  const lastBarRef = useRef<Bar | null>(null);
  const [hover, setHover] = useState<Bar | null>(null);

  useEffect(() => {
    if (!host.current || !bars.length) return;
    const up = css("--up");
    const down = css("--down");
    const chart = createChart(host.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: css("--muted"),
        fontFamily: css("--font-mono"),
        fontSize: 11,
        panes: { separatorColor: css("--border"), separatorHoverColor: css("--accent") },
      },
      grid: { vertLines: { color: css("--grid") }, horzLines: { color: css("--grid") } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: css("--border") },
      timeScale: { borderColor: css("--border"), timeVisible: intraday, secondsVisible: false },
    });
    chartRef.current = chart;
    const times = bars.map((b) => toTime(b.date, intraday));
    const closes = bars.map((b) => b.close);

    let main: ISeriesApi<"Candlestick" | "Line" | "Area">;
    if (style === "candle") {
      main = chart.addSeries(CandlestickSeries, { upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down });
      main.setData(bars.map((b, i) => ({ time: times[i], open: b.open, high: b.high, low: b.low, close: b.close })));
    } else if (style === "line") {
      main = chart.addSeries(LineSeries, { color: css("--accent"), lineWidth: 2 });
      main.setData(bars.map((b, i) => ({ time: times[i], value: b.close })));
    } else {
      const accent = css("--accent");
      main = chart.addSeries(AreaSeries, { lineColor: accent, topColor: `${accent}55`, bottomColor: `${accent}05`, lineWidth: 2 });
      main.setData(bars.map((b, i) => ({ time: times[i], value: b.close })));
    }
    mainRef.current = main;
    lastBarRef.current = { ...bars[bars.length - 1] };

    const line = (values: (number | undefined)[], color: string, pane = 0, width: 1 | 2 = 1) => {
      const s = chart.addSeries(LineSeries, { color, lineWidth: width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, pane);
      s.setData(values.map((v, i) => (v === undefined ? { time: times[i] } : { time: times[i], value: v })));
      return s;
    };
    const has = (s: Study) => studies.includes(s);
    if (has("SMA20")) line(sma(closes, 20), css("--c2"));
    if (has("SMA50")) line(sma(closes, 50), css("--c3"));
    if (has("SMA200")) line(sma(closes, 200), css("--c4"));
    if (has("EMA21")) line(ema(closes, 21), css("--c5"));
    if (has("BB")) {
      const bb = bollinger(closes);
      line(bb.upper, css("--c6"));
      line(bb.mid, css("--c6"));
      line(bb.lower, css("--c6"));
    }
    if (has("VWAP") && intraday) line(vwap(bars.map((b) => b.high), bars.map((b) => b.low), closes, bars.map((b) => b.volume)), css("--c5"), 0, 2);
    if (has("VOL")) {
      const v = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
      v.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      v.setData(bars.map((b, i) => ({ time: times[i], value: b.volume, color: b.close >= b.open ? `${up}66` : `${down}66` })));
    }
    let pane = 1;
    if (has("RSI")) {
      const s = line(rsi(closes), css("--c2"), pane);
      s.createPriceLine({ price: 70, color: down, lineStyle: 2, lineWidth: 1, axisLabelVisible: false, title: "" });
      s.createPriceLine({ price: 30, color: up, lineStyle: 2, lineWidth: 1, axisLabelVisible: false, title: "" });
      pane++;
    }
    if (has("MACD")) {
      const m = macd(closes);
      const h = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane);
      h.setData(m.hist.map((v, i) => (v === undefined ? { time: times[i] } : { time: times[i], value: v, color: v >= 0 ? `${up}99` : `${down}99` })));
      line(m.line, css("--c3"), pane);
      line(m.signal, css("--c4"), pane);
      pane++;
    }
    const panes = chart.panes();
    for (let i = 1; i < panes.length; i++) panes[i].setHeight(70);

    const byTime = new Map(times.map((t, i) => [String(t), bars[i]]));
    chart.subscribeCrosshairMove((p) => setHover(p.time !== undefined ? (byTime.get(String(p.time)) ?? null) : null));
    const firstVisible = start ? bars.findIndex((b) => b.date.slice(0, 10) >= start) : 0;
    if (firstVisible > 0) chart.timeScale().setVisibleLogicalRange({ from: firstVisible, to: bars.length - 1 + 3 });
    else chart.timeScale().fitContent();
    return () => {
      chart.remove();
      chartRef.current = null;
      mainRef.current = null;
    };
  }, [bars, style, studies.join(","), intraday, start]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stream the live price into the last bar.
  useEffect(() => {
    const s = mainRef.current;
    const lb = lastBarRef.current;
    if (!s || !lb || quote?.last == null) return;
    const px = quote.last;
    lb.close = px;
    lb.high = Math.max(lb.high, px);
    lb.low = Math.min(lb.low, px);
    const t = toTime(lb.date, intraday);
    try {
      if (style === "candle") (s as ISeriesApi<"Candlestick">).update({ time: t, open: lb.open, high: lb.high, low: lb.low, close: px });
      else (s as ISeriesApi<"Line">).update({ time: t, value: px });
    } catch {
      /* out-of-order updates are ignored */
    }
  }, [quote?.last, style, intraday]);

  const toggle = (s: Study) => setOpts({ studies: studies.includes(s) ? studies.filter((x) => x !== s) : [...studies, s] });
  const shown = hover ?? (bars.length ? bars[bars.length - 1] : null);
  const first = (start ? bars.find((b) => b.date.slice(0, 10) >= start) : bars[0])?.close;
  const last = quote?.last ?? bars[bars.length - 1]?.close;
  const perf = first && last ? last / first - 1 : null;

  return (
    <div className="panel-fill">
      <div className="toolbar">
        <div className="seg">
          {Object.keys(RANGES).map((r) => (
            <button key={r} className={`seg-btn ${r === range ? "active" : ""}`} onClick={() => setOpts({ range: r })}>
              {r}
            </button>
          ))}
        </div>
        <div className="seg">
          {(["candle", "line", "area"] as const).map((s) => (
            <button key={s} className={`seg-btn ${s === style ? "active" : ""}`} onClick={() => setOpts({ style: s })}>
              {s === "candle" ? "OHLC" : s.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="seg">
          {STUDIES.map((s) => (
            <button key={s} className={`seg-btn ${studies.includes(s) ? "active" : ""}`} onClick={() => toggle(s)}>
              {s}
            </button>
          ))}
        </div>
        <span className="grow" />
        <SourceBadge source={data?.source} provider={data?.provider} />
      </div>
      {shown && (
        <div className="chart-legend">
          <span className="sym">{symbol}</span>
          <span>{shown.date.slice(0, intraday ? 16 : 10).replace("T", " ")}</span>
          <span>O {fmtPrice(shown.open)}</span>
          <span>H {fmtPrice(shown.high)}</span>
          <span>L {fmtPrice(shown.low)}</span>
          <span>C {fmtPrice(shown.close)}</span>
          <span>V {fmtBig(shown.volume)}</span>
          <span className={tone(perf)}>{range} {fmtPct(perf)}</span>
        </div>
      )}
      <div className="chart-host" ref={host}>
        {!symbol && <div className="state">Enter a security</div>}
        {symbol && loading && !bars.length && <Loading />}
        {symbol && error && !bars.length && <ErrorState error={error} onRetry={reload} />}
        {symbol && !loading && !error && !bars.length && <div className="state">No price history</div>}
      </div>
    </div>
  );
}
