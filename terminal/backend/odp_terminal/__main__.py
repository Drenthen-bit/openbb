"""Run the terminal server: ``python -m odp_terminal`` or ``odp-terminal``."""

from __future__ import annotations

import argparse
import logging
import os
import secrets
import socket


def _lan_ip() -> str | None:
    """Best-effort local network address (no packets are sent)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            ip = s.getsockname()[0]
            return None if ip.startswith("127.") else ip
    except OSError:
        return None


def _print_qr(url: str) -> None:
    try:
        import qrcode  # noqa: PLC0415
    except ImportError:
        return
    qr = qrcode.QRCode(border=1)
    qr.add_data(url)
    qr.make(fit=True)
    qr.print_ascii(invert=True)


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
    parser.add_argument("--token", default=os.environ.get("TERMINAL_TOKEN"), help="access token required by every data route")
    parser.add_argument(
        "--lan",
        action="store_true",
        help="serve on your local network (for an iPad or phone): binds 0.0.0.0 and requires a token",
    )
    parser.add_argument("--no-odp", action="store_true", help="do not mount the full OpenBB REST API at /odp")
    args = parser.parse_args()

    host = "0.0.0.0" if args.lan else args.host  # noqa: S104
    loopback = host in ("127.0.0.1", "localhost", "::1")
    token = args.token
    if not loopback and not token:
        token = secrets.token_urlsafe(12)
        print("\n  No TERMINAL_TOKEN set; generated one for this run (set TERMINAL_TOKEN to keep it fixed).")

    os.environ["TERMINAL_DATA_MODE"] = args.mode
    if args.no_odp:
        os.environ["TERMINAL_MOUNT_ODP"] = "0"
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    import uvicorn  # noqa: PLC0415

    from .app import create_app  # noqa: PLC0415

    app = create_app(mode=args.mode, db_path=args.db, token=token)

    print(f"\n  ODP Terminal  ->  http://{'127.0.0.1' if not loopback else host}:{args.port}")
    if not loopback:
        ip = _lan_ip()
        if ip:
            url = f"http://{ip}:{args.port}/?token={token}"
            print(f"  On your iPad  ->  {url}")
            print("  Scan with the iPad camera, then Share > Add to Home Screen:\n")
            _print_qr(url)
        print(f"  Access token: {token}\n")
    else:
        print()
    uvicorn.run(app, host=host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
