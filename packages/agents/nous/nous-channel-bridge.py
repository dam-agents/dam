#!/usr/bin/env python3
"""Localhost bridge: Nous native channel webhook -> platform `send_channel_message`.

Nous (``orchestrator/channels.py``) POSTs a markdown gate summary to each
configured channel at every DESIGN/FINDINGS gate — and it does so even under
``--auto-approve`` (the notify fires before the gate decision). Point a campaign
at this bridge:

    channels:
      - kind: webhook
        url: http://127.0.0.1:8765/gate?channel=slack

and the bridge forwards each summary to the platform's per-agent MCP
``send_channel_message`` tool, which delivers it into the agent's bound
Slack/Telegram thread. The campaign keeps using Nous's *own* channel feature;
this just re-targets it at the platform's messaging instead of an external
webhook — so no external egress and no webhook secret on disk.

Why this works in the pod (all verified against a live agent):
  * Auth is mesh-based — a process inside the agent pod inherits the pod's
    mesh identity, which the api-server waypoint accepts for
    ``/api/agents/<id>/mcp``. No token needed.
  * The MCP endpoint URL is injected as ``PLATFORM_MCP_URL``.
  * The MCP call must traverse the egress gateway (the pod's NetworkPolicy
    routes all egress through it); urllib's default opener honors ``HTTP_PROXY``
    and the in-cluster MCP host is not in ``NO_PROXY``, so it does.
  * Nous's POST to 127.0.0.1 must NOT be proxied — the image sets
    ``NO_PROXY=127.0.0.1,localhost,::1`` so localhost bypasses the gateway.

stdlib only — runs on the agent image's venv python; the pod has no extra tools
(not even ``awk``).
"""
from __future__ import annotations

import errno
import json
import logging
import os
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

MCP_URL = os.environ.get("PLATFORM_MCP_URL", "")
DEFAULT_CHANNEL = os.environ.get("NOUS_BRIDGE_CHANNEL", "slack")
PORT = int(os.environ.get("NOUS_BRIDGE_PORT", "8765"))
PROTOCOL_VERSION = "2025-06-18"
TIMEOUT_SECONDS = 15

logging.basicConfig(level=logging.INFO, format="[nous-bridge] %(levelname)s %(message)s")
log = logging.getLogger("nous-bridge")


def _first_jsonrpc(raw: bytes, content_type: str) -> dict | None:
    """Parse the first JSON-RPC object from an MCP response (SSE or plain JSON)."""
    text = raw.decode("utf-8", "replace")
    if "text/event-stream" in (content_type or ""):
        for line in text.splitlines():
            line = line.strip()
            if line.startswith("data:"):
                return json.loads(line[len("data:"):].strip())
        return None
    return json.loads(text) if text.strip() else None


def _mcp_post(payload: dict, session_id: str | None):
    """POST one JSON-RPC message to the MCP endpoint. Returns (headers, parsed)."""
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    if session_id:
        headers["mcp-session-id"] = session_id
    req = urllib.request.Request(
        MCP_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    # Default opener honors HTTP_PROXY/NO_PROXY. The in-cluster MCP host is not
    # in NO_PROXY, so this routes through the egress gateway, exactly like the
    # harness's own MCP calls.
    with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
        body = resp.read()
        return resp.headers, _first_jsonrpc(body, resp.headers.get("Content-Type", ""))


def _resolve_chat_id(channel: str, session_id: str | None) -> str | None:
    """Resolve the bound chat for ``channel`` via ``describe_channel``.

    Nous's webhook wiring is just ``?channel=<slack|telegram>`` with no chatId, so
    without this the tool falls back to the *last-active* thread — and Telegram
    rejects the send outright when no thread is currently active ("no active
    Telegram thread"), silently dropping every gate summary on a fresh campaign.
    ``describe_channel`` returns the authorized chats; we address the first one
    explicitly so delivery never depends on a live thread. An explicit
    ``?chatId=`` in the webhook URL still wins — this runs only when none is given.
    """
    _, parsed = _mcp_post(
        {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {"name": "describe_channel", "arguments": {"channel": channel}},
        },
        session_id,
    )
    result = (parsed or {}).get("result", {})
    if result.get("isError"):  # channel not bound / not available
        return None
    for item in result.get("content", []):
        if item.get("type") != "text":
            continue
        try:
            chats = json.loads(item.get("text", "") or "{}").get("chats")
        except json.JSONDecodeError:
            continue
        if isinstance(chats, list) and chats:
            return chats[0].get("id")
    return None


def send_channel_message(channel: str, text: str, chat_id: str | None) -> None:
    """Run the MCP handshake and call send_channel_message."""
    if not MCP_URL:
        raise RuntimeError("PLATFORM_MCP_URL not set — not inside a platform agent pod?")
    # 1. initialize -> mints the session id (returned in the mcp-session-id header).
    headers, _ = _mcp_post(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "nous-channel-bridge", "version": "1"},
            },
        },
        None,
    )
    sid = headers.get("mcp-session-id")
    # 2. initialized notification (the transport expects it before tool calls).
    _mcp_post({"jsonrpc": "2.0", "method": "notifications/initialized"}, sid)
    # 3. Address the bound chat explicitly. Without a chatId the tool targets the
    #    last-active thread, which Telegram rejects when none is active — so
    #    resolve it from describe_channel unless the webhook URL pinned one.
    if not chat_id:
        chat_id = _resolve_chat_id(channel, sid)
    # 4. the actual tool call.
    args: dict = {"channel": channel, "text": text}
    if chat_id:
        args["chatId"] = chat_id
    _, parsed = _mcp_post(
        {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {"name": "send_channel_message", "arguments": args},
        },
        sid,
    )
    result = (parsed or {}).get("result", {})
    if result.get("isError"):
        detail = " ".join(c.get("text", "") for c in result.get("content", []))
        raise RuntimeError(f"send_channel_message rejected: {detail or 'unknown error'}")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):  # silence default access logging
        pass

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            raw = self.rfile.read(length) if length else b"{}"
            body = json.loads(raw or b"{}")
            # Nous `webhook` kind -> {"markdown": ...}; `slack` kind -> {"text": ...}.
            text = (body.get("markdown") or body.get("text") or "").strip()
            qs = parse_qs(urlparse(self.path).query)
            channel = qs.get("channel", [DEFAULT_CHANNEL])[0]
            chat_id = qs.get("chatId", [None])[0]
            if not text:
                self._reply(400, {"ok": False, "error": "empty message"})
                return
            send_channel_message(channel, text, chat_id)
            log.info("forwarded gate notification to channel %r", channel)
            self._reply(200, {"ok": True})
        except Exception as exc:  # never hard-fail; Nous's notifier is best-effort
            log.warning("forward failed: %s", exc)
            self._reply(502, {"ok": False, "error": str(exc)})

    def _reply(self, code: int, obj: dict) -> None:
        data = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main() -> int:
    if not MCP_URL:
        log.error("PLATFORM_MCP_URL not set; the bridge cannot reach the platform. Exiting.")
        return 1
    try:
        server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError as exc:
        if exc.errno == errno.EADDRINUSE:
            # Another bridge in this pod already owns the port. One shared bridge
            # serves every campaign/session here (it's stateless per request), so
            # a duplicate launch is a no-op — exit cleanly instead of crash-looping.
            log.info("port %d already in use; another bridge is running — nothing to do.", PORT)
            return 0
        raise
    log.info(
        "listening on http://127.0.0.1:%d/gate -> %s (default channel: %s)",
        PORT, MCP_URL, DEFAULT_CHANNEL,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
