"""Technical analytics and rule-based market insights computed from OHLCV bars."""

from __future__ import annotations

import math
from statistics import mean, pstdev


def sma(values: list[float], n: int) -> list[float | None]:
    out: list[float | None] = []
    s = 0.0
    for i, v in enumerate(values):
        s += v
        if i >= n:
            s -= values[i - n]
        out.append(s / n if i >= n - 1 else None)
    return out


def ema(values: list[float], n: int) -> list[float | None]:
    out: list[float | None] = []
    k = 2 / (n + 1)
    prev = None
    for i, v in enumerate(values):
        if i < n - 1:
            out.append(None)
            continue
        if prev is None:
            prev = sum(values[i - n + 1 : i + 1]) / n
        else:
            prev = v * k + prev * (1 - k)
        out.append(prev)
    return out


def rsi(values: list[float], n: int = 14) -> list[float | None]:
    out: list[float | None] = [None] * len(values)
    if len(values) <= n:
        return out
    gains = [max(values[i] - values[i - 1], 0) for i in range(1, len(values))]
    losses = [max(values[i - 1] - values[i], 0) for i in range(1, len(values))]
    avg_g = sum(gains[:n]) / n
    avg_l = sum(losses[:n]) / n
    for i in range(n, len(values)):
        if i > n:
            avg_g = (avg_g * (n - 1) + gains[i - 1]) / n
            avg_l = (avg_l * (n - 1) + losses[i - 1]) / n
        out[i] = 100.0 if avg_l == 0 else 100 - 100 / (1 + avg_g / avg_l)
    return out


def macd(values: list[float], fast: int = 12, slow: int = 26, signal: int = 9):
    ef, es = ema(values, fast), ema(values, slow)
    line = [(a - b) if a is not None and b is not None else None for a, b in zip(ef, es)]
    valid = [v for v in line if v is not None]
    sig_valid = ema(valid, signal) if valid else []
    pad = len(line) - len(valid)
    sig = [None] * pad + sig_valid
    hist = [(a - b) if a is not None and b is not None else None for a, b in zip(line, sig)]
    return line, sig, hist


def atr(highs: list[float], lows: list[float], closes: list[float], n: int = 14) -> float | None:
    if len(closes) <= n:
        return None
    trs = [
        max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1]))
        for i in range(1, len(closes))
    ]
    return mean(trs[-n:])


def _ret(closes: list[float], n: int) -> float | None:
    if len(closes) <= n or closes[-n - 1] == 0:
        return None
    return closes[-1] / closes[-n - 1] - 1


def max_drawdown(closes: list[float]) -> float:
    peak = -math.inf
    mdd = 0.0
    for c in closes:
        peak = max(peak, c)
        if peak > 0:
            mdd = min(mdd, c / peak - 1)
    return mdd


