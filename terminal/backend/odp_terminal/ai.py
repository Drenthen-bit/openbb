"""Optional AI analyst backed by the Claude API.

Enabled when the ``anthropic`` package is installed and credentials resolve
(``ANTHROPIC_API_KEY`` or an ``ant auth login`` profile). The analyst only
sees the data the terminal already gathered and is told which source
(live or demo) that data came from.
"""

from __future__ import annotations

import json
import logging
import os
from typing import AsyncIterator

log = logging.getLogger("odp_terminal.ai")

MODEL = os.environ.get("TERMINAL_AI_MODEL", "claude-opus-5-5")

SYSTEM_PROMPT = """You are the analyst desk inside a market data terminal. You receive a JSON \
context snapshot (quotes, price statistics, technical signals, fundamentals, headlines, \
portfolio) and a question from the user.

Ground every claim in the snapshot. Quote numbers from it, and say when something the \
question needs is not in the snapshot rather than guessing. If the snapshot's "source" is \
"demo", the data is synthetic: say so in your first line and treat the analysis as a \
walkthrough of method, not a view on the real security.

Write for a professional trader: lead with the answer, then the supporting evidence, then \
risks and what would change the view. Use short sections with markdown headings and bullet \
points; keep it under about 350 words unless asked for more. You are not giving personalized \
investment advice; do not tell the user to buy or sell."""


def available() -> tuple[bool, str | None]:
    try:
        import anthropic  # noqa: F401, PLC0415
    except ImportError:
        return False, "Install the 'anthropic' package to enable the AI analyst."
    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN") or os.environ.get("ANTHROPIC_PROFILE")):
        # A profile from `ant auth login` may still exist on disk; report it as possibly unavailable.
        cfg = os.path.expanduser("~/.config/anthropic")
        if not os.path.isdir(cfg):
            return False, "Set ANTHROPIC_API_KEY (or run `ant auth login`) to enable the AI analyst."
    return True, None


async def stream_analysis(question: str, context: dict) -> AsyncIterator[str]:
    """Yield markdown text chunks of the analyst's answer."""
    import anthropic  # noqa: PLC0415

    client = anthropic.AsyncAnthropic()
    payload = json.dumps(context, default=str, separators=(",", ":"))
    try:
        async with client.beta.messages.stream(
            model=MODEL,
            max_tokens=16000,
            system=SYSTEM_PROMPT,
            output_config={"effort": "medium"},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            messages=[
                {
                    "role": "user",
                    "content": f"<context>\n{payload}\n</context>\n\n<question>\n{question}\n</question>",
                }
            ],
        ) as stream:
            async for text in stream.text_stream:
                yield text
            final = await stream.get_final_message()
            if final.stop_reason == "refusal":
                yield "\n\n_The model declined to answer this request._"
            elif final.stop_reason == "max_tokens":
                yield "\n\n_Answer truncated at the output limit._"
    except anthropic.AuthenticationError:
        yield "**AI analyst unavailable:** the Anthropic credentials were rejected."
    except anthropic.RateLimitError:
        yield "**AI analyst busy:** rate limited by the Claude API, try again shortly."
    except anthropic.APIStatusError as exc:
        yield f"**AI analyst error ({exc.status_code}):** {exc.message}"
    except anthropic.APIConnectionError:
        yield "**AI analyst unavailable:** could not reach the Claude API from this server."
