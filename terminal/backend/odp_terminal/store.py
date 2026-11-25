"""SQLite persistence for watchlists, layouts, paper-trading and alerts."""

from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS watchlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    symbols TEXT NOT NULL,
    created REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS layouts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    updated REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    cash REAL NOT NULL,
    initial_cash REAL NOT NULL,
    realized_pnl REAL NOT NULL DEFAULT 0,
    created REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS positions (
    account_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    quantity REAL NOT NULL,
    avg_cost REAL NOT NULL,
    PRIMARY KEY (account_id, symbol)
);
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    quantity REAL NOT NULL,
    order_type TEXT NOT NULL,
    limit_price REAL,
    stop_price REAL,
    tif TEXT NOT NULL,
    status TEXT NOT NULL,
    filled_price REAL,
    filled_at REAL,
    reason TEXT,
    created REAL NOT NULL,
    data_source TEXT
);
CREATE TABLE IF NOT EXISTS equity_history (
    account_id TEXT NOT NULL,
    ts REAL NOT NULL,
    equity REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    condition TEXT NOT NULL,
    value REAL NOT NULL,
    note TEXT,
    status TEXT NOT NULL,
    created REAL NOT NULL,
    triggered_at REAL,
    triggered_price REAL
);
CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    symbol TEXT,
    body TEXT NOT NULL,
    created REAL NOT NULL
);
"""


class Store:
    """Thread-safe wrapper around one SQLite connection."""

    def __init__(self, path: str | Path):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        with self._lock:
            self._conn.executescript(SCHEMA)
            self._conn.commit()
        self._seed()

    # ---------------------------------------------------------------- helpers
    def execute(self, sql: str, params: tuple | dict = ()) -> sqlite3.Cursor:
        with self._lock:
            cur = self._conn.execute(sql, params)
            self._conn.commit()
            return cur

    def query(self, sql: str, params: tuple | dict = ()) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(r) for r in self._conn.execute(sql, params).fetchall()]

    def one(self, sql: str, params: tuple | dict = ()) -> dict[str, Any] | None:
        rows = self.query(sql, params)
        return rows[0] if rows else None

    def transaction(self):
        """Return the lock so callers can group several statements."""
        return self._lock

    @staticmethod
    def new_id() -> str:
        return uuid.uuid4().hex[:12]

    # ---------------------------------------------------------------- seeding
    def _seed(self) -> None:
        if not self.query("SELECT id FROM watchlists LIMIT 1"):
            self.create_watchlist("Core", ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "JPM", "XOM", "SPY", "QQQ"])
            self.create_watchlist("Macro", ["SPY", "QQQ", "IWM", "TLT", "GLD", "XLE", "XLF", "XLK"])
        if not self.query("SELECT id FROM accounts LIMIT 1"):
            self.execute(
                "INSERT INTO accounts (id, name, cash, initial_cash, realized_pnl, created) VALUES (?,?,?,?,0,?)",
                ("paper", "Paper Account", 1_000_000.0, 1_000_000.0, time.time()),
            )

    # ---------------------------------------------------------------- kv
    def get_kv(self, key: str, default: Any = None) -> Any:
        row = self.one("SELECT value FROM kv WHERE key=?", (key,))
        return json.loads(row["value"]) if row else default

    def set_kv(self, key: str, value: Any) -> None:
        self.execute(
            "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, json.dumps(value)),
        )

    # ---------------------------------------------------------------- watchlists
    def list_watchlists(self) -> list[dict]:
        rows = self.query("SELECT * FROM watchlists ORDER BY created")
        for r in rows:
            r["symbols"] = json.loads(r["symbols"])
        return rows

    def create_watchlist(self, name: str, symbols: list[str]) -> dict:
        wid = self.new_id()
        clean = _clean_symbols(symbols)
        self.execute(
            "INSERT INTO watchlists (id, name, symbols, created) VALUES (?,?,?,?)",
            (wid, name, json.dumps(clean), time.time()),
        )
        return {"id": wid, "name": name, "symbols": clean}

    def update_watchlist(self, wid: str, name: str | None, symbols: list[str] | None) -> dict | None:
        row = self.one("SELECT * FROM watchlists WHERE id=?", (wid,))
        if not row:
            return None
        new_name = name if name is not None else row["name"]
        new_symbols = _clean_symbols(symbols) if symbols is not None else json.loads(row["symbols"])
        self.execute(
            "UPDATE watchlists SET name=?, symbols=? WHERE id=?",
            (new_name, json.dumps(new_symbols), wid),
        )
        return {"id": wid, "name": new_name, "symbols": new_symbols}

    def delete_watchlist(self, wid: str) -> bool:
        return self.execute("DELETE FROM watchlists WHERE id=?", (wid,)).rowcount > 0

    # ---------------------------------------------------------------- layouts
    def list_layouts(self) -> list[dict]:
        rows = self.query("SELECT id, name, updated FROM layouts ORDER BY updated DESC")
        return rows

    def get_layout(self, lid: str) -> dict | None:
        row = self.one("SELECT * FROM layouts WHERE id=?", (lid,))
        if row:
            row["data"] = json.loads(row["data"])
        return row

    def save_layout(self, lid: str | None, name: str, data: Any) -> dict:
        lid = lid or self.new_id()
        now = time.time()
        self.execute(
            "INSERT INTO layouts (id, name, data, updated) VALUES (?,?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET name=excluded.name, data=excluded.data, updated=excluded.updated",
            (lid, name, json.dumps(data), now),
        )
        return {"id": lid, "name": name, "updated": now}

    def delete_layout(self, lid: str) -> bool:
        return self.execute("DELETE FROM layouts WHERE id=?", (lid,)).rowcount > 0

    # ---------------------------------------------------------------- notes
    def list_notes(self, symbol: str | None = None) -> list[dict]:
        if symbol:
            return self.query("SELECT * FROM notes WHERE symbol=? ORDER BY created DESC", (symbol.upper(),))
        return self.query("SELECT * FROM notes ORDER BY created DESC LIMIT 200")

    def add_note(self, symbol: str | None, body: str) -> dict:
        nid = self.new_id()
        sym = symbol.upper() if symbol else None
        now = time.time()
        self.execute("INSERT INTO notes (id, symbol, body, created) VALUES (?,?,?,?)", (nid, sym, body, now))
        return {"id": nid, "symbol": sym, "body": body, "created": now}

    def delete_note(self, nid: str) -> bool:
        return self.execute("DELETE FROM notes WHERE id=?", (nid,)).rowcount > 0


def _clean_symbols(symbols: list[str]) -> list[str]:
    seen: list[str] = []
    for s in symbols:
        s = s.strip().upper()
        if s and s not in seen:
            seen.append(s)
    return seen