def compute_insights(symbol: str, bars: list[dict]) -> dict:
    """Return statistics and a list of plain-language signals."""
    bars = [b for b in bars if b.get("close") is not None]
    if len(bars) < 30:
        return {"symbol": symbol, "stats": {}, "signals": [], "score": 0, "bias": "insufficient data"}
    closes = [float(b["close"]) for b in bars]
    highs = [float(b["high"] if b.get("high") is not None else b["close"]) for b in bars]
    lows = [float(b["low"] if b.get("low") is not None else b["close"]) for b in bars]
    vols = [float(b.get("volume") or 0) for b in bars]
    last = closes[-1]

    s20, s50, s200 = sma(closes, 20)[-1], sma(closes, 50)[-1], sma(closes, 200)[-1]
    r = rsi(closes)[-1]
    m_line, m_sig, m_hist = macd(closes)
    rets = [closes[i] / closes[i - 1] - 1 for i in range(1, len(closes)) if closes[i - 1]]
    vol20 = pstdev(rets[-20:]) * math.sqrt(252) if len(rets) >= 20 else None
    vol252 = pstdev(rets[-252:]) * math.sqrt(252) if len(rets) >= 60 else None
    window = bars[-252:]
    hi52 = max(highs[-252:])
    lo52 = min(lows[-252:])
    pos52 = (last - lo52) / (hi52 - lo52) if hi52 > lo52 else None
    a = atr(highs, lows, closes)
    avg_vol = mean(vols[-21:-1]) if len(vols) > 21 else None
    vol_ratio = vols[-1] / avg_vol if avg_vol else None
    bb_mid = s20
    bb_sd = pstdev(closes[-20:]) if len(closes) >= 20 else None

    stats = {
        "last": last,
        "return_1d": _ret(closes, 1),
        "return_1w": _ret(closes, 5),
        "return_1m": _ret(closes, 21),
        "return_3m": _ret(closes, 63),
        "return_ytd": None,
        "return_1y": _ret(closes, 252),
        "sma20": s20,
        "sma50": s50,
        "sma200": s200,
        "rsi14": r,
        "macd": m_line[-1],
        "macd_signal": m_sig[-1],
        "macd_hist": m_hist[-1],
        "realized_vol_20d": vol20,
        "realized_vol_1y": vol252,
        "high_52w": hi52,
        "low_52w": lo52,
        "range_position_52w": pos52,
        "atr14": a,
        "volume_ratio": vol_ratio,
        "max_drawdown_1y": max_drawdown(closes[-252:]),
        "bollinger_upper": bb_mid + 2 * bb_sd if bb_mid and bb_sd else None,
        "bollinger_lower": bb_mid - 2 * bb_sd if bb_mid and bb_sd else None,
        "bars": len(window),
    }
    year = str(bars[-1]["date"])[:4]
    ytd_base = next((b["close"] for b in bars if str(b["date"])[:4] == year), None)
    if ytd_base:
        stats["return_ytd"] = last / float(ytd_base) - 1

    signals: list[dict] = []

    def add(kind: str, text: str, weight: int):
        signals.append({"type": kind, "text": text, "weight": weight})

    if s50 and s200:
        if s50 > s200 and last > s50:
            add("bullish", "Price above a rising trend stack (50D > 200D, price > 50D).", 2)
        elif s50 < s200 and last < s50:
            add("bearish", "Price below a falling trend stack (50D < 200D, price < 50D).", -2)
        prev50, prev200 = sma(closes[:-5], 50)[-1], sma(closes[:-5], 200)[-1]
        if prev50 and prev200:
            if prev50 <= prev200 < s200 < s50:
                add("bullish", "Golden cross: 50-day SMA crossed above the 200-day in the last week.", 2)
            if prev50 >= prev200 > s200 > s50:
                add("bearish", "Death cross: 50-day SMA crossed below the 200-day in the last week.", -2)
    if r is not None:
        if r >= 70:
            add("bearish", f"RSI(14) at {r:.0f} — overbought territory; pullback risk.", -1)
        elif r <= 30:
            add("bullish", f"RSI(14) at {r:.0f} — oversold; mean-reversion bounce possible.", 1)
        else:
            add("neutral", f"RSI(14) at {r:.0f} — momentum neutral.", 0)
    if m_hist[-1] is not None and len(m_hist) > 2 and m_hist[-2] is not None:
        if m_hist[-2] < 0 <= m_hist[-1]:
            add("bullish", "MACD crossed above its signal line.", 1)
        elif m_hist[-2] > 0 >= m_hist[-1]:
            add("bearish", "MACD crossed below its signal line.", -1)
    if pos52 is not None:
        if pos52 >= 0.95:
            add("bullish", "Trading within 5% of its 52-week high range — strong relative position.", 1)
        elif pos52 <= 0.05:
            add("bearish", "Trading near the bottom of its 52-week range.", -1)
    if vol20 and vol252:
        if vol20 > vol252 * 1.5:
            add("neutral", f"Short-term volatility elevated: 20D {vol20:.0%} vs 1Y {vol252:.0%}.", 0)
        elif vol20 < vol252 * 0.6:
            add("neutral", f"Volatility compressed: 20D {vol20:.0%} vs 1Y {vol252:.0%} — watch for a range break.", 0)
    if vol_ratio and vol_ratio > 2:
        add("neutral", f"Volume running {vol_ratio:.1f}x its 20-day average.", 0)
    if stats["bollinger_upper"] and last > stats["bollinger_upper"]:
        add("bearish", "Closed above the upper Bollinger Band (stretched).", -1)
    elif stats["bollinger_lower"] and last < stats["bollinger_lower"]:
        add("bullish", "Closed below the lower Bollinger Band (stretched to downside).", 1)

    score = sum(s["weight"] for s in signals)
    bias = "bullish" if score >= 2 else "bearish" if score <= -2 else "neutral"
    return {"symbol": symbol, "stats": stats, "signals": signals, "score": score, "bias": bias}


def correlation_matrix(series: dict[str, list[float]]) -> dict:
    """Pearson correlation of daily returns for aligned close series."""
    syms = list(series)
    rets = {}
    for s, closes in series.items():
        rets[s] = [closes[i] / closes[i - 1] - 1 for i in range(1, len(closes)) if closes[i - 1]]
    n = min((len(v) for v in rets.values()), default=0)
    matrix = []
    for a in syms:
        row = []
        for b in syms:
            x, y = rets[a][-n:], rets[b][-n:]
            if n < 5:
                row.append(None)
                continue
            mx, my = mean(x), mean(y)
            cov = sum((i - mx) * (j - my) for i, j in zip(x, y))
            sx = math.sqrt(sum((i - mx) ** 2 for i in x))
            sy = math.sqrt(sum((j - my) ** 2 for j in y))
            row.append(cov / (sx * sy) if sx and sy else None)
        matrix.append(row)
    return {"symbols": syms, "matrix": matrix, "observations": n}
