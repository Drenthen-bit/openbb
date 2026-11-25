"""Run the terminal server: ``python -m odp_terminal`` or ``odp-terminal``."""

from __future__ import annotations

import argparse
import logging
import os


def main() -> None:
    parser = argparse.ArgumentParser(description="ODP Terminal server")
    parser.add_argument("--host", default=os.environ.get("TERMINAL_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("TERMINAL_PORT", "6901")))
    parser.add_argument(
        "--mode",
        choices=["auto", "live", "demo"],
        default=os.environ.get("TERMINAL_DATA_MODE", "auto"),
        help="auto: live OpenBB data when reachable, demo data otherwise",
    )
    parser.add_argument("--db", default=os.environ.get("TERMINAL_DB"), help="SQLite file for watchlists, layouts, trades")
    parser.add_argument("--no-odp", action="store_true", help="do not mount the full OpenBB REST API at /odp")
    args = parser.parse_args()

    os.environ["TERMINAL_DATA_MODE"] = args.mode
    if args.no_odp:
        os.environ["TERMINAL_MOUNT_ODP"] = "0"
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    import uvicorn  # noqa: PLC0415

    from .app import create_app  # noqa: PLC0415

    app = create_app(mode=args.mode, db_path=args.db)
    print(f"\n  ODP Terminal  ->  http://{args.host}:{args.port}\n")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
