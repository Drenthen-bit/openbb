"""Market data service.

Live data comes from the OpenBB Platform (``from openbb import obb``), trying a
chain of key-free providers per dataset. When live data cannot be reached the
service runs in *demo* mode and serves the synthetic generator in ``demo.py``.

The two sources are never mixed in one response: in live mode a failed request
is reported as an error, not silently filled with fake values. Every payload is
wrapped as ``{"source": "live"|"demo", "provider": ..., "data": ...}``.
"""

from __future__ import annotations

import asyncio
import logging
import math
import time
from datetime import date, datetime, timedelta
from typing import Any, Callable

from . import demo

log = logging.getLogger("odp_terminal.market")


class DataUnavailable(Exception):
    """Raised when no provider could serve a live request."""


# Provider preference per dataset; all are key-free unless noted.
PROVIDERS: dict[str, list[str]] = {
    "quote": ["cboe", "nasdaq", "tmx"],
    "history": ["cboe", "nasdaq", "tmx"],
    "index_history": ["cboe", "nasdaq", "tmx"],
    "profile": ["nasdaq", "tmx", "finra"],
    "news": ["nasdaq", "tmx"],
    "options": ["cboe", "nasdaq", "tmx"],
    "fundamentals": ["nasdaq", "sec", "tmx"],
    "yield_curve": ["federal_reserve", "fred"],
    "economic_calendar": ["nasdaq", "fred"],
    "earnings_calendar": ["nasdaq", "tmx"],
    "index_snapshots": ["cboe", "nasdaq", "tmx"],
    "search": ["sec", "nasdaq", "cboe"],
    "filings": ["sec", "nasdaq", "tmx"],
    "insider": ["sec", "nasdaq", "tmx"],
    "fx_history": ["tmx"],
    "crypto_history": ["nasdaq"],
}

# Index symbols understood by Cboe / Nasdaq for the world markets monitor.
WORLD_INDEX_SYMBOLS = ["SPX", "NDX", "DJI", "RUT", "VIX"]


def _num(v: Any) -> float | None:
    try:
        if v is None:
            return None
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else f
    except (TypeError, ValueError):
        return None


def _first(d: dict, *keys: str) -> Any:
    for k in keys:
        v = d.get(k)
        if v not in (None, ""):
            return v
    return None


