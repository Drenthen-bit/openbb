"""Deterministic synthetic market data used when live data is unavailable.

Everything produced here is fake. Every payload the terminal returns from this
module carries ``source="demo"`` so the UI can label it clearly. The generator
is deterministic per symbol and per minute, so every client connected to the
same server sees the same prices.
"""

from __future__ import annotations

import hashlib
import math
import random
import time
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache

# symbol: (name, sector, industry, exchange, reference price, annual vol, shares out (m))
UNIVERSE: dict[str, tuple[str, str, str, str, float, float, float]] = {
    "AAPL": ("Apple Inc.", "Technology", "Consumer Electronics", "NASDAQ", 228.0, 0.26, 15200),
    "MSFT": ("Microsoft Corporation", "Technology", "Software", "NASDAQ", 430.0, 0.24, 7430),
    "NVDA": ("NVIDIA Corporation", "Technology", "Semiconductors", "NASDAQ", 135.0, 0.48, 24500),
    "GOOGL": ("Alphabet Inc. Class A", "Communication Services", "Internet Content", "NASDAQ", 172.0, 0.28, 12200),
    "AMZN": ("Amazon.com, Inc.", "Consumer Cyclical", "Internet Retail", "NASDAQ", 195.0, 0.31, 10500),
    "META": ("Meta Platforms, Inc.", "Communication Services", "Internet Content", "NASDAQ", 560.0, 0.36, 2530),
    "TSLA": ("Tesla, Inc.", "Consumer Cyclical", "Auto Manufacturers", "NASDAQ", 250.0, 0.58, 3200),
    "AVGO": ("Broadcom Inc.", "Technology", "Semiconductors", "NASDAQ", 170.0, 0.40, 4650),
    "AMD": ("Advanced Micro Devices, Inc.", "Technology", "Semiconductors", "NASDAQ", 150.0, 0.50, 1620),
    "INTC": ("Intel Corporation", "Technology", "Semiconductors", "NASDAQ", 22.0, 0.45, 4300),
    "NFLX": ("Netflix, Inc.", "Communication Services", "Entertainment", "NASDAQ", 700.0, 0.38, 430),
    "ADBE": ("Adobe Inc.", "Technology", "Software", "NASDAQ", 510.0, 0.33, 445),
    "CRM": ("Salesforce, Inc.", "Technology", "Software", "NYSE", 290.0, 0.32, 960),
    "ORCL": ("Oracle Corporation", "Technology", "Software", "NYSE", 170.0, 0.30, 2770),
    "JPM": ("JPMorgan Chase & Co.", "Financial Services", "Banks", "NYSE", 220.0, 0.22, 2840),
    "BAC": ("Bank of America Corporation", "Financial Services", "Banks", "NYSE", 40.0, 0.26, 7800),
    "GS": ("The Goldman Sachs Group, Inc.", "Financial Services", "Capital Markets", "NYSE", 510.0, 0.27, 315),
    "MS": ("Morgan Stanley", "Financial Services", "Capital Markets", "NYSE", 105.0, 0.27, 1620),
    "V": ("Visa Inc.", "Financial Services", "Credit Services", "NYSE", 280.0, 0.19, 1960),
    "MA": ("Mastercard Incorporated", "Financial Services", "Credit Services", "NYSE", 500.0, 0.20, 925),
    "BRK.B": ("Berkshire Hathaway Inc. Class B", "Financial Services", "Insurance", "NYSE", 460.0, 0.16, 2160),
    "XOM": ("Exxon Mobil Corporation", "Energy", "Oil & Gas Integrated", "NYSE", 118.0, 0.24, 4400),
    "CVX": ("Chevron Corporation", "Energy", "Oil & Gas Integrated", "NYSE", 150.0, 0.24, 1800),
    "JNJ": ("Johnson & Johnson", "Healthcare", "Drug Manufacturers", "NYSE", 158.0, 0.16, 2400),
    "UNH": ("UnitedHealth Group Incorporated", "Healthcare", "Healthcare Plans", "NYSE", 580.0, 0.24, 920),
    "LLY": ("Eli Lilly and Company", "Healthcare", "Drug Manufacturers", "NYSE", 880.0, 0.32, 950),
    "PFE": ("Pfizer Inc.", "Healthcare", "Drug Manufacturers", "NYSE", 29.0, 0.22, 5660),
    "MRK": ("Merck & Co., Inc.", "Healthcare", "Drug Manufacturers", "NYSE", 110.0, 0.20, 2530),
    "WMT": ("Walmart Inc.", "Consumer Defensive", "Discount Stores", "NYSE", 80.0, 0.17, 8040),
    "PG": ("The Procter & Gamble Company", "Consumer Defensive", "Household Products", "NYSE", 170.0, 0.15, 2350),
    "KO": ("The Coca-Cola Company", "Consumer Defensive", "Beverages", "NYSE", 70.0, 0.14, 4310),
    "PEP": ("PepsiCo, Inc.", "Consumer Defensive", "Beverages", "NASDAQ", 170.0, 0.15, 1370),
    "COST": ("Costco Wholesale Corporation", "Consumer Defensive", "Discount Stores", "NASDAQ", 880.0, 0.20, 443),
    "HD": ("The Home Depot, Inc.", "Consumer Cyclical", "Home Improvement", "NYSE", 390.0, 0.21, 990),
    "MCD": ("McDonald's Corporation", "Consumer Cyclical", "Restaurants", "NYSE", 290.0, 0.16, 717),
    "NKE": ("NIKE, Inc.", "Consumer Cyclical", "Footwear", "NYSE", 80.0, 0.30, 1500),
    "DIS": ("The Walt Disney Company", "Communication Services", "Entertainment", "NYSE", 95.0, 0.27, 1810),
    "BA": ("The Boeing Company", "Industrials", "Aerospace & Defense", "NYSE", 160.0, 0.34, 615),
    "CAT": ("Caterpillar Inc.", "Industrials", "Farm & Heavy Machinery", "NYSE", 370.0, 0.27, 485),
    "GE": ("GE Aerospace", "Industrials", "Aerospace & Defense", "NYSE", 180.0, 0.29, 1090),
    "UPS": ("United Parcel Service, Inc.", "Industrials", "Integrated Freight", "NYSE", 130.0, 0.25, 855),
    "LIN": ("Linde plc", "Basic Materials", "Specialty Chemicals", "NASDAQ", 460.0, 0.17, 478),
    "NEE": ("NextEra Energy, Inc.", "Utilities", "Utilities Regulated", "NYSE", 78.0, 0.24, 2050),
    "PLD": ("Prologis, Inc.", "Real Estate", "REIT Industrial", "NYSE", 120.0, 0.27, 926),
    "SPY": ("SPDR S&P 500 ETF Trust", "ETF", "Large Blend", "NYSEARCA", 570.0, 0.15, 960),
    "QQQ": ("Invesco QQQ Trust", "ETF", "Large Growth", "NASDAQ", 490.0, 0.19, 580),
    "IWM": ("iShares Russell 2000 ETF", "ETF", "Small Blend", "NYSEARCA", 220.0, 0.22, 330),
    "DIA": ("SPDR Dow Jones Industrial Average ETF", "ETF", "Large Value", "NYSEARCA", 420.0, 0.14, 120),
    "TLT": ("iShares 20+ Year Treasury Bond ETF", "ETF", "Long Government", "NASDAQ", 95.0, 0.16, 590),
    "GLD": ("SPDR Gold Shares", "ETF", "Commodities Focused", "NYSEARCA", 245.0, 0.14, 300),
    "XLE": ("Energy Select Sector SPDR Fund", "ETF", "Equity Energy", "NYSEARCA", 92.0, 0.23, 400),
    "XLF": ("Financial Select Sector SPDR Fund", "ETF", "Financial", "NYSEARCA", 46.0, 0.19, 900),
    "XLK": ("Technology Select Sector SPDR Fund", "ETF", "Technology", "NYSEARCA", 230.0, 0.21, 300),
}

