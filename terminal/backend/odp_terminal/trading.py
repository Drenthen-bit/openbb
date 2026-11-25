"""Paper-trading engine and price alerts.

Orders never leave this process: this is a simulator for practicing execution
against whatever quotes the terminal is showing (live or demo). Fills are
recorded with the data source they were priced from.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from .store import Store

ORDER_TYPES = ("market", "limit", "stop", "stop_limit")
SIDES = ("buy", "sell")
TIFS = ("day", "gtc")
ALERT_CONDITIONS = ("above", "below", "change_above", "change_below")


class OrderError(ValueError):
    pass


@dataclass
class Quote:
    last: float
    bid: float | None = None
    ask: float | None = None
    change_percent: float | None = None
    source: str = "demo"


class TradingEngine:
    def __init__(self, store: Store, commission: float = 0.0, slippage_bps: float = 1.0):
        self.store = store
        self.commission = commission
        self.slippage_bps = slippage_bps

    # ------------------------------------------------------------- accounts
    def account(self, account_id: str = "paper") -> dict:
        acct = self.store.one("SELECT * FROM accounts WHERE id=?", (account_id,))
        if not acct:
            raise OrderError(f"unknown account {account_id}")
        return acct

    def reset(self, account_id: str = "paper", cash: float = 1_000_000.0) -> dict:
        with self.store.transaction():
            self.store.execute("DELETE FROM positions WHERE account_id=?", (account_id,))
            self.store.execute("DELETE FROM orders WHERE account_id=?", (account_id,))
            self.store.execute("DELETE FROM equity_history WHERE account_id=?", (account_id,))
            self.store.execute(
                "UPDATE accounts SET cash=?, initial_cash=?, realized_pnl=0 WHERE id=?",
                (cash, cash, account_id),
            )
        return self.account(account_id)

    def positions(self, account_id: str = "paper") -> list[dict]:
        return self.store.query(
            "SELECT symbol, quantity, avg_cost FROM positions WHERE account_id=? AND quantity != 0 ORDER BY symbol",
            (account_id,),
        )

    def orders(self, account_id: str = "paper", status: str | None = None, limit: int = 200) -> list[dict]:
        if status:
            return self.store.query(
                "SELECT * FROM orders WHERE account_id=? AND status=? ORDER BY created DESC LIMIT ?",
                (account_id, status, limit),
            )
        return self.store.query(
            "SELECT * FROM orders WHERE account_id=? ORDER BY created DESC LIMIT ?", (account_id, limit)
        )

    def open_symbols(self) -> set[str]:
        rows = self.store.query("SELECT DISTINCT symbol FROM orders WHERE status='open'")
        rows += self.store.query("SELECT DISTINCT symbol FROM positions WHERE quantity != 0")
        return {r["symbol"] for r in rows}

    # ------------------------------------------------------------- orders
    def submit(
        self,
        symbol: str,
        side: str,
        quantity: float,
        order_type: str = "market",
        limit_price: float | None = None,
        stop_price: float | None = None,
        tif: str = "day",
        quote: Quote | None = None,
        account_id: str = "paper",
    ) -> dict:
        symbol = symbol.strip().upper()
        side = side.lower()
        order_type = order_type.lower()
        tif = tif.lower()
        if not symbol:
            raise OrderError("symbol is required")
        if side not in SIDES:
            raise OrderError("side must be buy or sell")
        if order_type not in ORDER_TYPES:
            raise OrderError(f"order_type must be one of {', '.join(ORDER_TYPES)}")
        if tif not in TIFS:
            raise OrderError("tif must be day or gtc")
        if quantity is None or quantity <= 0:
            raise OrderError("quantity must be positive")
        if order_type in ("limit", "stop_limit") and (limit_price is None or limit_price <= 0):
            raise OrderError("limit price required")
        if order_type in ("stop", "stop_limit") and (stop_price is None or stop_price <= 0):
            raise OrderError("stop price required")
        self.account(account_id)
        oid = self.store.new_id()
        self.store.execute(
            "INSERT INTO orders (id, account_id, symbol, side, quantity, order_type, limit_price, stop_price, tif, "
            "status, created) VALUES (?,?,?,?,?,?,?,?,?,'open',?)",
            (oid, account_id, symbol, side, quantity, order_type, limit_price, stop_price, tif, time.time()),
        )
        if quote is not None:
            self.try_fill(oid, quote)
        return self.store.one("SELECT * FROM orders WHERE id=?", (oid,))

    def cancel(self, order_id: str) -> dict:
        order = self.store.one("SELECT * FROM orders WHERE id=?", (order_id,))
        if not order:
            raise OrderError("order not found")
        if order["status"] != "open":
            raise OrderError(f"order is {order['status']}")
        self.store.execute("UPDATE orders SET status='cancelled', reason='user cancelled' WHERE id=?", (order_id,))
        return self.store.one("SELECT * FROM orders WHERE id=?", (order_id,))

    def _fill_price(self, order: dict, q: Quote) -> float | None:
        side = order["side"]
        ask = q.ask if q.ask else q.last
        bid = q.bid if q.bid else q.last
        touch = ask if side == "buy" else bid
        slip = touch * self.slippage_bps / 10_000
        market_px = touch + slip if side == "buy" else touch - slip
        ot = order["order_type"]
        if ot == "market":
            return market_px
        if ot == "limit":
            lp = order["limit_price"]
            if side == "buy" and ask <= lp:
                return min(lp, ask)
            if side == "sell" and bid >= lp:
                return max(lp, bid)
            return None
        stop = order["stop_price"]
        triggered = q.last >= stop if side == "buy" else q.last <= stop
        if not triggered:
            return None
        if ot == "stop":
            return market_px
        # stop_limit: once triggered, behaves as a limit order
        lp = order["limit_price"]
        if side == "buy" and ask <= lp:
            return min(lp, ask)
        if side == "sell" and bid >= lp:
            return max(lp, bid)
        return None

    def try_fill(self, order_id: str, q: Quote) -> dict | None:
        """Fill the order if its conditions are met. Returns the filled order or None."""
        with self.store.transaction():
            order = self.store.one("SELECT * FROM orders WHERE id=?", (order_id,))
            if not order or order["status"] != "open" or not q.last:
                return None
            px = self._fill_price(order, q)
            if px is None:
                return None
            px = round(px, 4)
            qty = order["quantity"]
            signed = qty if order["side"] == "buy" else -qty
            acct = self.account(order["account_id"])
            cost = signed * px + self.commission
            if order["side"] == "buy" and cost > acct["cash"]:
                self.store.execute(
                    "UPDATE orders SET status='rejected', reason='insufficient buying power' WHERE id=?", (order_id,)
                )
                return self.store.one("SELECT * FROM orders WHERE id=?", (order_id,))
            pos = self.store.one(
                "SELECT * FROM positions WHERE account_id=? AND symbol=?", (order["account_id"], order["symbol"])
            )
            old_qty = pos["quantity"] if pos else 0.0
            old_avg = pos["avg_cost"] if pos else 0.0
            new_qty = old_qty + signed
            realized = 0.0
            if old_qty == 0 or (old_qty > 0) == (signed > 0):
                new_avg = (old_qty * old_avg + signed * px) / new_qty if new_qty else 0.0
            else:
                closed = min(abs(old_qty), abs(signed))
                realized = closed * (px - old_avg) * (1 if old_qty > 0 else -1)
                if abs(signed) > abs(old_qty):
                    new_avg = px  # flipped through zero
                elif new_qty == 0:
                    new_avg = 0.0
                else:
                    new_avg = old_avg
            self.store.execute(
                "INSERT INTO positions (account_id, symbol, quantity, avg_cost) VALUES (?,?,?,?) "
                "ON CONFLICT(account_id, symbol) DO UPDATE SET quantity=excluded.quantity, avg_cost=excluded.avg_cost",
                (order["account_id"], order["symbol"], new_qty, new_avg),
            )
            self.store.execute(
                "UPDATE accounts SET cash=cash-?, realized_pnl=realized_pnl+? WHERE id=?",
                (cost, realized - self.commission, order["account_id"]),
            )
            self.store.execute(
                "UPDATE orders SET status='filled', filled_price=?, filled_at=?, data_source=? WHERE id=?",
                (px, time.time(), q.source, order_id),
            )
            return self.store.one("SELECT * FROM orders WHERE id=?", (order_id,))

    def expire_day_orders(self) -> int:
        cutoff = time.time() - 24 * 3600
        cur = self.store.execute(
            "UPDATE orders SET status='expired', reason='day order expired' WHERE status='open' AND tif='day' AND created < ?",
            (cutoff,),
        )
        return cur.rowcount

    # ------------------------------------------------------------- portfolio
    def portfolio(self, quotes: dict[str, Quote], account_id: str = "paper") -> dict:
        acct = self.account(account_id)
        rows = []
        mv_total = 0.0
        unreal_total = 0.0
        day_total = 0.0
        for p in self.positions(account_id):
            q = quotes.get(p["symbol"])
            last = q.last if q else p["avg_cost"]
            mv = p["quantity"] * last
            unreal = (last - p["avg_cost"]) * p["quantity"]
            day = 0.0
            if q and q.change_percent is not None and q.change_percent > -1:
                prev = last / (1 + q.change_percent)
                day = (last - prev) * p["quantity"]
            mv_total += mv
            unreal_total += unreal
            day_total += day
            rows.append(
                {
                    **p,
                    "last": last,
                    "market_value": mv,
                    "unrealized_pnl": unreal,
                    "unrealized_pct": (last / p["avg_cost"] - 1) * (1 if p["quantity"] > 0 else -1) if p["avg_cost"] else None,
                    "day_pnl": day,
                    "priced": q is not None,
                    "source": q.source if q else None,
                }
            )
        equity = acct["cash"] + mv_total
        for r in rows:
            r["weight"] = r["market_value"] / equity if equity else None
        return {
            "account": acct,
            "positions": rows,
            "cash": acct["cash"],
            "market_value": mv_total,
            "equity": equity,
            "unrealized_pnl": unreal_total,
            "realized_pnl": acct["realized_pnl"],
            "day_pnl": day_total,
            "total_return": equity / acct["initial_cash"] - 1 if acct["initial_cash"] else None,
            "gross_exposure": sum(abs(r["market_value"]) for r in rows),
        }

    def record_equity(self, equity: float, account_id: str = "paper") -> None:
        last = self.store.one(
            "SELECT ts FROM equity_history WHERE account_id=? ORDER BY ts DESC LIMIT 1", (account_id,)
        )
        if last and time.time() - last["ts"] < 60:
            return
        self.store.execute(
            "INSERT INTO equity_history (account_id, ts, equity) VALUES (?,?,?)", (account_id, time.time(), equity)
        )

    def equity_history(self, account_id: str = "paper", limit: int = 2000) -> list[dict]:
        rows = self.store.query(
            "SELECT ts, equity FROM equity_history WHERE account_id=? ORDER BY ts DESC LIMIT ?", (account_id, limit)
        )
        return list(reversed(rows))

    # ------------------------------------------------------------- alerts
    def alerts(self, status: str | None = None) -> list[dict]:
        if status:
            return self.store.query("SELECT * FROM alerts WHERE status=? ORDER BY created DESC", (status,))
        return self.store.query("SELECT * FROM alerts ORDER BY created DESC LIMIT 500")

    def add_alert(self, symbol: str, condition: str, value: float, note: str | None = None) -> dict:
        condition = condition.lower()
        if condition not in ALERT_CONDITIONS:
            raise OrderError(f"condition must be one of {', '.join(ALERT_CONDITIONS)}")
        if not symbol.strip():
            raise OrderError("symbol is required")
        aid = self.store.new_id()
        self.store.execute(
            "INSERT INTO alerts (id, symbol, condition, value, note, status, created) VALUES (?,?,?,?,?,'active',?)",
            (aid, symbol.strip().upper(), condition, float(value), note, time.time()),
        )
        return self.store.one("SELECT * FROM alerts WHERE id=?", (aid,))

    def delete_alert(self, aid: str) -> bool:
        return self.store.execute("DELETE FROM alerts WHERE id=?", (aid,)).rowcount > 0

    def alert_symbols(self) -> set[str]:
        return {r["symbol"] for r in self.store.query("SELECT DISTINCT symbol FROM alerts WHERE status='active'")}

    def check_alerts(self, quotes: dict[str, Quote]) -> list[dict]:
        fired = []
        for a in self.alerts("active"):
            q = quotes.get(a["symbol"])
            if not q or q.last is None:
                continue
            cond, v = a["condition"], a["value"]
            pct = (q.change_percent or 0) * 100
            hit = (
                (cond == "above" and q.last >= v)
                or (cond == "below" and q.last <= v)
                or (cond == "change_above" and pct >= v)
                or (cond == "change_below" and pct <= v)
            )
            if hit:
                self.store.execute(
                    "UPDATE alerts SET status='triggered', triggered_at=?, triggered_price=? WHERE id=?",
                    (time.time(), q.last, a["id"]),
                )
                fired.append(self.store.one("SELECT * FROM alerts WHERE id=?", (a["id"],)))
        return fired

    def process_orders(self, quotes: dict[str, Quote]) -> list[dict]:
        fills = []
        for o in self.store.query("SELECT id, symbol FROM orders WHERE status='open'"):
            q = quotes.get(o["symbol"])
            if q:
                res = self.try_fill(o["id"], q)
                if res:
                    fills.append(res)
        return fills
