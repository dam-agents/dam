"""GET polls must survive transient failures; non-GETs must not blind-retry."""

import urllib.error
import urllib.request

import pytest

import experiment_sdk as x


class _Resp:
    def __init__(self, text: str) -> None:
        self._text = text

    def read(self) -> bytes:
        return self._text.encode()

    def __enter__(self) -> "_Resp":
        return self

    def __exit__(self, *args: object) -> None:
        return None


def _http_error(code: int) -> urllib.error.HTTPError:
    import io

    return urllib.error.HTTPError("u", code, "err", {}, io.BytesIO(b"boom"))


@pytest.fixture
def platform(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("PLATFORM_MCP_URL", "http://api.test/api/agents/agent-1/mcp")
    monkeypatch.setattr(x.time, "sleep", lambda _s: None)
    x._config.cache_clear() if hasattr(x._config, "cache_clear") else None
    return monkeypatch


def test_get_retries_transient_503_then_succeeds(platform) -> None:
    calls = []

    def fake_urlopen(req):
        calls.append(req.get_method())
        if len(calls) < 3:
            raise _http_error(503)
        return _Resp('{"ok": true}')

    platform.setattr(urllib.request, "urlopen", fake_urlopen)
    assert x._request("GET", "/invocations/i-1") == {"ok": True}
    assert len(calls) == 3


def test_get_retries_connection_reset(platform) -> None:
    calls = []

    def fake_urlopen(req):
        calls.append(1)
        if len(calls) == 1:
            raise urllib.error.URLError("connection reset")
        return _Resp('{"ok": true}')

    platform.setattr(urllib.request, "urlopen", fake_urlopen)
    assert x._request("GET", "/invocations/i-1") == {"ok": True}


def test_get_gives_up_after_bounded_attempts(platform) -> None:
    calls = []

    def fake_urlopen(req):
        calls.append(1)
        raise _http_error(503)

    platform.setattr(urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(RuntimeError, match="503"):
        x._request("GET", "/invocations/i-1")
    assert len(calls) == x._RETRY_ATTEMPTS


def test_get_does_not_retry_a_400(platform) -> None:
    calls = []

    def fake_urlopen(req):
        calls.append(1)
        raise _http_error(400)

    platform.setattr(urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(RuntimeError, match="400"):
        x._request("GET", "/x")
    assert len(calls) == 1


def test_post_does_not_retry(platform) -> None:
    calls = []

    def fake_urlopen(req):
        calls.append(1)
        raise _http_error(503)

    platform.setattr(urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(RuntimeError, match="503"):
        x._request("POST", "/x", {"a": 1})
    assert len(calls) == 1


def test_409_still_raises_experiment_closed(platform) -> None:
    def fake_urlopen(req):
        raise _http_error(409)

    platform.setattr(urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(x.ExperimentClosed):
        x._request("GET", "/x")
