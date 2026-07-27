import hashlib
import time

import pytest

import experiment_sdk as x


def write_script(tmp_path, content="print('hi')\n"):
    path = tmp_path / "exp.py"
    path.write_text(content)
    return str(path)


# ---- s() schema shorthand -----------------------------------------------------


def test_s_shorthand_matrix():
    assert x.s("integer") == {"type": "integer"}
    assert x.s({"pass": "boolean", "note": "string?"}) == {
        "type": "object",
        "properties": {"pass": {"type": "boolean"}, "note": {"type": "string"}},
        "required": ["pass"],
        "additionalProperties": False,
    }
    assert x.s(["string"]) == {"type": "array", "items": {"type": "string"}}
    assert x.s({"verdict": x.s.enum(["a", "b"])})["properties"]["verdict"] == {
        "enum": ["a", "b"]
    }
    raw = {"type": "object", "properties": {}}
    assert x.s(raw) is raw
    with pytest.raises(ValueError):
        x.s("floaty")


def test_s_accepts_pydantic_duck_type():
    class FakeModel:
        @staticmethod
        def model_json_schema():
            return {"type": "object", "properties": {"n": {"type": "integer"}}}

    assert x.s(FakeModel)["properties"]["n"] == {"type": "integer"}


# ---- plan mode ------------------------------------------------------------------


def test_plan_mode_registers_and_exits(stub, tmp_path):
    script = write_script(tmp_path, "loop body never runs\n")
    stub.routes[("POST", "/experiments/plan")] = (201, {"experimentId": "exp-1"})

    exp = x.Experiment("evolver", script_path=script)
    loop = exp.loop("generations")
    produce = loop.stage("produce")
    loop.stage("eval", after=produce)

    with pytest.raises(SystemExit) as exit_info:
        next(exp.iterations(loop))
    assert exit_info.value.code == 0

    method, path, body = stub.requests[-1]
    assert path.endswith("/experiments/plan")
    assert body["name"] == "evolver"
    assert [s["id"] for s in body["skeleton"]["stages"]] == ["produce", "eval"]
    assert body["skeleton"]["stages"][1]["after"] == ["produce"]
    assert body["skeleton"]["loops"] == [
        {"id": "generations", "stages": ["produce", "eval"]}
    ]
    raw = open(script, "rb").read()
    assert body["script"]["sha256"] == hashlib.sha256(raw).hexdigest()
    assert body["script"]["content"] == raw.decode()


# ---- run mode --------------------------------------------------------------------


def run_routes(stub):
    stub.routes[("POST", "/events")] = (200, {"accepted": 1})
    stub.routes[("POST", "/finish")] = (200, {"ok": True})


def test_heartbeat_runs_concurrently_and_stops_at_finish(stub, tmp_path, monkeypatch):
    """The heartbeat thread must keep pinging while the MAIN thread blocks
    (a spawn poll, a long local computation) and stop once the run ends."""
    monkeypatch.setenv("PLATFORM_EXPERIMENT_ID", "exp-hb")
    monkeypatch.setenv("PLATFORM_EXPERIMENT_HEARTBEAT_SECONDS", "0.05")
    run_routes(stub)
    script = write_script(tmp_path)

    with x.Experiment("evolver", script_path=script) as exp:
        stage = exp.stage("compute")
        with stage.run():
            time.sleep(0.4)  # the "long blocking work" — emits nothing itself

    beats_at_finish = len(stub.of_type("heartbeat"))
    assert beats_at_finish >= 3  # pinged while the main thread was blocked

    time.sleep(0.3)  # the stop event must have ended the thread
    assert len(stub.of_type("heartbeat")) == beats_at_finish


def test_run_mode_streams_spans_and_finishes(stub, tmp_path, monkeypatch):
    monkeypatch.setenv("PLATFORM_EXPERIMENT_ID", "exp-9")
    run_routes(stub)
    script = write_script(tmp_path)

    with x.Experiment("evolver", script_path=script) as exp:
        loop = exp.loop("generations")
        produce = loop.stage("produce")
        evaluate = loop.stage("eval", after=produce)
        for gen in exp.iterations(loop, max_iterations=2):
            with produce.run():
                pass
            with evaluate.run() as span:
                span.score = gen / 10
                span.artifact("art-1")

    run_starts = stub.of_type("run-start")
    assert len(run_starts) == 1
    assert run_starts[0]["scriptContent"] == open(script).read()

    starts = stub.of_type("span-start")
    ends = stub.of_type("span-end")
    assert [e["stage"] for e in starts] == ["produce", "eval", "produce", "eval"]
    assert [e["iteration"] for e in starts] == [0, 0, 1, 1]
    assert all(e["status"] == "ok" for e in ends)
    assert ends[1]["score"] == 0.0 and ends[3]["score"] == 0.1
    assert ends[1]["artifactIds"] == ["art-1"]

    method, path, body = stub.requests[-1]
    assert path.endswith("/experiments/exp-9/finish")
    assert body == {"status": "completed"}


