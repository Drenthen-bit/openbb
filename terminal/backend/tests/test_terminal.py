"""Tests for the ODP Terminal backend (no network required)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from odp_terminal import analytics, demo
from odp_terminal.app import create_app
from odp_terminal.market import DataUnavailable, MarketData, maturity_years, normalize_quote, records
from odp_terminal.store import Store
from odp_terminal.trading import OrderError, Quote, TradingEngine


# ------------------------------------------------------------------ demo data
def test_demo_quote_is_consistent():
    q = demo.quote("AAPL")
    assert q["symbol"] == "AAPL"
    assert q["bid"] < q["last"] < q["ask"]
    assert q["low"] <= q["last"] <= q["high"]
    assert q["change"] == pytest.approx(q["last"] - q["prev_close"], abs=1e-3)


def test_demo_history_is_deterministic_and_ordered():
    a = demo.history("MSFT")
    b = demo.history("MSFT")
    assert [x["close"] for x in a[:-1]] == [x["close"] for x in b[:-1]]
    dates = [x["date"] for x in a]
    assert dates == sorted(dates)
    assert all(x["low"] <= min(x["open"], x["close"]) and x["high"] >= max(x["open"], x["close"]) for x in a[:-1])


def test_demo_intraday_and_resample():
    bars = demo.history("SPY", "5m")
    assert len(bars) > 100
    weekly = demo.history("SPY", "1W")
    assert len(weekly) < len(demo.history("SPY")) / 4


def test_demo_options_chain_put_call_parity_shape():
    rows = demo.options_chain("AAPL")
    calls = [r for r in rows if r["option_type"] == "call"]
    puts = [r for r in rows if r["option_type"] == "put"]
    assert len(calls) == len(puts) > 0
    assert all(0 <= r["delta"] <= 1 for r in calls)
    assert all(-1 <= r["delta"] <= 0 for r in puts)


def test_demo_misc_datasets():
    assert len(demo.yield_curve()) == 11
    assert demo.economic_calendar()
    assert {"gainers", "losers", "active"} <= set(demo.movers())
    assert demo.search("apple")[0]["symbol"] == "AAPL"
    for st in ("income", "balance", "cash"):
        assert len(demo.fundamentals("NVDA", st)) == 5


# ------------------------------------------------------------------ normalization
def test_normalize_quote_maps_provider_fields():
    q = normalize_quote({"symbol": "aapl", "last_price": 101.0, "prev_close": 100.0, "fifty_two_week_high": 120})
    assert q["symbol"] == "AAPL"
    assert q["last"] == 101.0
    assert q["change"] == pytest.approx(1.0)
    assert q["change_percent"] == pytest.approx(0.01)
    assert q["year_high"] == 120


def test_records_handles_columnar_results():
    class Model:
        def model_dump(self, **_):
            return {"strike": [1, 2], "option_type": ["call", "put"]}

    assert records(Model()) == [{"strike": 1, "option_type": "call"}, {"strike": 2, "option_type": "put"}]
    assert records([{"a": 1}]) == [{"a": 1}]
    assert records(None) == []


def test_maturity_years():
    assert maturity_years("month_3") == pytest.approx(0.25)
    assert maturity_years("year_10") == 10
    assert maturity_years("bogus") is None


# ------------------------------------------------------------------ analytics
def test_insights_and_correlation():
    bars = demo.history("NVDA")
    out = analytics.compute_insights("NVDA", bars)
    assert out["bias"] in ("bullish", "bearish", "neutral")
    assert 0 <= out["stats"]["rsi14"] <= 100
    c = analytics.correlation_matrix({"A": [1, 2, 3, 2, 4, 5, 4], "B": [1, 2, 3, 2, 4, 5, 4]})
    assert c["matrix"][0][1] == pytest.approx(1.0)


# ------------------------------------------------------------------ trading
@pytest.fixture
def engine():
    return TradingEngine(Store(":memory:"), slippage_bps=0)


def test_market_order_fills_at_touch(engine):
    o = engine.submit("AAPL", "buy", 10, quote=Quote(100, 99.9, 100.1))
    assert o["status"] == "filled" and o["filled_price"] == pytest.approx(100.1)
    acct = engine.account()
    assert acct["cash"] == pytest.approx(1_000_000 - 1001)


def test_limit_order_waits_then_fills(engine):
    o = engine.submit("AAPL", "buy", 10, "limit", limit_price=95, quote=Quote(100, 99.9, 100.1))
    assert o["status"] == "open"
    assert engine.process_orders({"AAPL": Quote(97, 96.9, 97.1)}) == []
    fills = engine.process_orders({"AAPL": Quote(94.5, 94.4, 94.6)})
    assert fills and fills[0]["filled_price"] == pytest.approx(94.6)


def test_stop_order_triggers(engine):
    engine.submit("AAPL", "buy", 10, quote=Quote(100, 100, 100))
    stop = engine.submit("AAPL", "sell", 10, "stop", stop_price=95, quote=Quote(100, 100, 100))
    assert stop["status"] == "open"
    fills = engine.process_orders({"AAPL": Quote(94, 94, 94)})
    assert fills[0]["status"] == "filled"
    assert engine.account()["realized_pnl"] == pytest.approx(-60)


def test_short_and_cover_realizes_pnl(engine):
    engine.submit("TSLA", "sell", 5, quote=Quote(200, 200, 200))
    pos = engine.positions()[0]
    assert pos["quantity"] == -5
    engine.submit("TSLA", "buy", 5, quote=Quote(180, 180, 180))
    assert engine.positions() == []
    assert engine.account()["realized_pnl"] == pytest.approx(100)


def test_flip_through_zero_resets_cost(engine):
    engine.submit("X", "buy", 10, quote=Quote(10, 10, 10))
    engine.submit("X", "sell", 15, quote=Quote(12, 12, 12))
    pos = engine.positions()[0]
    assert pos["quantity"] == -5 and pos["avg_cost"] == 12
    assert engine.account()["realized_pnl"] == pytest.approx(20)


def test_insufficient_buying_power_rejects(engine):
    o = engine.submit("BRK.A", "buy", 10, quote=Quote(700_000, 700_000, 700_000))
    assert o["status"] == "rejected"


def test_order_validation(engine):
    with pytest.raises(OrderError):
        engine.submit("AAPL", "buy", 0)
    with pytest.raises(OrderError):
        engine.submit("AAPL", "hold", 1)
    with pytest.raises(OrderError):
        engine.submit("AAPL", "buy", 1, "limit")


def test_cancel(engine):
    o = engine.submit("AAPL", "buy", 1, "limit", limit_price=1)
    assert engine.cancel(o["id"])["status"] == "cancelled"
    with pytest.raises(OrderError):
        engine.cancel(o["id"])


def test_portfolio_marks_to_market(engine):
    engine.submit("AAPL", "buy", 10, quote=Quote(100, 100, 100))
    pf = engine.portfolio({"AAPL": Quote(110, 110, 110, 0.1)})
    assert pf["unrealized_pnl"] == pytest.approx(100)
    assert pf["equity"] == pytest.approx(1_000_100)
    assert pf["day_pnl"] == pytest.approx(100)


def test_alerts_fire_once(engine):
    engine.add_alert("AAPL", "above", 105)
    engine.add_alert("AAPL", "change_below", -2)
    assert engine.check_alerts({"AAPL": Quote(104, change_percent=0)}) == []
    fired = engine.check_alerts({"AAPL": Quote(106, change_percent=-0.03)})
    assert len(fired) == 2
    assert engine.check_alerts({"AAPL": Quote(107, change_percent=-0.05)}) == []
    with pytest.raises(OrderError):
        engine.add_alert("AAPL", "sideways", 1)


# ------------------------------------------------------------------ API
@pytest.fixture
def client():
    app = create_app(mode="demo", db_path=":memory:", start_background=False)
    with TestClient(app) as c:
        yield c


@pytest.mark.parametrize(
    "url",
    [
        "/terminal/quote?symbols=AAPL,MSFT",
        "/terminal/history?symbol=AAPL&interval=1d",
        "/terminal/profile?symbol=AAPL",
        "/terminal/fundamentals?symbol=AAPL&statement=cash&period=quarter",
        "/terminal/news?symbols=AAPL",
        "/terminal/options?symbol=SPY",
        "/terminal/yield_curve",
        "/terminal/calendar/economic",
        "/terminal/calendar/earnings",
        "/terminal/world",
        "/terminal/fx",
        "/terminal/crypto",
        "/terminal/commodities",
        "/terminal/movers",
        "/terminal/sectors",
        "/terminal/filings?symbol=AAPL",
        "/terminal/insider?symbol=AAPL",
        "/terminal/insights?symbol=AAPL",
        "/terminal/correlation?symbols=AAPL,MSFT,SPY",
    ],
)
def test_demo_endpoints_are_labelled(client, url):
    r = client.get(url)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source"] == "demo"
    assert body["data"]


def test_bad_statement_is_400(client):
    assert client.get("/terminal/fundamentals?symbol=AAPL&statement=nope").status_code == 400


def test_order_flow_via_api(client):
    r = client.post("/terminal/orders", json={"symbol": "AAPL", "side": "buy", "quantity": 5})
    assert r.status_code == 200 and r.json()["status"] == "filled"
    assert r.json()["data_source"] == "demo"
    pf = client.get("/terminal/portfolio").json()
    assert pf["positions"][0]["symbol"] == "AAPL"
    r = client.post("/terminal/orders", json={"symbol": "AAPL", "side": "buy", "quantity": -1})
    assert r.status_code == 400
    lim = client.post("/terminal/orders", json={"symbol": "AAPL", "side": "buy", "quantity": 1, "order_type": "limit", "limit_price": 1}).json()
    assert client.delete(f"/terminal/orders/{lim['id']}").json()["status"] == "cancelled"
    reset = client.post("/terminal/portfolio/reset", json={"cash": 5000}).json()
    assert reset["cash"] == 5000 and reset["positions"] == []


def test_watchlists_layouts_notes_alerts(client):
    wl = client.post("/terminal/watchlists", json={"name": "T", "symbols": ["aapl", "AAPL", " msft "]}).json()
    assert wl["symbols"] == ["AAPL", "MSFT"]
    assert client.patch(f"/terminal/watchlists/{wl['id']}", json={"symbols": ["X"]}).json()["symbols"] == ["X"]
    assert client.delete(f"/terminal/watchlists/{wl['id']}").status_code == 200
    lay = client.post("/terminal/layouts", json={"name": "L", "data": {"pages": []}}).json()
    assert client.get(f"/terminal/layouts/{lay['id']}").json()["data"] == {"pages": []}
    note = client.post("/terminal/notes", json={"symbol": "aapl", "body": "hi"}).json()
    assert client.get("/terminal/notes?symbol=AAPL").json()[0]["id"] == note["id"]
    al = client.post("/terminal/alerts", json={"symbol": "AAPL", "condition": "above", "value": 1}).json()
    assert al["status"] == "active"


def test_obb_run_rejects_unsafe_paths(client):
    for path in ("user.credentials", "__class__", "equity..price", "system"):
        assert client.post("/terminal/obb/run", json={"path": path}).status_code == 400


def test_analyst_unavailable_without_credentials(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("ANTHROPIC_PROFILE", raising=False)
    monkeypatch.setenv("HOME", "/nonexistent")
    r = client.post("/terminal/analyst", json={"question": "hi"})
    assert r.status_code == 503


def test_websocket_streams_quotes(client):
    with client.websocket_connect("/terminal/ws") as ws:
        assert ws.receive_json()["type"] == "status"
        ws.send_json({"op": "subscribe", "symbols": ["AAPL", "SPY"]})
        msg = ws.receive_json()
        assert msg["type"] == "quotes"
        assert {q["symbol"] for q in msg["data"]} == {"AAPL", "SPY"}


def test_live_failures_are_errors_not_fake_data(monkeypatch):
    app = create_app(mode="live", db_path=":memory:", start_background=False)
    market: MarketData = app.state.market

    def boom(*_a, **_k):
        raise DataUnavailable("provider unreachable")

    monkeypatch.setattr(market, "_call", boom)
    with TestClient(app) as c:
        r = c.get("/terminal/quote?symbols=AAPL")
        assert r.status_code == 503
        assert "unreachable" in r.json()["detail"]
        assert c.get("/terminal/history?symbol=AAPL").status_code == 503


def test_live_quote_normalization(monkeypatch):
    app = create_app(mode="live", db_path=":memory:", start_background=False)
    market: MarketData = app.state.market
    monkeypatch.setattr(
        market,
        "_call",
        lambda path, providers, **kw: ([{"symbol": "AAPL", "last_price": 10.0, "prev_close": 8.0}], "cboe"),
    )
    with TestClient(app) as c:
        body = c.get("/terminal/quote?symbols=AAPL").json()
        assert body["source"] == "live" and body["provider"] == "cboe"
        assert body["data"][0]["change_percent"] == pytest.approx(0.25)