INDICES: dict[str, tuple[str, str, float, float]] = {
    # symbol: (name, region, level, vol)
    "SPX": ("S&P 500 Index", "Americas", 5800.0, 0.15),
    "NDX": ("Nasdaq 100 Index", "Americas", 20500.0, 0.19),
    "DJI": ("Dow Jones Industrial Average", "Americas", 42500.0, 0.14),
    "RUT": ("Russell 2000 Index", "Americas", 2250.0, 0.22),
    "VIX": ("Cboe Volatility Index", "Americas", 16.5, 0.85),
    "TSX": ("S&P/TSX Composite", "Americas", 24300.0, 0.12),
    "BVSP": ("Ibovespa", "Americas", 129000.0, 0.20),
    "UKX": ("FTSE 100", "EMEA", 8250.0, 0.13),
    "DAX": ("DAX 40", "EMEA", 19200.0, 0.16),
    "CAC": ("CAC 40", "EMEA", 7400.0, 0.16),
    "SX5E": ("Euro Stoxx 50", "EMEA", 4900.0, 0.16),
    "SMI": ("Swiss Market Index", "EMEA", 12100.0, 0.12),
    "AEX": ("AEX Index", "EMEA", 890.0, 0.15),
    "NKY": ("Nikkei 225", "APAC", 38500.0, 0.20),
    "HSI": ("Hang Seng Index", "APAC", 20100.0, 0.25),
    "SHCOMP": ("Shanghai Composite", "APAC", 3300.0, 0.20),
    "AS51": ("S&P/ASX 200", "APAC", 8200.0, 0.12),
    "KOSPI": ("KOSPI Composite", "APAC", 2600.0, 0.18),
    "SENSEX": ("BSE Sensex", "APAC", 80000.0, 0.14),
}

FX: dict[str, tuple[str, float, float]] = {
    "EURUSD": ("Euro / US Dollar", 1.08, 0.07),
    "GBPUSD": ("British Pound / US Dollar", 1.28, 0.08),
    "USDJPY": ("US Dollar / Japanese Yen", 150.0, 0.10),
    "USDCHF": ("US Dollar / Swiss Franc", 0.88, 0.08),
    "AUDUSD": ("Australian Dollar / US Dollar", 0.66, 0.10),
    "USDCAD": ("US Dollar / Canadian Dollar", 1.38, 0.06),
    "NZDUSD": ("New Zealand Dollar / US Dollar", 0.60, 0.10),
    "USDCNH": ("US Dollar / Chinese Yuan (Offshore)", 7.15, 0.04),
    "USDMXN": ("US Dollar / Mexican Peso", 19.8, 0.14),
    "EURGBP": ("Euro / British Pound", 0.845, 0.06),
}