def test_unhandled_exception_reports_failed_and_reraises(stub, tmp_path, monkeypatch):
    monkeypatch.setenv("PLATFORM_EXPERIMENT_ID", "exp-9")
    run_routes(stub)

    with pytest.raises(RuntimeError, match="boom"):
        with x.Experiment("evolver", script_path=write_script(tmp_path)) as exp:
            with exp.span("work"):
                raise RuntimeError("boom")

    method, path, body = stub.requests[-1]
    assert path.endswith("/finish")
    assert body["status"] == "failed"
    assert "boom" in body["error"]
    # The failing span itself closed as an error before the finish.
    assert stub.of_type("span-end")[-1]["status"] == "error"


def test_undeclared_stage_emits_stage_declare(stub, tmp_path, monkeypatch):
    monkeypatch.setenv("PLATFORM_EXPERIMENT_ID", "exp-9")
    run_routes(stub)

    with x.Experiment("evolver", script_path=write_script(tmp_path)) as exp:
        with exp.span("mutate"):
            pass

    assert stub.of_type("stage-declare") == [
        {"type": "stage-declare", "stage": "mutate"}
    ]


def test_closed_experiment_raises(stub, tmp_path, monkeypatch):
    monkeypatch.setenv("PLATFORM_EXPERIMENT_ID", "exp-9")
    stub.routes[("POST", "/events")] = (409, {"error": "experiment is stopped"})

    exp = x.Experiment("evolver", script_path=write_script(tmp_path))
    with pytest.raises(x.ExperimentClosed):
        exp.ready()  # the run-start flush hits the closed trace


def test_dashboard_path_is_captured_at_plan_time(stub, tmp_path):
    script = write_script(tmp_path)
    dashboard = tmp_path / "dashboard.html"
    dashboard.write_text("<html><body>custom viz</body></html>")
    stub.routes[("POST", "/experiments/plan")] = (201, {"experimentId": "exp-1"})

    exp = x.Experiment("evolver", script_path=script, dashboard_path="dashboard.html")
    with pytest.raises(SystemExit):
        exp.ready()

    body = stub.requests[-1][2]
    assert body["dashboard"]["content"] == "<html><body>custom viz</body></html>"


def test_post_data_emits_custom_data_event(stub, tmp_path, monkeypatch):
    monkeypatch.setenv("PLATFORM_EXPERIMENT_ID", "exp-9")
    run_routes(stub)

    with x.Experiment("evolver", script_path=write_script(tmp_path)) as exp:
        exp.post_data({"best": "hello world", "generation": 3})
        exp.post_data({"tables": [1, 2]}, merge=False)

    events = stub.of_type("custom-data")
    assert events[0]["data"] == {"best": "hello world", "generation": 3}
    assert "merge" not in events[0]
    assert events[1] == {
        "type": "custom-data",
        "data": {"tables": [1, 2]},
        "merge": False,
    }


# ---- spawn ↔ span attach ----------------------------------------------------------


def test_spawn_attaches_to_active_span(stub, tmp_path, monkeypatch):
    monkeypatch.setenv("PLATFORM_EXPERIMENT_ID", "exp-9")
    run_routes(stub)
    stub.routes[("POST", "/invocations")] = (201, {"id": "inv-1"})
    stub.routes[("GET", "/invocations/inv-1")] = (
        200,
        {"status": "done", "result": {"answer": 42}},
    )

    with x.Experiment("evolver", script_path=write_script(tmp_path)) as exp:
        produce = exp.stage("produce")
        with produce.run() as span:
            result = x.spawn(
                "make a thing", {"answer": "integer"}, template="claude-code"
            )

    assert result == {"answer": 42}
    spawn_bodies = [
        body
        for m, p, body in stub.requests
        if p.endswith("/invocations") and m == "POST"
    ]
    assert spawn_bodies[0]["experimentSpanId"] == f"exp-9/{span.span_id}"
    assert spawn_bodies[0]["templateId"] == "claude-code"
    assert spawn_bodies[0]["schema"]["properties"]["answer"] == {"type": "integer"}


def test_spawn_without_span_or_experiment(stub):
    stub.routes[("POST", "/invocations")] = (201, {"id": "inv-2"})
    stub.routes[("GET", "/invocations/inv-2")] = (200, {"status": "failed"})

    with pytest.raises(x.InvocationFailed):
        x.spawn("do it", "integer", image="some/image:1", poll_seconds=0.01)

    body = stub.requests[0][2]
    assert "experimentSpanId" not in body
    assert body["image"] == "some/image:1"
