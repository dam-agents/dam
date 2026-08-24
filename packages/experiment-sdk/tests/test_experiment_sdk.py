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


def test_plan_carries_stage_and_loop_descriptions(stub, tmp_path):
    """Descriptions declared on loops/stages ride the skeleton to the plan, so
    the live graph can show what each node means; nodes without one stay bare."""
    script = write_script(tmp_path, "loop body never runs\n")
    stub.routes[("POST", "/experiments/plan")] = (201, {"experimentId": "exp-1"})

    exp = x.Experiment("evolver", script_path=script)
    loop = exp.loop("rounds", description="one optimization attempt per round")
    produce = loop.stage("produce", description="a worker rewrites the source")
    loop.stage("eval", after=produce)

    with pytest.raises(SystemExit):
        next(exp.iterations(loop))

    _method, _path, body = stub.requests[-1]
    stages = body["skeleton"]["stages"]
    assert stages[0]["description"] == "a worker rewrites the source"
    assert "description" not in stages[1]
    assert body["skeleton"]["loops"][0]["description"] == (
        "one optimization attempt per round"
    )


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


def test_spawn_failure_surfaces_the_platform_reason(stub):
    # The platform's errorReason (deadline, pod crash, stop) is the only
    # diagnosis that survives the target being reaped — it must reach the
    # exception text, not just the row.
    stub.routes[("POST", "/invocations")] = (201, {"id": "inv-3"})
    stub.routes[("GET", "/invocations/inv-3")] = (
        200,
        {
            "status": "failed",
            "errorReason": "target pod restarted (OutOfMemory); one-shot turn cannot resume",
        },
    )

    with pytest.raises(x.InvocationFailed) as exc:
        x.spawn("do it", "integer", image="some/image:1", poll_seconds=0.01)

    assert "OutOfMemory" in str(exc.value)
    assert exc.value.reason is not None


def test_spawn_failure_without_a_reason_stays_bare(stub):
    # An older api-server (no errorReason on the view) must not render
    # "failed: None".
    stub.routes[("POST", "/invocations")] = (201, {"id": "inv-4"})
    stub.routes[("GET", "/invocations/inv-4")] = (200, {"status": "failed"})

    with pytest.raises(x.InvocationFailed) as exc:
        x.spawn("do it", "integer", image="some/image:1", poll_seconds=0.01)

    assert str(exc.value).endswith("failed")
    assert exc.value.reason is None


# ---- image choice ----------------------------------------------------------------

CATALOG = (
    200,
    {
        "images": [
            {"id": "claude-code", "name": "Claude Code", "description": "general"},
            {"id": "nous", "name": "NOUS", "description": "campaigns"},
        ]
    },
)


def test_require_image_returns_the_id_when_the_catalog_has_it(stub):
    stub.routes[("GET", "/images")] = CATALOG

    assert x.require_image("nous") == "nous"


def test_require_image_rejects_an_unknown_id_and_names_the_real_ones(stub):
    stub.routes[("GET", "/images")] = CATALOG

    with pytest.raises(x.UnknownImage) as caught:
        x.require_image("nous-agent")

    assert caught.value.template_id == "nous-agent"
    assert caught.value.available == ["claude-code", "nous"]
    assert "claude-code, nous" in str(caught.value)


def test_budget_reads_the_owner_figures(stub):
    stub.routes[("GET", "/budget")] = (
        200,
        {
            "cpu": {"reservedMilli": 3000, "ceilingMilli": 6000},
            "memory": {
                "reservedBytes": 4 * 1024**3,
                "ceilingBytes": 14 * 1024**3,
            },
            "defaultWorkerSize": {"cpu": "1", "memory": "1Gi"},
        },
    )

    figures = x.budget()

    assert figures["cpu"]["ceilingMilli"] == 6000
    assert figures["memory"]["reservedBytes"] == 4 * 1024**3
    assert figures["defaultWorkerSize"] == {"cpu": "1", "memory": "1Gi"}


def test_event_report_outage_is_survived_and_events_redeliver(
    stub, tmp_path, monkeypatch
):
    monkeypatch.setenv("PLATFORM_EXPERIMENT_ID", "exp-9")
    monkeypatch.setattr(x.time, "sleep", lambda _s: None)
    stub.routes[("POST", "/finish")] = (200, {"ok": True})
    outage = {"on": False}

    def events_route(body):
        if outage["on"]:
            return (500, {"error": "db restarting"})
        return (200, {"accepted": len(body["events"])})

    stub.routes[("POST", "/events")] = events_route

    with x.Experiment("evolver", script_path=write_script(tmp_path)) as exp:
        stage = exp.stage("eval")
        exp.ready()
        outage["on"] = True
        with stage.run() as span:
            span.score = 1.0
        outage["on"] = False
        with stage.run() as span:
            span.score = 2.0

    batches = [
        body["events"]
        for method, path, body in stub.requests
        if method == "POST"
        and path.endswith("/events")
        and any(e["type"] != "heartbeat" for e in body["events"])
    ]
    redelivery = [
        b
        for b in batches
        if [e["type"] for e in b] == ["span-start", "span-end", "span-start"]
    ]
    assert len(redelivery) == 1
    assert redelivery[0][1]["score"] == 1.0
    _method, path, body = stub.requests[-1]
    assert path.endswith("/finish") and body == {"status": "completed"}


def test_finish_retries_a_transient_failure(stub, tmp_path, monkeypatch):
    monkeypatch.setenv("PLATFORM_EXPERIMENT_ID", "exp-9")
    monkeypatch.setattr(x.time, "sleep", lambda _s: None)
    stub.routes[("POST", "/events")] = (200, {"accepted": 1})
    finish_calls = []

    def finish_route(body):
        finish_calls.append(body)
        if len(finish_calls) == 1:
            return (503, {"error": "blip"})
        return (200, {"ok": True})

    stub.routes[("POST", "/finish")] = finish_route

    with x.Experiment("evolver", script_path=write_script(tmp_path)) as exp:
        exp.ready()

    assert len(finish_calls) == 2
    assert finish_calls[-1] == {"status": "completed"}


def test_finish_treats_409_as_already_closed(stub, tmp_path, monkeypatch):
    monkeypatch.setenv("PLATFORM_EXPERIMENT_ID", "exp-9")
    stub.routes[("POST", "/events")] = (200, {"accepted": 1})
    stub.routes[("POST", "/finish")] = (409, {"error": "stopped"})

    with x.Experiment("evolver", script_path=write_script(tmp_path)) as exp:
        exp.ready()

    finishes = [r for r in stub.requests if r[1].endswith("/finish")]
    assert len(finishes) == 1