CRYPTO: dict[str, tuple[str, float, float]] = {
    "BTCUSD": ("Bitcoin", 92000.0, 0.55),
    "ETHUSD": ("Ethereum", 3300.0, 0.70),
    "SOLUSD": ("Solana", 230.0, 0.90),
    "XRPUSD": ("XRP", 1.1, 0.90),
    "ADAUSD": ("Cardano", 0.75, 0.95),
    "DOGEUSD": ("Dogecoin", 0.38, 1.10),
}

COMMODITIES: dict[str, tuple[str, str, float, float]] = {
    "CL": ("WTI Crude Oil", "USD/bbl", 70.0, 0.35),
    "BZ": ("Brent Crude Oil", "USD/bbl", 74.0, 0.33),
    "NG": ("Natural Gas", "USD/MMBtu", 3.1, 0.60),
    "GC": ("Gold", "USD/oz", 2650.0, 0.15),
    "SI": ("Silver", "USD/oz", 31.0, 0.28),
    "HG": ("Copper", "USD/lb", 4.1, 0.24),
    "ZC": ("Corn", "USc/bu", 430.0, 0.25),
    "ZW": ("Wheat", "USc/bu", 560.0, 0.30),
    "ZS": ("Soybeans", "USc/bu", 990.0, 0.20),
}


def _seed(*parts: object) -> int:
    digest = hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()
    return int(digest[:16], 16)


def _spec(symbol: str) -> tuple[str, float, float]:
    """Return (name, reference price, annualized vol) for any symbol."""
    s = symbol.upper().lstrip("^").replace("-", "").replace("/", "")
    if s in UNIVERSE:
        u = UNIVERSE[s]
        return u[0], u[4], u[5]
    if s in INDICES:
        i = INDICES[s]
        return i[0], i[2], i[3]
    if s in FX:
        return FX[s]
    if s in CRYPTO:
        return CRYPTO[s]
    if s in COMMODITIES:
        c = COMMODITIES[s]
        return c[0], c[2], c[3]
    rng = random.Random(_seed("spec", s))
    return f"{s} (demo)", round(rng.uniform(8, 400), 2), rng.uniform(0.2, 0.6)


def is_known(symbol: str) -> bool:
    s = symbol.upper().lstrip("^").replace("-", "").replace("/", "")
    return any(s in m for m in (UNIVERSE, INDICES, FX, CRYPTO, COMMODITIES))


@lru_cache(maxsize=8)
def _market_shocks(days: int) -> list[float]:
    rng = random.Random(_seed("market-factor", days))
    return [rng.gauss(0, 1) for _ in range(days)]


@lru_cache(maxsize=4096)
def _daily_path(symbol: str, end: date, days: int = 1300) -> list[dict]:
    """Daily OHLCV bars for ``days`` business days ending before ``end``.

    The path is anchored so the most recent close lands near the reference price.
    """
    name, ref, vol = _spec(symbol)
    rng = random.Random(_seed("daily", symbol))
    dt = 1 / 252
    drift = rng.uniform(-0.02, 0.18)
    rets = []
    regime = 1.0
    # A shared market factor makes demo assets co-move like real ones do.
    market = _market_shocks(days)
    s = symbol.upper()
    rho = 0.25 if s in FX else 0.35 if s in CRYPTO or s in COMMODITIES else -0.7 if s == "VIX" else 0.92 if s in INDICES or s in ("SPY", "QQQ", "DIA", "IWM") else rng.uniform(0.45, 0.75)
    for i in range(days):
        if rng.random() < 0.02:
            regime = rng.choice([0.7, 1.0, 1.0, 1.4, 1.9])
        shock = rho * market[i] + math.sqrt(1 - rho * rho) * rng.gauss(0, 1)
        if rng.random() < 0.01:
            shock *= 3.5
        rets.append((drift - 0.5 * vol * vol) * dt + vol * regime * math.sqrt(dt) * shock)
    cumulative = sum(rets)
    start_price = ref / math.exp(cumulative)
    bars = []
    d = end - timedelta(days=1)
    dates: list[date] = []
    while len(dates) < days:
        if d.weekday() < 5:
            dates.append(d)
        d -= timedelta(days=1)
    dates.reverse()
    price = start_price
    base_volume = UNIVERSE.get(symbol, (None, None, None, None, None, None, 500.0))[6] * 1e6 * 0.006
    for day, r in zip(dates, rets):
        open_ = price * math.exp(rng.gauss(0, vol * 0.15 * math.sqrt(dt)))
        close = price * math.exp(r)
        span = abs(math.log(close / open_)) + abs(rng.gauss(0, vol * 0.6 * math.sqrt(dt)))
        high = max(open_, close) * math.exp(span * rng.uniform(0.2, 0.7))
        low = min(open_, close) * math.exp(-span * rng.uniform(0.2, 0.7))
        volume = int(base_volume * math.exp(rng.gauss(0, 0.35)) * (1 + 8 * abs(r)))
        bars.append(
            {
                "date": day.isoformat(),
                "open": round(open_, 4),
                "high": round(high, 4),
                "low": round(low, 4),
                "close": round(close, 4),
                "volume": volume,
            }
        )
        price = close
    return bars


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _minute_of_day(now: float | None = None) -> int:
    now = time.time() if now is None else now
    dt = datetime.fromtimestamp(now, timezone.utc)
    return dt.hour * 60 + dt.minute


