"""A stub platform harness endpoint: records every request, answers from a
mutable route table. Serves on 127.0.0.1:<random>; the fixture points
PLATFORM_MCP_URL at it so the SDK self-configures against the stub."""

import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

AGENT_ID = "test-driver"


class StubPlatform:
    def __init__(self):
        self.requests = []  # (method, path, body)
        # path suffix -> (status, response body) or callable(body) -> (status, body)
        self.routes = {}

    def record(self, method, path, body):
        self.requests.append((method, path, body))

    def respond(self, method, path, body):
        key = (method, path)
        for (m, suffix), handler in self.routes.items():
            if m == method and path.endswith(suffix):
                return handler(body) if callable(handler) else handler
        raise AssertionError(f"stub has no route for {key}")

    def of_type(self, event_type):
        events = []
        for method, path, body in self.requests:
            if method == "POST" and path.endswith("/events") and body:
                events += [e for e in body["events"] if e["type"] == event_type]
        return events


def _make_handler(stub: StubPlatform):
    class Handler(BaseHTTPRequestHandler):
        def _handle(self, method):
            length = int(self.headers.get("content-length") or 0)
            raw = self.rfile.read(length) if length else b""
            body = json.loads(raw) if raw else None
            stub.record(method, self.path, body)
            status, response = stub.respond(method, self.path, body)
            payload = json.dumps(response).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self):
            self._handle("GET")

        def do_POST(self):
            self._handle("POST")

        def log_message(self, *args):
            pass

    return Handler


@pytest.fixture
def stub(monkeypatch):
    platform = StubPlatform()
    server = ThreadingHTTPServer(("127.0.0.1", 0), _make_handler(platform))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_address[1]
    monkeypatch.setenv(
        "PLATFORM_MCP_URL", f"http://127.0.0.1:{port}/api/agents/{AGENT_ID}/mcp"
    )
    monkeypatch.delenv("PLATFORM_EXPERIMENT_ID", raising=False)
    yield platform
    server.shutdown()
    server.server_close()
