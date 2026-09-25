import pytest

import driver_sdk as d


def test_s_shorthand_matrix():
    assert d.s("integer") == {"type": "integer"}
    assert d.s({"pass": "boolean", "note": "string?"}) == {
        "type": "object",
        "properties": {"pass": {"type": "boolean"}, "note": {"type": "string"}},
        "required": ["pass"],
        "additionalProperties": False,
    }
    assert d.s(["string"]) == {"type": "array", "items": {"type": "string"}}
    assert d.s({"verdict": d.s.enum(["a", "b"])})["properties"]["verdict"] == {
        "enum": ["a", "b"]
    }
    raw = {"type": "object", "properties": {}}
    assert d.s(raw) is raw
    with pytest.raises(ValueError):
        d.s("floaty")


def test_s_accepts_pydantic_duck_type():
    class FakeModel:
        @staticmethod
        def model_json_schema():
            return {"type": "object", "properties": {"n": {"type": "integer"}}}

    assert d.s(FakeModel)["properties"]["n"] == {"type": "integer"}


def _done(stub, invocation_id="inv-1", result=7):
    stub.routes[("POST", "/invocations")] = (201, {"id": invocation_id})
    stub.routes[("GET", f"/invocations/{invocation_id}")] = (
        200,
        {"status": "done", "result": result},
    )


def test_spawn_returns_the_result(stub):
    _done(stub, result=42)

    assert d.spawn("do it", "integer", harness="claude-code", poll_seconds=0) == 42


def test_spawn_sends_a_kit_shaped_setup(stub):
    _done(stub)

    d.spawn(
        "run one cell",
        {"ok": "boolean"},
        harness="claude-code",
        connections=["conn-ghe"],
        seed={"url": "https://github.example/acme/tool", "commit": "a" * 40},
        install="uv pip install ./tool",
        env={"MODE": "cell"},
        resources={"cpu": "2", "memory": "4Gi", "storage": "10Gi"},
        backend="vm",
        skills=[{"source": "https://github.example/acme/skills", "name": "grill"}],
        ttl_ms=3_600_000,
        label="cell:persona/task",
        poll_seconds=0,
    )

    body = stub.requests[0][2]
    assert body == {
        "prompt": "run one cell",
        "schema": d.s({"ok": "boolean"}),
        "harness": "claude-code",
        "connections": ["conn-ghe"],
        "seed": {"url": "https://github.example/acme/tool", "commit": "a" * 40},
        "install": {"command": "uv pip install ./tool"},
        "env": [{"name": "MODE", "value": "cell"}],
        "resources": {"cpu": "2", "memory": "4Gi", "storage": "10Gi"},
        "backend": "vm",
        "skills": [{"source": "https://github.example/acme/skills", "name": "grill"}],
        "ttlMs": 3_600_000,
        "label": "cell:persona/task",
    }


def test_spawn_keeps_the_experiment_sdk_size_arguments(stub):
    _done(stub)

    d.spawn(
        "do it",
        "integer",
        harness="claude-code",
        memory="4Gi",
        cpu="2",
        label="cell",
        poll_seconds=0,
    )

    body = stub.requests[0][2]
    assert (body["memory"], body["cpu"]) == ("4Gi", "2")
    assert body["label"] == "cell"


def test_spawn_needs_a_harness_or_an_image(stub):
    with pytest.raises(ValueError, match="harness="):
        d.spawn("do it", "integer")
    assert stub.requests == []


def test_spawn_refuses_size_both_inside_and_beside_resources(stub):
    with pytest.raises(ValueError, match="inside resources"):
        d.spawn(
            "do it",
            "integer",
            harness="claude-code",
            resources={"cpu": "2"},
            memory="4Gi",
        )
    assert stub.requests == []


def test_spawn_failure_surfaces_the_platform_reason(stub):
    stub.routes[("POST", "/invocations")] = (201, {"id": "inv-3"})
    stub.routes[("GET", "/invocations/inv-3")] = (
        200,
        {"status": "failed", "errorReason": "install failed: exit 1"},
    )

    with pytest.raises(d.InvocationFailed) as exc:
        d.spawn("do it", "integer", harness="claude-code", poll_seconds=0)

    assert "install failed: exit 1" in str(exc.value)
    assert exc.value.reason == "install failed: exit 1"


def test_spawn_failure_without_a_reason_stays_bare(stub):
    stub.routes[("POST", "/invocations")] = (201, {"id": "inv-4"})
    stub.routes[("GET", "/invocations/inv-4")] = (200, {"status": "failed"})

    with pytest.raises(d.InvocationFailed) as exc:
        d.spawn("do it", "integer", image="some/image:1", poll_seconds=0)

    assert str(exc.value).endswith("failed")
    assert exc.value.reason is None


def test_budget_reads_the_owner_figures(stub):
    stub.routes[("GET", "/budget")] = (
        200,
        {
            "cpu": {"reservedMilli": 3000, "ceilingMilli": 6000},
            "memory": {"reservedBytes": 1, "ceilingBytes": 2},
            "defaultWorkerSize": {"cpu": "1", "memory": "1Gi"},
        },
    )

    assert d.budget()["cpu"]["ceilingMilli"] == 6000