@lru_cache(maxsize=2048)
def _intraday_path(symbol: str, day: date) -> list[float]:
    """1,440 one-minute closes for the given UTC day (continuous demo session)."""
    _, _, vol = _spec(symbol)
    prev = _daily_path(symbol, day)[-1]["close"]
    rng = random.Random(_seed("intraday", symbol, day.isoformat()))
    step = vol * math.sqrt(1 / (252 * 1440)) * 1.6
    prices = []
    p = prev * math.exp(rng.gauss(0, vol * 0.1 * math.sqrt(1 / 252)))
    for _ in range(1440):
        p *= math.exp(rng.gauss(0, step))
        prices.append(p)
    return prices


def _live_price(symbol: str, now: float | None = None) -> float:
    now = time.time() if now is None else now
    day = datetime.fromtimestamp(now, timezone.utc).date()
    path = _intraday_path(symbol, day)
    m = _minute_of_day(now)
    base = path[m]
    nxt = path[min(m + 1, 1439)]
    frac = (now % 60) / 60
    _, _, vol = _spec(symbol)
    jitter = random.Random(_seed("tick", symbol, int(now))).gauss(0, vol * 0.00004)
    return (base + (nxt - base) * frac) * (1 + jitter)


def quote(symbol: str) -> dict:
    symbol = symbol.upper()
    name, _, _ = _spec(symbol)
    now = time.time()
    day = _today()
    hist = _daily_path(symbol, day)
    prev_close = hist[-1]["close"]
    path = _intraday_path(symbol, day)[: _minute_of_day(now) + 1]
    last = _live_price(symbol, now)
    high = max(max(path), last)
    low = min(min(path), last)
    year = hist[-252:]
    spread = max(last * 0.0002, 0.01)
    rng = random.Random(_seed("q", symbol, int(now)))
    meta = UNIVERSE.get(symbol)
    volume = int(sum(b["volume"] for b in hist[-20:]) / 20 * (len(path) / 1440))
    mcap = meta[6] * 1e6 * last if meta and meta[1] != "ETF" else None
    return {
        "symbol": symbol,
        "name": name,
        "exchange": meta[3] if meta else None,
        "last": round(last, 4),
        "bid": round(last - spread / 2, 4),
        "ask": round(last + spread / 2, 4),
        "bid_size": rng.randint(1, 30) * 100,
        "ask_size": rng.randint(1, 30) * 100,
        "open": round(path[0], 4),
        "high": round(high, 4),
        "low": round(low, 4),
        "prev_close": prev_close,
        "change": round(last - prev_close, 4),
        "change_percent": (last - prev_close) / prev_close,
        "volume": volume,
        "year_high": max(b["high"] for b in year),
        "year_low": min(b["low"] for b in year),
        "market_cap": mcap,
        "currency": "USD",
        "timestamp": datetime.fromtimestamp(now, timezone.utc).isoformat(),
    }


