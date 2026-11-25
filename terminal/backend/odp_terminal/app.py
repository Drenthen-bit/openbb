"""FastAPI application serving the ODP Terminal API, WebSocket stream and UI."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import secrets
import time
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import ai, analytics
from .market import DataUnavailable, MarketData
from .store import Store
from .trading import OrderError, Quote, TradingEngine

log = logging.getLogger("odp_terminal")

DEFAULT_DB = Path(os.environ.get("TERMINAL_DB", Path.home() / ".odp_terminal" / "terminal.db"))
STATIC_DIR = Path(os.environ.get("TERMINAL_STATIC_DIR", Path(__file__).parent / "static"))


# ----------------------------------------------------------------- models
class WatchlistIn(BaseModel):
    name: str
    symbols: list[str] = Field(default_factory=list)


class WatchlistPatch(BaseModel):
    name: str | None = None
    symbols: list[str] | None = None


class LayoutIn(BaseModel):
    id: str | None = None
    name: str
    data: Any


class OrderIn(BaseModel):
    symbol: str
    side: str
    quantity: float
    order_type: str = "market"
    limit_price: float | None = None
    stop_price: float | None = None
    tif: str = "day"


class AlertIn(BaseModel):
    symbol: str
    condition: str
    value: float
    note: str | None = None


class NoteIn(BaseModel):
    symbol: str | None = None
    body: str


class AnalystIn(BaseModel):
    question: str
    symbol: str | None = None
    include_portfolio: bool = False


class ObbIn(BaseModel):
    path: str
    provider: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)


class LoginIn(BaseModel):
    token: str


class CredentialIn(BaseModel):
    name: str
    value: str


# ----------------------------------------------------------------- hub
class Hub:
    """Tracks WebSocket clients and their symbol subscriptions."""

    def __init__(self):
        self.clients: dict[WebSocket, set[str]] = {}

    def symbols(self) -> set[str]:
        out: set[str] = set()
        for subs in self.clients.values():
            out |= subs
        return out

    async def send(self, ws: WebSocket, msg: dict) -> None:
        try:
            await ws.send_text(json.dumps(msg, default=str))
        except Exception:  # noqa: BLE001
            self.clients.pop(ws, None)

    async def broadcast(self, msg: dict) -> None:
        await asyncio.gather(*(self.send(ws, msg) for ws in list(self.clients)))


COOKIE = "odp_terminal_token"


def create_app(
    mode: str | None = None,
    db_path: str | Path | None = None,
    start_background: bool = True,
    token: str | None = None,
) -> FastAPI:
    """Build the app. With ``token`` (or TERMINAL_TOKEN) set, every data route requires it."""
    token = token if token is not None else (os.environ.get("TERMINAL_TOKEN") or None)
    mode = mode or os.environ.get("TERMINAL_DATA_MODE", "auto")
    market = MarketData(mode)
    store = Store(db_path or DEFAULT_DB)
    engine = TradingEngine(store)
    hub = Hub()
    state: dict[str, Any] = {"last_quotes": {}, "tick": 0, "started": time.time()}

    def to_quotes(rows: list[dict], source: str) -> dict[str, Quote]:
        out = {}
        for r in rows:
            if r.get("last") is not None:
                out[r["symbol"]] = Quote(r["last"], r.get("bid"), r.get("ask"), r.get("change_percent"), source)
        return out

    async def quotes_for(symbols: set[str]) -> dict[str, Quote]:
        if not symbols:
            return {}
        try:
            res = await market.quotes(sorted(symbols))
        except DataUnavailable as exc:
            log.warning("quote refresh failed: %s", exc)
            return {}
        for r in res["data"]:
            state["last_quotes"][r["symbol"]] = {**r, "source": res["source"]}
        return to_quotes(res["data"], res["source"])

    async def loop() -> None:
        last_probe = time.time()
        while True:
            interval = 5.0 if market.live else 1.0
            try:
                state["tick"] += 1
                if market.requested_mode == "auto" and time.time() - last_probe > 300:
                    last_probe = time.time()
                    before = market.live
                    await market.probe()
                    if before != market.live:
                        await hub.broadcast({"type": "status", "data": status_payload()})
                watched = hub.symbols()
                needed = watched | engine.open_symbols() | engine.alert_symbols()
                quotes = await quotes_for(needed)
                if quotes and hub.clients:
                    for ws, subs in list(hub.clients.items()):
                        rows = [state["last_quotes"][s] for s in subs if s in state["last_quotes"]]
                        if rows:
                            await hub.send(ws, {"type": "quotes", "source": market.source, "data": rows})
                for fill in engine.process_orders(quotes):
                    await hub.broadcast({"type": "order", "data": fill})
                for alert in engine.check_alerts(quotes):
                    await hub.broadcast({"type": "alert", "data": alert})
                if state["tick"] % 60 == 1:
                    engine.expire_day_orders()
                    pf = engine.portfolio(quotes)
                    if pf["positions"] or pf["cash"] != pf["account"]["initial_cash"]:
                        engine.record_equity(pf["equity"])
            except Exception:  # noqa: BLE001 - keep the loop alive
                log.exception("background loop error")
            await asyncio.sleep(interval)

    def status_payload() -> dict:
        ok, why = ai.available()
        return {
            "mode": market.source,
            "requested_mode": market.requested_mode,
            "openbb": market.openbb_available(),
            "openbb_error": market.openbb_error,
            "last_probe": market.last_probe,
            "last_probe_error": market.last_probe_error,
            "ai_available": ok,
            "ai_reason": why,
            "ai_model": ai.MODEL if ok else None,
            "server_time": time.time(),
            "uptime": time.time() - state["started"],
            "clients": len(hub.clients),
        }

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        task = None
        # Import OpenBB on the main thread: its first import builds the package and
        # installs signal handlers, which fails from the worker threads used later.
        market.openbb_available()
        if start_background:
            await market.probe()
            task = asyncio.create_task(loop())
        yield
        if task:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

    app = FastAPI(title="ODP Terminal", version="1.0.0", lifespan=lifespan)
    app.state.market = market
    app.state.store = store
    app.state.engine = engine
    app.state.hub = hub
    def authorized(cookies, headers, query) -> bool:
        if not token:
            return True
        supplied = cookies.get(COOKIE) or query.get("token") or ""
        auth = headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            supplied = auth[7:]
        return secrets.compare_digest(supplied.encode(), token.encode())

    open_paths = ("/terminal/session", "/terminal/login", "/terminal/logout")

    @app.middleware("http")
    async def require_token(request: Request, call_next):
        path = request.url.path
        protected = path.startswith(("/terminal", "/odp")) and path not in open_paths
        if protected and not authorized(request.cookies, request.headers, request.query_params):
            return JSONResponse(status_code=401, content={"detail": "access token required"})
        return await call_next(request)

    @app.get("/terminal/session")
    async def session(request: Request):
        return {
            "auth_required": bool(token),
            "authenticated": authorized(request.cookies, request.headers, request.query_params),
        }

    @app.post("/terminal/login")
    async def login(body: LoginIn, request: Request):
        if not token:
            return {"authenticated": True}
        if not secrets.compare_digest(body.token.strip().encode(), token.encode()):
            raise HTTPException(401, "wrong access token")
        resp = JSONResponse({"authenticated": True})
        resp.set_cookie(
            COOKIE,
            token,
            max_age=365 * 24 * 3600,
            httponly=True,
            samesite="strict",
            secure=request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https",
        )
        return resp

    @app.post("/terminal/logout")
    async def logout():
        resp = Response(status_code=204)
        resp.delete_cookie(COOKIE)
        return resp

    @app.exception_handler(DataUnavailable)
    async def _data_unavailable(_, exc: DataUnavailable):
        return JSONResponse(status_code=503, content={"detail": str(exc), "source": market.source})

    @app.exception_handler(OrderError)
    async def _order_error(_, exc: OrderError):
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    @app.exception_handler(ValueError)
    async def _value_error(_, exc: ValueError):
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    api = "/terminal"

    # ------------------------------------------------------------- status
    @app.get(f"{api}/status")
    async def status():
        return status_payload()

    @app.post(f"{api}/mode")
    async def set_mode(mode: str = Body(..., embed=True)):
        if mode not in ("auto", "live", "demo"):
            raise HTTPException(400, "mode must be auto, live or demo")
        market.requested_mode = mode
        market.cache = type(market.cache)()
        state["last_quotes"] = {}
        await market.probe()
        payload = status_payload()
        await hub.broadcast({"type": "status", "data": payload})
        return payload

    # ------------------------------------------------------------- market data
    @app.get(f"{api}/quote")
    async def quote(symbols: str = Query(..., description="Comma separated symbols")):
        return await market.quotes([s for s in symbols.split(",") if s.strip()])

    @app.get(f"{api}/history")
    async def history(symbol: str, interval: str = "1d", start: str | None = None, end: str | None = None):
        return await market.history(symbol, interval, start, end)

    @app.get(f"{api}/profile")
    async def profile(symbol: str):
        return await market.profile(symbol)

    @app.get(f"{api}/fundamentals")
    async def fundamentals(symbol: str, statement: str = "income", period: str = "annual", limit: int = 5):
        return await market.fundamentals(symbol, statement, period, limit)

    @app.get(f"{api}/news")
    async def news(symbols: str | None = None, limit: int = 30):
        syms = [s.strip().upper() for s in symbols.split(",") if s.strip()] if symbols else None
        return await market.news(syms, limit)

    @app.get(f"{api}/options")
    async def options(symbol: str):
        return await market.options(symbol)

    @app.get(f"{api}/yield_curve")
    async def yield_curve(date: str | None = None):
        return await market.yield_curve(date)

    @app.get(f"{api}/calendar/economic")
    async def eco(start: str | None = None, end: str | None = None):
        return await market.economic_calendar(start, end)

    @app.get(f"{api}/calendar/earnings")
    async def earnings(start: str | None = None, end: str | None = None):
        return await market.earnings_calendar(start, end)

    @app.get(f"{api}/world")
    async def world():
        return await market.world()

    @app.get(f"{api}/fx")
    async def fx():
        return await market.fx()

    @app.get(f"{api}/crypto")
    async def crypto():
        return await market.crypto()

    @app.get(f"{api}/commodities")
    async def commodities():
        return await market.commodities()

    @app.get(f"{api}/movers")
    async def movers():
        return await market.movers()

    @app.get(f"{api}/sectors")
    async def sectors():
        return await market.sectors()

    @app.get(f"{api}/search")
    async def search(q: str):
        return await market.search(q)

    @app.get(f"{api}/filings")
    async def filings(symbol: str, limit: int = 25):
        return await market.filings(symbol, limit)

    @app.get(f"{api}/insider")
    async def insider(symbol: str, limit: int = 25):
        return await market.insider(symbol, limit)

    @app.get(f"{api}/insights")
    async def insights(symbol: str):
        h = await market.history(symbol, "1d")
        out = analytics.compute_insights(symbol.upper(), h["data"])
        return market.wrap(out, h["provider"])

    @app.get(f"{api}/correlation")
    async def correlation(symbols: str, days: int = 252):
        syms = [s.strip().upper() for s in symbols.split(",") if s.strip()][:20]
        hists = await asyncio.gather(*(market.history(s, "1d") for s in syms), return_exceptions=True)
        by_date: dict[str, dict[str, float]] = {}
        provider = None
        for s, h in zip(syms, hists):
            if isinstance(h, Exception):
                continue
            provider = provider or h["provider"]
            for b in h["data"][-days - 1 :]:
                by_date.setdefault(b["date"][:10], {})[s] = b["close"]
        ok = [s for s in syms if any(s in v for v in by_date.values())]
        dates = sorted(d for d, v in by_date.items() if all(s in v for s in ok))
        series = {s: [by_date[d][s] for d in dates] for s in ok}
        return market.wrap(analytics.correlation_matrix(series), provider)

    # ------------------------------------------------------------- generic OpenBB access
    @app.get(f"{api}/obb/commands")
    async def obb_commands():
        try:
            cov = market.obb.coverage.commands
        except Exception as exc:  # noqa: BLE001
            raise DataUnavailable(f"OpenBB coverage unavailable: {exc}") from exc
        return {"commands": {k.lstrip("."): v for k, v in sorted(cov.items())}}

    @app.post(f"{api}/obb/run")
    async def obb_run(body: ObbIn):
        path = body.path.strip().strip("/").replace("/", ".")
        if not path or any(not p.isidentifier() or p.startswith("_") for p in path.split(".")):
            raise HTTPException(400, "invalid command path")
        if path.split(".")[0] in ("user", "system", "account", "coverage", "reference"):
            raise HTTPException(400, "only data commands can be run here")
        return await market.generic(path, body.provider, body.params)

    @app.get(f"{api}/credentials")
    async def credentials():
        try:
            creds = market.obb.user.credentials.model_dump()
        except Exception as exc:  # noqa: BLE001
            raise DataUnavailable(f"OpenBB credentials unavailable: {exc}") from exc
        return {"credentials": {k: v is not None for k, v in sorted(creds.items())}}

    @app.post(f"{api}/credentials")
    async def set_credential(body: CredentialIn):
        """Set an OpenBB provider credential for this server session (not written to disk)."""
        creds = market.obb.user.credentials
        if body.name not in creds.model_dump():
            raise HTTPException(400, f"unknown credential {body.name}")
        setattr(creds, body.name, body.value or None)
        market.cache = type(market.cache)()
        return {"name": body.name, "set": bool(body.value)}

    # ------------------------------------------------------------- watchlists
    @app.get(f"{api}/watchlists")
    async def watchlists():
        return store.list_watchlists()

    @app.post(f"{api}/watchlists")
    async def create_watchlist(body: WatchlistIn):
        return store.create_watchlist(body.name, body.symbols)

    @app.patch(f"{api}/watchlists/{{wid}}")
    async def patch_watchlist(wid: str, body: WatchlistPatch):
        res = store.update_watchlist(wid, body.name, body.symbols)
        if not res:
            raise HTTPException(404, "watchlist not found")
        return res

    @app.delete(f"{api}/watchlists/{{wid}}")
    async def delete_watchlist(wid: str):
        if not store.delete_watchlist(wid):
            raise HTTPException(404, "watchlist not found")
        return {"deleted": wid}

    # ------------------------------------------------------------- layouts
    @app.get(f"{api}/layouts")
    async def layouts():
        return store.list_layouts()

    @app.get(f"{api}/layouts/{{lid}}")
    async def get_layout(lid: str):
        row = store.get_layout(lid)
        if not row:
            raise HTTPException(404, "layout not found")
        return row

    @app.post(f"{api}/layouts")
    async def save_layout(body: LayoutIn):
        return store.save_layout(body.id, body.name, body.data)

    @app.delete(f"{api}/layouts/{{lid}}")
    async def delete_layout(lid: str):
        if not store.delete_layout(lid):
            raise HTTPException(404, "layout not found")
        return {"deleted": lid}

    # ------------------------------------------------------------- notes
    @app.get(f"{api}/notes")
    async def notes(symbol: str | None = None):
        return store.list_notes(symbol)

    @app.post(f"{api}/notes")
    async def add_note(body: NoteIn):
        if not body.body.strip():
            raise HTTPException(400, "note is empty")
        return store.add_note(body.symbol, body.body)

    @app.delete(f"{api}/notes/{{nid}}")
    async def delete_note(nid: str):
        if not store.delete_note(nid):
            raise HTTPException(404, "note not found")
        return {"deleted": nid}

    # ------------------------------------------------------------- paper trading
    async def portfolio_now() -> dict:
        syms = {p["symbol"] for p in engine.positions()}
        quotes = await quotes_for(syms)
        pf = engine.portfolio(quotes)
        pf["source"] = market.source
        return pf

    @app.get(f"{api}/portfolio")
    async def portfolio():
        return await portfolio_now()

    @app.get(f"{api}/portfolio/history")
    async def portfolio_history():
        return engine.equity_history()

    @app.post(f"{api}/portfolio/reset")
    async def portfolio_reset(cash: float = Body(1_000_000.0, embed=True)):
        if cash <= 0:
            raise HTTPException(400, "cash must be positive")
        engine.reset(cash=cash)
        return await portfolio_now()

    @app.get(f"{api}/orders")
    async def orders(status: str | None = None):
        return engine.orders(status=status)

    @app.post(f"{api}/orders")
    async def submit_order(body: OrderIn):
        quotes = await quotes_for({body.symbol.strip().upper()})
        q = quotes.get(body.symbol.strip().upper())
        if q is None and body.order_type == "market":
            raise HTTPException(503, f"no quote available for {body.symbol.upper()}; market order not accepted")
        order = engine.submit(
            body.symbol, body.side, body.quantity, body.order_type, body.limit_price, body.stop_price, body.tif, q
        )
        await hub.broadcast({"type": "order", "data": order})
        return order

    @app.delete(f"{api}/orders/{{oid}}")
    async def cancel_order(oid: str):
        order = engine.cancel(oid)
        await hub.broadcast({"type": "order", "data": order})
        return order

    # ------------------------------------------------------------- alerts
    @app.get(f"{api}/alerts")
    async def alerts(status: str | None = None):
        return engine.alerts(status)

    @app.post(f"{api}/alerts")
    async def add_alert(body: AlertIn):
        return engine.add_alert(body.symbol, body.condition, body.value, body.note)

    @app.delete(f"{api}/alerts/{{aid}}")
    async def delete_alert(aid: str):
        if not engine.delete_alert(aid):
            raise HTTPException(404, "alert not found")
        return {"deleted": aid}

    # ------------------------------------------------------------- AI analyst
    @app.post(f"{api}/analyst")
    async def analyst(body: AnalystIn):
        ok, why = ai.available()
        if not ok:
            raise HTTPException(503, why)
        context: dict[str, Any] = {"source": market.source, "as_of": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime())}
        if body.symbol:
            sym = body.symbol.upper()

            async def safe(coro):
                try:
                    return (await coro)["data"]
                except Exception as exc:  # noqa: BLE001
                    return {"error": str(exc)[:200]}

            q, h, prof, inc, nws = await asyncio.gather(
                safe(market.quotes([sym])),
                safe(market.history(sym, "1d")),
                safe(market.profile(sym)),
                safe(market.fundamentals(sym, "income", "annual", 4)),
                safe(market.news([sym], 12)),
            )
            context.update(
                {
                    "symbol": sym,
                    "quote": q,
                    "technicals": analytics.compute_insights(sym, h) if isinstance(h, list) else h,
                    "profile": {k: v for k, v in prof.items() if k != "raw"} if isinstance(prof, dict) else prof,
                    "income_statement": inc,
                    "headlines": [{"date": n.get("date"), "title": n.get("title")} for n in nws] if isinstance(nws, list) else nws,
                }
            )
        if body.include_portfolio:
            pf = await portfolio_now()
            context["portfolio"] = {k: pf[k] for k in ("equity", "cash", "positions", "unrealized_pnl", "realized_pnl", "day_pnl")}

        async def gen():
            async for chunk in ai.stream_analysis(body.question, context):
                yield chunk

        return StreamingResponse(gen(), media_type="text/plain; charset=utf-8")

    # ------------------------------------------------------------- websocket
    @app.websocket(f"{api}/ws")
    async def ws_endpoint(ws: WebSocket):
        if not authorized(ws.cookies, ws.headers, ws.query_params):
            await ws.close(code=4401)
            return
        await ws.accept()
        hub.clients[ws] = set()
        await hub.send(ws, {"type": "status", "data": status_payload()})
        try:
            while True:
                msg = json.loads(await ws.receive_text())
                op = msg.get("op")
                syms = {s.strip().upper() for s in msg.get("symbols", []) if isinstance(s, str) and s.strip()}
                if op == "subscribe":
                    hub.clients[ws] |= syms
                elif op == "unsubscribe":
                    hub.clients[ws] -= syms
                elif op == "set":
                    hub.clients[ws] = syms
                elif op == "ping":
                    await hub.send(ws, {"type": "pong", "t": time.time()})
                if op in ("subscribe", "set") and syms:
                    cached = [state["last_quotes"][s] for s in syms if s in state["last_quotes"]]
                    missing = syms - {c["symbol"] for c in cached}
                    if missing:
                        await quotes_for(missing)
                        cached = [state["last_quotes"][s] for s in syms if s in state["last_quotes"]]
                    if cached:
                        await hub.send(ws, {"type": "quotes", "source": market.source, "data": cached})
        except (WebSocketDisconnect, RuntimeError, json.JSONDecodeError):
            pass
        finally:
            hub.clients.pop(ws, None)

    # ------------------------------------------------------------- OpenBB REST API + UI
    if os.environ.get("TERMINAL_MOUNT_ODP", "1") == "1":
        try:
            from openbb_core.api.rest_api import app as odp_app  # noqa: PLC0415

            app.mount("/odp", odp_app)
        except Exception as exc:  # noqa: BLE001
            log.warning("OpenBB REST API not mounted: %s", exc)

    if STATIC_DIR.is_dir() and (STATIC_DIR / "index.html").exists():
        app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str):
            target = (STATIC_DIR / path).resolve()
            if path and target.is_file() and STATIC_DIR.resolve() in target.parents:
                return FileResponse(target)
            return FileResponse(STATIC_DIR / "index.html")

    return app