def records(results: Any) -> list[dict]:
    """Convert OBBject results (list of models, one model, or columnar) to records."""
    if results is None:
        return []
    if isinstance(results, list):
        out = []
        for r in results:
            if hasattr(r, "model_dump"):
                out.append(r.model_dump(mode="json", exclude_none=True))
            elif isinstance(r, dict):
                out.append(r)
        return out
    d = results.model_dump(mode="json", exclude_none=True) if hasattr(results, "model_dump") else results
    if isinstance(d, dict):
        lists = {k: v for k, v in d.items() if isinstance(v, list)}
        if lists and len(lists) >= max(1, len(d) // 2):
            n = max(len(v) for v in lists.values())
            return [{k: (v[i] if i < len(v) else None) for k, v in lists.items()} for i in range(n)]
        return [d]
    return []


def normalize_quote(r: dict) -> dict:
    last = _num(_first(r, "last_price", "price", "last", "close", "mark"))
    prev = _num(_first(r, "prev_close", "previous_close"))
    change = _num(r.get("change"))
    if change is None and last is not None and prev:
        change = last - prev
    pct = _num(_first(r, "change_percent", "percent_change"))
    if pct is None and change is not None and prev:
        pct = change / prev
    return {
        "symbol": str(r.get("symbol", "")).upper(),
        "name": _first(r, "name", "security_name", "company_name"),
        "exchange": _first(r, "exchange", "listing_exchange"),
        "last": last,
        "bid": _num(r.get("bid")),
        "ask": _num(r.get("ask")),
        "bid_size": _num(r.get("bid_size")),
        "ask_size": _num(r.get("ask_size")),
        "open": _num(r.get("open")),
        "high": _num(r.get("high")),
        "low": _num(r.get("low")),
        "prev_close": prev,
        "change": change,
        "change_percent": pct,
        "volume": _num(r.get("volume")),
        "year_high": _num(_first(r, "year_high", "fifty_two_week_high")),
        "year_low": _num(_first(r, "year_low", "fifty_two_week_low")),
        "market_cap": _num(r.get("market_cap")),
        "currency": r.get("currency"),
        "timestamp": _first(r, "last_timestamp", "timestamp", "date") or datetime.now().isoformat(),
    }


def normalize_bar(r: dict) -> dict:
    return {
        "date": str(r.get("date")),
        "open": _num(r.get("open")),
        "high": _num(r.get("high")),
        "low": _num(r.get("low")),
        "close": _num(r.get("close")),
        "volume": _num(r.get("volume")) or 0,
    }


_MATURITY_YEARS = {"month": 1 / 12, "year": 1.0, "week": 1 / 52, "day": 1 / 365}


def maturity_years(label: str) -> float | None:
    try:
        unit, n = str(label).split("_")
        return float(n) * _MATURITY_YEARS[unit]
    except (ValueError, KeyError):
        return None


def asset_class(symbol: str) -> str:
    s = symbol.upper().lstrip("^")
    if s in demo.FX or (len(s) == 6 and s[3:] in ("USD", "EUR", "JPY", "GBP", "CHF", "CAD") and s[:3] not in ("BTC", "ETH", "SOL", "XRP", "ADA")):
        return "fx"
    if s in demo.CRYPTO or s.endswith("-USD") or s[:3] in ("BTC", "ETH", "SOL", "XRP", "ADA") or s.startswith("DOGE"):
        return "crypto"
    if symbol.startswith("^") or s in demo.INDICES:
        return "index"
    return "equity"


class TTLCache:
    def __init__(self):
        self._d: dict[str, tuple[float, Any]] = {}

    def get(self, key: str) -> Any:
        hit = self._d.get(key)
        if hit and hit[0] > time.time():
            return hit[1]
        return None

    def set(self, key: str, value: Any, ttl: float) -> None:
        if len(self._d) > 5000:
            now = time.time()
            self._d = {k: v for k, v in self._d.items() if v[0] > now}
        self._d[key] = (time.time() + ttl, value)


class MarketData:
    """Facade over OpenBB live data and the demo generator."""

    def __init__(self, mode: str = "auto", probe_timeout: float = 8.0):
        if mode not in ("auto", "live", "demo"):
            raise ValueError("mode must be auto, live or demo")
        self.requested_mode = mode
        self.live = mode == "live"
        self.probe_timeout = probe_timeout
        self.last_probe: float | None = None
        self.last_probe_error: str | None = None
        self.cache = TTLCache()
        self._obb = None
        self.openbb_error: str | None = None

    # ------------------------------------------------------------ openbb
    @property
    def obb(self):
        if self._obb is None:
            try:
                from openbb import obb  # noqa: PLC0415

                self._obb = obb
                self.openbb_error = None
            except Exception as exc:  # pragma: no cover - depends on install
                self.openbb_error = f"OpenBB Platform failed to import: {exc}"
                raise DataUnavailable(self.openbb_error) from exc
        return self._obb

    @property
    def source(self) -> str:
        return "live" if self.live else "demo"

    def openbb_available(self) -> bool:
        try:
            self.obb  # noqa: B018
            return True
        except DataUnavailable:
            return False

    def _call(self, path: str, providers: list[str] | None, **params) -> tuple[list[dict], str | None]:
        fn: Any = self.obb
        for part in path.split("."):
            fn = getattr(fn, part)
        errors = []
        for provider in providers or [None]:
            try:
                kwargs = {k: v for k, v in params.items() if v is not None}
                if provider:
                    kwargs["provider"] = provider
                out = fn(**kwargs)
                recs = records(out.results)
                if recs:
                    return recs, provider
                errors.append(f"{provider}: empty result")
            except Exception as exc:  # noqa: BLE001 - provider errors vary widely
                text = str(exc).strip()
                errors.append(f"{provider}: {text.splitlines()[0][:200] if text else exc.__class__.__name__}")
        raise DataUnavailable(f"{path} failed: " + " | ".join(errors))

    async def call(self, path: str, providers: list[str] | None = None, ttl: float = 60, **params):
        """Run an OpenBB command in a thread with caching."""
        key = f"{path}|{providers}|{sorted(params.items())}"
        hit = self.cache.get(key)
        if hit is not None:
            return hit
        result = await asyncio.to_thread(self._call, path, providers, **params)
        self.cache.set(key, result, ttl)
        return result

    # ------------------------------------------------------------ mode
    async def probe(self) -> bool:
        """Decide live vs demo (auto mode only)."""
        self.last_probe = time.time()
        if self.requested_mode == "demo":
            self.live = False
            return False
        if self.requested_mode == "live":
            self.live = True
            return True
        try:
            await asyncio.wait_for(
                asyncio.to_thread(self._call, "equity.price.quote", ["cboe", "nasdaq"], symbol="SPY"),
                timeout=self.probe_timeout,
            )
            self.live = True
            self.last_probe_error = None
        except Exception as exc:  # noqa: BLE001
            self.live = False
            self.last_probe_error = str(exc)[:300] or exc.__class__.__name__
        log.info("data mode resolved to %s", self.source)
        return self.live

    def wrap(self, data: Any, provider: str | None = None, **extra) -> dict:
        out = {"source": self.source, "provider": provider if self.live else "demo", "data": data}
        out.update(extra)
        return out

    async def _either(self, live: Callable, fake: Callable, **extra) -> dict:
        if not self.live:
            return self.wrap(fake(), **extra)
        data, provider = await live()
        return self.wrap(data, provider, **extra)

    # ------------------------------------------------------------ datasets
    async def quotes(self, symbols: list[str]) -> dict:
        symbols = [s.upper() for s in symbols if s.strip()]
        if not self.live:
            return self.wrap([demo.quote(s) for s in symbols])

        async def one(batch: list[str]):
            recs, provider = await self.call("equity.price.quote", PROVIDERS["quote"], ttl=3, symbol=",".join(batch))
            return [normalize_quote(r) for r in recs], provider

        try:
            data, provider = await one(symbols)
        except DataUnavailable:
            results = await asyncio.gather(*(one([s]) for s in symbols), return_exceptions=True)
            data, provider = [], None
            for r in results:
                if isinstance(r, tuple):
                    data.extend(r[0])
                    provider = provider or r[1]
            if not data:
                raise
        return self.wrap(data, provider)

    async def history(self, symbol: str, interval: str = "1d", start: str | None = None, end: str | None = None) -> dict:
        symbol = symbol.upper()
        if not start:
            days = {"1m": 5, "5m": 10, "15m": 20, "30m": 30, "1h": 60}.get(interval, 365 * 5)
            start = (date.today() - timedelta(days=days)).isoformat()

        async def live():
            kind = asset_class(symbol)
            path, key, sym = {
                "index": ("index.price.historical", "index_history", symbol.lstrip("^")),
                "fx": ("currency.price.historical", "fx_history", symbol),
                "crypto": ("crypto.price.historical", "crypto_history", symbol.replace("-", "")),
            }.get(kind, ("equity.price.historical", "history", symbol))
            ttl = 30 if interval.endswith(("m", "h")) else 600
            recs, provider = await self.call(
                path, PROVIDERS[key], ttl=ttl, symbol=sym, interval=interval, start_date=start, end_date=end
            )
            bars = [normalize_bar(r) for r in recs if r.get("close") is not None]
            bars.sort(key=lambda b: b["date"])
            return bars, provider

        return await self._either(live, lambda: demo.history(symbol, interval, start, end), symbol=symbol, interval=interval)

    async def profile(self, symbol: str) -> dict:
        symbol = symbol.upper()

        async def live():
            recs, provider = await self.call("equity.profile", PROVIDERS["profile"], ttl=3600, symbol=symbol)
            r = recs[0]
            data = {
                "symbol": symbol,
                "name": _first(r, "name", "legal_name"),
                "sector": r.get("sector"),
                "industry": _first(r, "industry_category", "industry_group", "industry"),
                "exchange": r.get("stock_exchange"),
                "ceo": r.get("ceo"),
                "employees": r.get("employees"),
                "hq_country": r.get("hq_country"),
                "website": r.get("company_url"),
                "market_cap": _num(r.get("market_cap")),
                "shares_outstanding": _num(r.get("shares_outstanding")),
                "beta": _num(r.get("beta")),
                "pe_ratio": _num(r.get("pe_ratio")),
                "dividend_yield": _num(r.get("dividend_yield")),
                "description": _first(r, "long_description", "short_description"),
                "raw": r,
            }
            return data, provider

        return await self._either(live, lambda: demo.profile(symbol))

    async def fundamentals(self, symbol: str, statement: str, period: str = "annual", limit: int = 5) -> dict:
        symbol = symbol.upper()
        if statement not in ("income", "balance", "cash"):
            raise ValueError("statement must be income, balance or cash")

        async def live():
            recs, provider = await self.call(
                f"equity.fundamental.{statement}", PROVIDERS["fundamentals"], ttl=3600, symbol=symbol, period=period, limit=limit
            )
            return recs, provider

        return await self._either(live, lambda: demo.fundamentals(symbol, statement, period, limit), statement=statement)

    async def news(self, symbols: list[str] | None = None, limit: int = 30) -> dict:
        async def live():
            sym = ",".join(symbols) if symbols else "SPY,QQQ,AAPL,MSFT,NVDA,AMZN"
            recs, provider = await self.call("news.company", PROVIDERS["news"], ttl=120, symbol=sym, limit=limit)
            data = [
                {
                    "date": r.get("date"),
                    "title": r.get("title"),
                    "symbols": r.get("symbols"),
                    "source": _first(r, "source", "publisher", "author"),
                    "url": r.get("url"),
                    "excerpt": _first(r, "excerpt", "text", "body"),
                }
                for r in recs
            ]
            data.sort(key=lambda r: str(r["date"]), reverse=True)
            return data[:limit], provider

        return await self._either(live, lambda: demo.news(symbols, limit))

    async def options(self, symbol: str) -> dict:
        symbol = symbol.upper()

        async def live():
            recs, provider = await self.call("derivatives.options.chains", PROVIDERS["options"], ttl=60, symbol=symbol)
            return recs, provider

        return await self._either(live, lambda: demo.options_chain(symbol), symbol=symbol)

    async def yield_curve(self, day: str | None = None) -> dict:
        async def live():
            recs, provider = await self.call("fixedincome.government.yield_curve", PROVIDERS["yield_curve"], ttl=3600, date=day)
            latest = max(str(r.get("date")) for r in recs)
            data = [
                {
                    "date": str(r.get("date")),
                    "maturity": r.get("maturity"),
                    "years": maturity_years(r.get("maturity")),
                    "rate": _num(r.get("rate")),
                }
                for r in recs
                if str(r.get("date")) == latest
            ]
            data.sort(key=lambda r: r["years"] or 0)
            return data, provider

        return await self._either(live, lambda: demo.yield_curve(date.fromisoformat(day) if day else None))

    async def economic_calendar(self, start: str | None = None, end: str | None = None) -> dict:
        start = start or (date.today() - timedelta(days=3)).isoformat()
        end = end or (date.today() + timedelta(days=10)).isoformat()

        async def live():
            recs, provider = await self.call(
                "economy.calendar", PROVIDERS["economic_calendar"], ttl=900, start_date=start, end_date=end
            )
            return recs, provider

        return await self._either(live, lambda: demo.economic_calendar(date.fromisoformat(start)))

    async def earnings_calendar(self, start: str | None = None, end: str | None = None) -> dict:
        start = start or date.today().isoformat()
        end = end or (date.today() + timedelta(days=14)).isoformat()

        async def live():
            recs, provider = await self.call(
                "equity.calendar.earnings", PROVIDERS["earnings_calendar"], ttl=1800, start_date=start, end_date=end
            )
            return recs, provider

        return await self._either(live, lambda: demo.earnings_calendar(date.fromisoformat(start)))

    async def world(self) -> dict:
        async def live():
            q = await self.quotes(WORLD_INDEX_SYMBOLS)
            data = [
                {
                    "symbol": r["symbol"],
                    "name": r.get("name") or r["symbol"],
                    "region": "Americas",
                    "price": r["last"],
                    "change": r["change"],
                    "change_percent": r["change_percent"],
                    "high": r["high"],
                    "low": r["low"],
                    "prev_close": r["prev_close"],
                }
                for r in q["data"]
            ]
            return data, q["provider"]

        return await self._either(live, demo.index_snapshots)

    async def _snapshots_from_history(self, symbols: list[str], names: dict[str, str], kind: str):
        async def one(sym: str):
            h = await self.history(sym, "1d", (date.today() - timedelta(days=14)).isoformat())
            bars = h["data"]
            if len(bars) < 2:
                raise DataUnavailable(f"not enough history for {sym}")
            last, prev = bars[-1], bars[-2]
            return {
                "symbol": sym,
                "name": names.get(sym, sym),
                "kind": kind,
                "price": last["close"],
                "change": last["close"] - prev["close"],
                "change_percent": (last["close"] - prev["close"]) / prev["close"] if prev["close"] else None,
                "high": last["high"],
                "low": last["low"],
            }, h["provider"]

        results = await asyncio.gather(*(one(s) for s in symbols), return_exceptions=True)
        ok = [r for r in results if isinstance(r, tuple)]
        if not ok:
            raise DataUnavailable(f"no live {kind} data: {results[0]}")
        return [r[0] for r in ok], ok[0][1]

    async def fx(self) -> dict:
        async def live():
            return await self._snapshots_from_history(list(demo.FX), {k: v[0] for k, v in demo.FX.items()}, "fx")

        return await self._either(live, demo.fx_snapshots)

    async def crypto(self) -> dict:
        async def live():
            return await self._snapshots_from_history(list(demo.CRYPTO), {k: v[0] for k, v in demo.CRYPTO.items()}, "crypto")

        return await self._either(live, demo.crypto_snapshots)

    async def commodities(self) -> dict:
        async def live():
            recs, provider = await self.call("commodity.price.spot", ["fred"], ttl=3600)
            return recs, provider

        return await self._either(live, demo.commodity_snapshots)

    async def movers(self) -> dict:
        async def live():
            recs, provider = await self.call("nasdaq.markets.movers", ["nasdaq"], ttl=120)
            groups: dict[str, list[dict]] = {"gainers": [], "losers": [], "active": []}
            for r in recs:
                cat = str(_first(r, "category", "type", "list") or "").lower()
                key = "gainers" if "gain" in cat or "advanc" in cat else "losers" if "los" in cat or "declin" in cat else "active"
                groups[key].append(
                    {
                        "symbol": r.get("symbol"),
                        "name": r.get("name"),
                        "price": _num(_first(r, "price", "last_price", "last")),
                        "change": _num(r.get("change")),
                        "change_percent": _num(_first(r, "change_percent", "percent_change")),
                        "volume": _num(r.get("volume")),
                    }
                )
            return groups, provider

        return await self._either(live, demo.movers)

    async def sectors(self) -> dict:
        etfs = {"XLK": "Technology", "XLF": "Financial Services", "XLE": "Energy", "XLV": "Healthcare",
                "XLY": "Consumer Cyclical", "XLP": "Consumer Defensive", "XLI": "Industrials", "XLB": "Basic Materials",
                "XLU": "Utilities", "XLRE": "Real Estate", "XLC": "Communication Services"}

        async def live():
            q = await self.quotes(list(etfs))
            data = [
                {"sector": etfs.get(r["symbol"], r["symbol"]), "symbol": r["symbol"], "change_percent": r["change_percent"]}
                for r in q["data"]
            ]
            data.sort(key=lambda r: r["change_percent"] or 0, reverse=True)
            return data, q["provider"]

        return await self._either(live, demo.sectors)

    async def search(self, query: str) -> dict:
        async def live():
            recs, provider = await self.call("equity.search", PROVIDERS["search"], ttl=3600, query=query)
            data = [{"symbol": r.get("symbol"), "name": r.get("name"), "kind": "equity"} for r in recs if r.get("symbol")]
            return data[:25], provider

        if self.live:
            try:
                return await self._either(live, lambda: [])
            except DataUnavailable:
                pass
        # Built-in symbol directory (names only, no prices), not market data.
        return {"source": "directory", "provider": "builtin", "data": demo.search(query)}

    async def filings(self, symbol: str, limit: int = 25) -> dict:
        async def live():
            recs, provider = await self.call("equity.fundamental.filings", PROVIDERS["filings"], ttl=1800, symbol=symbol.upper(), limit=limit)
            return recs[:limit], provider

        return await self._either(live, lambda: demo.filings(symbol, limit))

    async def insider(self, symbol: str, limit: int = 25) -> dict:
        async def live():
            recs, provider = await self.call("equity.ownership.insider_trading", PROVIDERS["insider"], ttl=1800, symbol=symbol.upper(), limit=limit)
            return recs[:limit], provider

        return await self._either(live, lambda: demo.insider_trading(symbol, limit))

    async def generic(self, path: str, provider: str | None, params: dict) -> dict:
        """Run any OpenBB command (used by the API explorer panel). Live only."""
        if not self.live and not self.openbb_available():
            raise DataUnavailable(self.openbb_error or "OpenBB not available")
        recs, prov = await self.call(path, [provider] if provider else None, ttl=30, **params)
        return {"source": "live", "provider": prov, "data": recs}