def history(symbol: str, interval: str = "1d", start: str | None = None, end: str | None = None) -> list[dict]:
    symbol = symbol.upper()
    day = _today()
    if interval in ("1m", "5m", "15m", "30m", "1h"):
        step = {"1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60}[interval]
        bars = []
        now = time.time()
        # include the previous four days of intraday data
        for back in range(4, -1, -1):
            d = day - timedelta(days=back)
            path = _intraday_path(symbol, d)
            limit = _minute_of_day(now) + 1 if back == 0 else 1440
            base = datetime(d.year, d.month, d.day, tzinfo=timezone.utc)
            for i in range(0, limit, step):
                chunk = path[i : min(i + step, limit)]
                if not chunk:
                    continue
                prev = path[i - 1] if i > 0 else chunk[0]
                bars.append(
                    {
                        "date": (base + timedelta(minutes=i)).isoformat(),
                        "open": round(prev, 4),
                        "high": round(max(chunk + [prev]), 4),
                        "low": round(min(chunk + [prev]), 4),
                        "close": round(chunk[-1], 4),
                        "volume": int(abs(random.Random(_seed("v", symbol, d, i)).gauss(1, 0.4)) * 20000 * step),
                    }
                )
        return bars
    bars = list(_daily_path(symbol, day))
    q = quote(symbol)
    bars.append(
        {
            "date": day.isoformat(),
            "open": q["open"],
            "high": q["high"],
            "low": q["low"],
            "close": q["last"],
            "volume": q["volume"],
        }
    )
    if start:
        bars = [b for b in bars if b["date"] >= start]
    if end:
        bars = [b for b in bars if b["date"] <= end]
    if interval in ("1W", "1w", "1wk"):
        return _resample(bars, lambda d: date.fromisoformat(d).isocalendar()[:2])
    if interval in ("1M", "1mo"):
        return _resample(bars, lambda d: d[:7])
    return bars


def _resample(bars: list[dict], key) -> list[dict]:
    out: list[dict] = []
    current = None
    for b in bars:
        k = key(b["date"])
        if current is None or current[0] != k:
            current = (k, dict(b))
            out.append(current[1])
        else:
            agg = current[1]
            agg["high"] = max(agg["high"], b["high"])
            agg["low"] = min(agg["low"], b["low"])
            agg["close"] = b["close"]
            agg["volume"] += b["volume"]
    return out


def profile(symbol: str) -> dict:
    symbol = symbol.upper()
    meta = UNIVERSE.get(symbol)
    name, _, _ = _spec(symbol)
    rng = random.Random(_seed("profile", symbol))
    sector = meta[1] if meta else "Unknown"
    industry = meta[2] if meta else "Unknown"
    q = quote(symbol)
    return {
        "symbol": symbol,
        "name": name,
        "sector": sector,
        "industry": industry,
        "exchange": meta[3] if meta else None,
        "ceo": None,
        "employees": rng.randint(2, 300) * 1000 if sector != "ETF" else None,
        "hq_country": "United States",
        "website": None,
        "market_cap": q["market_cap"],
        "shares_outstanding": meta[6] * 1e6 if meta else None,
        "beta": round(rng.uniform(0.5, 1.8), 2),
        "pe_ratio": round(rng.uniform(9, 60), 1) if sector != "ETF" else None,
        "dividend_yield": round(rng.uniform(0, 0.04), 4),
        "description": (
            f"[DEMO DATA] {name} is shown with synthetic data generated by the terminal's offline "
            f"demo engine. It is classified under {sector} / {industry}. Connect the server to the "
            "internet (live mode) to see the real company description from OpenBB providers."
        ),
    }


def fundamentals(symbol: str, statement: str = "income", period: str = "annual", limit: int = 5) -> list[dict]:
    symbol = symbol.upper()
    meta = UNIVERSE.get(symbol)
    rng = random.Random(_seed("fund", symbol, statement, period))
    shares = (meta[6] if meta else 500) * 1e6
    price = _spec(symbol)[1]
    revenue = price * shares * rng.uniform(0.08, 0.6) * (0.25 if period == "quarter" else 1)
    margin = rng.uniform(0.08, 0.35)
    growth = rng.uniform(-0.02, 0.15)
    gross_margin = rng.uniform(0.35, 0.7)
    today = _today()
    rows = []
    for i in range(limit):
        if period == "quarter":
            end = date(today.year, ((today.month - 1) // 3) * 3 + 1, 1) - timedelta(days=1 + 91 * i)
        else:
            end = date(today.year - 1 - i, 12, 31)
        rev = revenue / ((1 + growth / (4 if period == "quarter" else 1)) ** i) * rng.uniform(0.97, 1.03)
        gross = rev * gross_margin * rng.uniform(0.98, 1.02)
        op = rev * margin * rng.uniform(0.9, 1.1)
        net = op * rng.uniform(0.72, 0.85)
        if statement == "income":
            rows.append(
                {
                    "period_ending": end.isoformat(),
                    "fiscal_period": "FY" if period == "annual" else f"Q{(end.month - 1) // 3 + 1}",
                    "revenue": round(rev),
                    "cost_of_revenue": round(rev - gross),
                    "gross_profit": round(gross),
                    "operating_expenses": round(gross - op),
                    "operating_income": round(op),
                    "interest_expense": round(rev * 0.01),
                    "pretax_income": round(net / 0.82),
                    "income_tax": round(net / 0.82 - net),
                    "net_income": round(net),
                    "eps_diluted": round(net / shares, 2),
                    "ebitda": round(op * 1.18),
                }
            )
        elif statement == "balance":
            assets = rev * rng.uniform(1.0, 2.2)
            liab = assets * rng.uniform(0.35, 0.7)
            rows.append(
                {
                    "period_ending": end.isoformat(),
                    "cash_and_equivalents": round(assets * 0.12),
                    "short_term_investments": round(assets * 0.06),
                    "accounts_receivable": round(assets * 0.09),
                    "inventory": round(assets * 0.05),
                    "total_current_assets": round(assets * 0.36),
                    "property_plant_equipment": round(assets * 0.28),
                    "goodwill_and_intangibles": round(assets * 0.18),
                    "total_assets": round(assets),
                    "total_current_liabilities": round(liab * 0.4),
                    "long_term_debt": round(liab * 0.45),
                    "total_liabilities": round(liab),
                    "total_equity": round(assets - liab),
                }
            )
        else:
            ocf = net * rng.uniform(1.05, 1.4)
            capex = -rev * rng.uniform(0.03, 0.12)
            rows.append(
                {
                    "period_ending": end.isoformat(),
                    "net_income": round(net),
                    "depreciation_amortization": round(op * 0.18),
                    "stock_based_compensation": round(rev * 0.02),
                    "operating_cash_flow": round(ocf),
                    "capital_expenditure": round(capex),
                    "free_cash_flow": round(ocf + capex),
                    "acquisitions": round(-rev * rng.uniform(0, 0.03)),
                    "investing_cash_flow": round(capex * 1.3),
                    "dividends_paid": round(-net * rng.uniform(0, 0.4)),
                    "share_repurchases": round(-net * rng.uniform(0, 0.5)),
                    "financing_cash_flow": round(-net * rng.uniform(0.3, 0.9)),
                }
            )
    return rows


_HEADLINE_TEMPLATES = [
    "{name} shares {move} as investors weigh {topic}",
    "Analysts {verb} {name} price target ahead of {event}",
    "{name} announces {corp} — [demo headline]",
    "Options traders pile into {sym} {side} as volatility {volmove}",
    "{sector} stocks {move} led by {name}",
    "{name} management to present at upcoming {conf} conference",
    "Report: {name} explores {corp}",
    "{sym} sees unusual volume; {name} {move}",
]


def news(symbols: list[str] | None = None, limit: int = 30) -> list[dict]:
    pool = [s.upper() for s in symbols] if symbols else list(UNIVERSE)
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    out = []
    for i in range(limit):
        slot = now - timedelta(minutes=17 * i)
        rng = random.Random(_seed("news", ",".join(pool), slot.isoformat()))
        sym = rng.choice(pool)
        meta = UNIVERSE.get(sym)
        name = _spec(sym)[0]
        q_change = quote(sym)["change_percent"] if i < 5 else rng.uniform(-0.03, 0.03)
        title = rng.choice(_HEADLINE_TEMPLATES).format(
            name=name,
            sym=sym,
            move="rise" if q_change >= 0 else "slip",
            topic=rng.choice(["rate outlook", "earnings guidance", "AI spending", "tariff headlines", "consumer demand"]),
            verb=rng.choice(["raise", "trim", "reiterate"]),
            event=rng.choice(["earnings", "investor day", "product launch"]),
            corp=rng.choice(["share buyback", "strategic review", "new product line", "dividend increase", "acquisition"]),
            side=rng.choice(["calls", "puts"]),
            volmove=rng.choice(["climbs", "eases"]),
            sector=meta[1] if meta else "Market",
            conf=rng.choice(["technology", "healthcare", "financials", "industrials"]),
        )
        out.append(
            {
                "date": slot.isoformat(),
                "title": title,
                "symbols": sym,
                "source": "DEMO WIRE",
                "url": None,
                "excerpt": "Synthetic headline generated by the offline demo engine. Not real news.",
            }
        )
    return out


def _norm_cdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def _bs(s: float, k: float, t: float, r: float, iv: float, kind: str) -> tuple[float, float, float, float, float]:
    if t <= 0 or iv <= 0:
        intrinsic = max(0.0, s - k) if kind == "call" else max(0.0, k - s)
        return intrinsic, (1.0 if kind == "call" and s > k else 0.0), 0.0, 0.0, 0.0
    d1 = (math.log(s / k) + (r + iv * iv / 2) * t) / (iv * math.sqrt(t))
    d2 = d1 - iv * math.sqrt(t)
    pdf = math.exp(-d1 * d1 / 2) / math.sqrt(2 * math.pi)
    if kind == "call":
        price = s * _norm_cdf(d1) - k * math.exp(-r * t) * _norm_cdf(d2)
        delta = _norm_cdf(d1)
        theta = (-s * pdf * iv / (2 * math.sqrt(t)) - r * k * math.exp(-r * t) * _norm_cdf(d2)) / 365
    else:
        price = k * math.exp(-r * t) * _norm_cdf(-d2) - s * _norm_cdf(-d1)
        delta = _norm_cdf(d1) - 1
        theta = (-s * pdf * iv / (2 * math.sqrt(t)) + r * k * math.exp(-r * t) * _norm_cdf(-d2)) / 365
    gamma = pdf / (s * iv * math.sqrt(t))
    vega = s * pdf * math.sqrt(t) / 100
    return price, delta, gamma, theta, vega


def options_chain(symbol: str) -> list[dict]:
    symbol = symbol.upper()
    q = quote(symbol)
    s = q["last"]
    _, _, vol = _spec(symbol)
    today = _today()
    expiries = []
    d = today
    while len(expiries) < 4:
        d += timedelta(days=1)
        if d.weekday() == 4:
            expiries.append(d)
    for months in (1, 2, 3, 6, 9, 12):
        m = (today.month - 1 + months) % 12 + 1
        y = today.year + (today.month - 1 + months) // 12
        third = date(y, m, 15)
        while third.weekday() != 4:
            third += timedelta(days=1)
        if third not in expiries and third > today:
            expiries.append(third)
    expiries.sort()
    inc = 1 if s < 50 else 2.5 if s < 150 else 5 if s < 500 else 10 if s < 1500 else 50
    atm = round(s / inc) * inc
    strikes = [atm + inc * i for i in range(-15, 16) if atm + inc * i > 0]
    rows = []
    for exp in expiries:
        t = max((exp - today).days, 0.5) / 365
        for k in strikes:
            m = math.log(k / s)
            iv = vol * (1 + 0.9 * m * m / max(t, 0.05) ** 0.5 - 0.25 * m) * (1 + 0.1 / (1 + 10 * t))
            for kind in ("call", "put"):
                price, delta, gamma, theta, vega = _bs(s, k, t, 0.043, iv, kind)
                rng = random.Random(_seed("opt", symbol, exp, k, kind, today))
                spread = max(0.01, price * 0.03)
                oi = int(abs(rng.gauss(0, 1)) * 4000 * math.exp(-abs(m) * 6))
                rows.append(
                    {
                        "contract_symbol": f"{symbol}{exp:%y%m%d}{kind[0].upper()}{int(k * 1000):08d}",
                        "expiration": exp.isoformat(),
                        "dte": (exp - today).days,
                        "strike": k,
                        "option_type": kind,
                        "bid": round(max(price - spread / 2, 0), 2),
                        "ask": round(price + spread / 2, 2),
                        "last_trade_price": round(price, 2),
                        "mark": round(price, 2),
                        "volume": int(oi * rng.uniform(0.02, 0.4)),
                        "open_interest": oi,
                        "implied_volatility": round(iv, 4),
                        "delta": round(delta, 4),
                        "gamma": round(gamma, 5),
                        "theta": round(theta, 4),
                        "vega": round(vega, 4),
                        "underlying_price": round(s, 2),
                    }
                )
    return rows


_MATURITIES = [
    ("month_1", 1 / 12), ("month_3", 0.25), ("month_6", 0.5), ("year_1", 1), ("year_2", 2),
    ("year_3", 3), ("year_5", 5), ("year_7", 7), ("year_10", 10), ("year_20", 20), ("year_30", 30),
]


def yield_curve(day: date | None = None) -> list[dict]:
    day = day or _today()
    rng = random.Random(_seed("yc", day.isoformat()))
    b0 = 4.25 + rng.gauss(0, 0.05)
    b1 = 0.2 + rng.gauss(0, 0.05)
    b2 = -0.9 + rng.gauss(0, 0.05)
    tau = 2.0
    out = []
    for label, t in _MATURITIES:
        f = (1 - math.exp(-t / tau)) / (t / tau)
        rate = b0 + b1 * f + b2 * (f - math.exp(-t / tau))
        out.append({"date": day.isoformat(), "maturity": label, "years": t, "rate": round(rate / 100, 5)})
    return out


_ECON_EVENTS = [
    ("US", "Nonfarm Payrolls", "K", 180, 40, "High"),
    ("US", "CPI YoY", "%", 2.7, 0.2, "High"),
    ("US", "Core PCE MoM", "%", 0.2, 0.1, "High"),
    ("US", "Initial Jobless Claims", "K", 220, 12, "Medium"),
    ("US", "ISM Manufacturing PMI", "", 48.5, 1.2, "High"),
    ("US", "Retail Sales MoM", "%", 0.3, 0.3, "Medium"),
    ("US", "FOMC Rate Decision", "%", 4.5, 0.0, "High"),
    ("EU", "ECB Deposit Rate", "%", 3.25, 0.0, "High"),
    ("EU", "HICP Flash YoY", "%", 2.2, 0.2, "High"),
    ("DE", "Ifo Business Climate", "", 86.0, 1.0, "Medium"),
    ("GB", "CPI YoY", "%", 2.3, 0.2, "High"),
    ("JP", "BoJ Policy Rate", "%", 0.25, 0.0, "High"),
    ("CN", "Caixin Manufacturing PMI", "", 50.3, 0.6, "Medium"),
    ("CA", "Employment Change", "K", 25, 15, "Medium"),
    ("AU", "RBA Cash Rate", "%", 4.35, 0.0, "High"),
]


def economic_calendar(start: date | None = None, days: int = 14) -> list[dict]:
    start = start or (_today() - timedelta(days=3))
    out = []
    for i in range(days):
        d = start + timedelta(days=i)
        if d.weekday() >= 5:
            continue
        rng = random.Random(_seed("eco", d.isoformat()))
        for country, event, unit, base, noise, importance in rng.sample(_ECON_EVENTS, 3):
            consensus = round(base + rng.gauss(0, noise), 2)
            previous = round(base + rng.gauss(0, noise), 2)
            actual = round(consensus + rng.gauss(0, noise * 0.8), 2) if d <= _today() else None
            hour = rng.choice([8, 10, 14]) if country == "US" else rng.choice([1, 2, 7, 9])
            out.append(
                {
                    "date": datetime(d.year, d.month, d.day, hour, 30, tzinfo=timezone.utc).isoformat(),
                    "country": country,
                    "event": event,
                    "importance": importance,
                    "unit": unit,
                    "consensus": consensus,
                    "previous": previous,
                    "actual": actual,
                }
            )
    return sorted(out, key=lambda r: r["date"])


def earnings_calendar(start: date | None = None, days: int = 14) -> list[dict]:
    start = start or _today()
    out = []
    for sym, meta in UNIVERSE.items():
        if meta[1] == "ETF":
            continue
        rng = random.Random(_seed("earn", sym, start.isocalendar()[1]))
        offset = rng.randint(0, 60)
        if offset >= days:
            continue
        d = start + timedelta(days=offset)
        if d.weekday() >= 5:
            d += timedelta(days=7 - d.weekday())
        eps = fundamentals(sym, "income", "quarter", 1)[0]["eps_diluted"]
        out.append(
            {
                "report_date": d.isoformat(),
                "symbol": sym,
                "name": meta[0],
                "eps_consensus": round(eps * rng.uniform(0.95, 1.1), 2),
                "eps_previous": eps,
                "time": rng.choice(["BMO", "AMC"]),
            }
        )
    return sorted(out, key=lambda r: r["report_date"])


def index_snapshots() -> list[dict]:
    out = []
    for sym, (name, region, _, _) in INDICES.items():
        q = quote(sym)
        out.append(
            {
                "symbol": sym,
                "name": name,
                "region": region,
                "price": q["last"],
                "change": q["change"],
                "change_percent": q["change_percent"],
                "high": q["high"],
                "low": q["low"],
                "prev_close": q["prev_close"],
            }
        )
    return out


def _snap(table: dict, kind: str) -> list[dict]:
    out = []
    for sym, spec in table.items():
        q = quote(sym)
        out.append(
            {
                "symbol": sym,
                "name": spec[0],
                "kind": kind,
                "unit": spec[1] if kind == "commodity" else None,
                "price": q["last"],
                "change": q["change"],
                "change_percent": q["change_percent"],
                "high": q["high"],
                "low": q["low"],
            }
        )
    return out


def fx_snapshots() -> list[dict]:
    return _snap(FX, "fx")


def crypto_snapshots() -> list[dict]:
    return _snap(CRYPTO, "crypto")


def commodity_snapshots() -> list[dict]:
    return _snap(COMMODITIES, "commodity")


def movers() -> dict[str, list[dict]]:
    rows = []
    for sym, meta in UNIVERSE.items():
        if meta[1] == "ETF":
            continue
        q = quote(sym)
        rows.append(
            {
                "symbol": sym,
                "name": meta[0],
                "price": q["last"],
                "change": q["change"],
                "change_percent": q["change_percent"],
                "volume": q["volume"],
            }
        )
    by_change = sorted(rows, key=lambda r: r["change_percent"], reverse=True)
    return {
        "gainers": by_change[:10],
        "losers": list(reversed(by_change[-10:])),
        "active": sorted(rows, key=lambda r: r["volume"] * r["price"], reverse=True)[:10],
    }


def sectors() -> list[dict]:
    agg: dict[str, list[float]] = {}
    for sym, meta in UNIVERSE.items():
        if meta[1] == "ETF":
            continue
        agg.setdefault(meta[1], []).append(quote(sym)["change_percent"])
    return sorted(
        ({"sector": k, "change_percent": sum(v) / len(v), "members": len(v)} for k, v in agg.items()),
        key=lambda r: r["change_percent"],
        reverse=True,
    )


def search(query: str, limit: int = 20) -> list[dict]:
    q = query.upper()
    out = []
    for table, kind in ((UNIVERSE, "equity"), (INDICES, "index"), (FX, "fx"), (CRYPTO, "crypto"), (COMMODITIES, "commodity")):
        for sym, spec in table.items():
            if q in sym or q.lower() in spec[0].lower():
                out.append({"symbol": sym, "name": spec[0], "kind": kind})
    out.sort(key=lambda r: (not r["symbol"].startswith(q), len(r["symbol"])))
    return out[:limit]


def filings(symbol: str, limit: int = 25) -> list[dict]:
    symbol = symbol.upper()
    rng = random.Random(_seed("filings", symbol))
    today = _today()
    out = []
    d = today
    forms = ["10-Q", "8-K", "4", "4", "8-K", "10-Q", "SC 13G/A", "4", "10-K", "DEF 14A", "8-K", "4"]
    for i in range(limit):
        d -= timedelta(days=rng.randint(2, 20))
        form = forms[i % len(forms)]
        out.append(
            {
                "filing_date": d.isoformat(),
                "report_type": form,
                "description": f"[DEMO] {form} filing",
                "url": None,
            }
        )
    return out


def insider_trading(symbol: str, limit: int = 20) -> list[dict]:
    symbol = symbol.upper()
    rng = random.Random(_seed("insider", symbol))
    today = _today()
    roles = ["Chief Executive Officer", "Chief Financial Officer", "Director", "EVP", "General Counsel"]
    names = ["A. Rivera", "J. Chen", "M. Okafor", "S. Patel", "L. Novak", "R. Haddad"]
    price = quote(symbol)["last"]
    out = []
    d = today
    for _ in range(limit):
        d -= timedelta(days=rng.randint(1, 25))
        shares = rng.randint(1, 80) * 500
        sale = rng.random() < 0.7
        px = price * rng.uniform(0.85, 1.05)
        out.append(
            {
                "transaction_date": d.isoformat(),
                "owner_name": f"{rng.choice(names)} (demo)",
                "owner_title": rng.choice(roles),
                "transaction_type": "Sale" if sale else "Purchase",
                "securities_transacted": shares,
                "transaction_price": round(px, 2),
                "value": round(shares * px, 2),
            }
        )
    return out
