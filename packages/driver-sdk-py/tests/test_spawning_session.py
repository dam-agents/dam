"""A spawn names the driver's session the script runs in, read from the
environment its harness gave the script, so the platform shows the sub-agent
only in that session's chat. A script run outside any session names none."""

import pytest

import driver_sdk as d

_SESSION_VARS = (
    "PLATFORM_SESSION_REF",
    "HARNESS_SESSION_ID",
    "CLAUDE_CODE_SESSION_ID",
    "CODEX_THREAD_ID",
    "PI_SESSION_ID",
)


@pytest.fixture(autouse=True)
def no_session(monkeypatch):
    for name in _SESSION_VARS:
        monkeypatch.delenv(name, raising=False)


def _routes(stub):
    stub.routes[("POST", "/invocations")] = (201, {"id": "inv-1"})
    stub.routes[("GET", "/invocations/inv-1")] = (
        200,
        {"status": "done", "result": 1, "exitCode": 0, "output": {}},
    )


def _posted(stub):
    return [
        headers
        for (method, _path, _body), headers in zip(stub.requests, stub.headers)
        if method == "POST"
    ]


def test_spawns_send_pis_session_ref_and_id(stub, monkeypatch):
    monkeypatch.setenv("PLATFORM_SESSION_REF", "ref-a")
    monkeypatch.setenv("PI_SESSION_ID", "pi-1")
    _routes(stub)

    d.spawn("go", "integer", harness="pi", poll_seconds=0)
    d.spawn_script("make", harness="pi", poll_seconds=0)

    posted = _posted(stub)
    assert len(posted) == 2
    for headers in posted:
        assert headers["x-platform-session-ref"] == "ref-a"
        assert headers["x-platform-session-id"] == "pi-1"


def test_the_first_session_id_set_wins(stub, monkeypatch):
    monkeypatch.setenv("CLAUDE_CODE_SESSION_ID", "cc-1")
    monkeypatch.setenv("HARNESS_SESSION_ID", "terminal-1")
    _routes(stub)

    d.spawn("go", "integer", harness="pi", poll_seconds=0)

    (headers,) = _posted(stub)
    assert headers["x-platform-session-id"] == "terminal-1"
    assert "x-platform-session-ref" not in headers


def test_no_session_in_the_environment_names_none(stub, monkeypatch):
    monkeypatch.setenv("PLATFORM_SESSION_REF", " ")
    _routes(stub)

    d.spawn("go", "integer", harness="pi", poll_seconds=0)

    (headers,) = _posted(stub)
    assert "x-platform-session-ref" not in headers
    assert "x-platform-session-id" not in headers
