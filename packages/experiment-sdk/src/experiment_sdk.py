"""Platform experiment SDK (#2942).

The full driver surface for experiment scripts, stdlib-only by design (it is
baked into every agent image; a dependency would have to be baked too):

- ``spawn`` / ``list_images`` / ``list_connections`` / ``require_image`` — the
  Invocation primitive, ported from the JS driver-sdk. Works standalone, no
  Experiment required.
- ``Experiment`` / ``Stage`` / ``Span`` — declare a skeleton, run the loop,
  report stage-tagged spans (status, score, artifact refs). A ``spawn`` made
  inside a span is attached to it automatically (contextvars).
- ``s`` — schema shorthand for spawn result schemas.

Self-configures from ``PLATFORM_MCP_URL`` (set on every agent pod); there is
no token — the mesh proves identity. Progress goes to stderr so the script's
own stdout stays clean.

Modes:

- **Plan** (``python exp.py --plan``, ``PLATFORM_EXPERIMENT_PLAN=1``, or
  simply running outside a launch context): declarations run, the skeleton
  plus a capture of this script are registered as a draft Experiment, and the
  process exits 0 before the loop body — press "Start a new run" in the UI to run it.
- **Run** (``PLATFORM_EXPERIMENT_ID`` set — the platform-composed launch prompt does
  this): the loop runs and every span streams to the platform.
"""

from __future__ import annotations

import contextvars
import hashlib
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any, Iterator

__all__ = [
    "Experiment",
    "ExperimentClosed",
    "InvocationFailed",
    "Loop",
    "Span",
    "Stage",
    "UnknownImage",
    "list_connections",
    "list_images",
    "require_image",
    "s",
    "spawn",
]

SCRIPT_CONTENT_MAX_BYTES = 256 * 1024
DASHBOARD_CONTENT_MAX_BYTES = 512 * 1024
_EVENT_FLUSH_MAX = 100
_EVENT_FLUSH_SECONDS = 2.0
_DEFAULT_POLL_SECONDS = 5.0
# Mirrors the server's ttl clamp (~1min..6h) plus a poll of slack.
_DEFAULT_SPAWN_TIMEOUT_S = 6 * 60 * 60 + 60


class ExperimentClosed(Exception):
    """The platform rejected a report: the experiment is no longer running
    (stopped, finished, or reaped). The loop should exit promptly."""


class UnknownImage(Exception):
    """``require_image`` was given a template id the catalog doesn't have.
    Raised at declaration time so ``--plan`` fails while the human is still
    reviewing the design, not hours into a run's first spawn."""

    def __init__(self, template_id: str, available: list[str]):
        super().__init__(
            f'unknown image "{template_id}" — available: {", ".join(sorted(available))}'
        )
        self.template_id = template_id
        self.available = available


class InvocationFailed(Exception):
    """A spawned invocation reported ``failed`` (silent exit past its
    liveness deadline, a target pod crash, or an internal error). ``reason``
    carries the platform's explanation when it has one — surface it: it is
    the only diagnosis that survives the target being reaped."""

    def __init__(self, invocation_id: str, label: str, reason: str | None = None):
        detail = f": {reason}" if reason else ""
        super().__init__(f"invocation {label} ({invocation_id}) failed{detail}")
        self.invocation_id = invocation_id
        self.reason = reason


def _log(msg: str) -> None:
    sys.stderr.write(f"[experiment] {msg}\n")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _config() -> tuple[str, str]:
    """Resolve (root_url, agent_id) from PLATFORM_MCP_URL, per call so tests
    can point the SDK at a stub server via the environment."""
    mcp_url = os.environ.get("PLATFORM_MCP_URL")
    if not mcp_url:
        raise RuntimeError(
            "PLATFORM_MCP_URL is not set — the experiment SDK only runs inside a platform agent pod."
        )
    m = re.match(r"^(https?://[^/]+)/api/agents/([^/]+)/mcp$", mcp_url)
    if not m:
        raise RuntimeError(f"unexpected PLATFORM_MCP_URL shape: {mcp_url}")
    base, agent_id = m.group(1), m.group(2)
    return f"{base}/api/agents/{agent_id}", agent_id


# 500 is transient here too: the api-server returns it while its own
# dependencies (postgres, redis) restart under it, which is exactly the
# outage the retry exists to ride out.
_TRANSIENT_HTTP = {500, 502, 503, 504}
_RETRY_ATTEMPTS = 4
_RETRY_BASE_DELAY_S = 1.0


def _request(
    method: str, path: str, body: Any | None = None, *, retry: bool | None = None
) -> Any:
    """One platform API call. GETs retry transient failures (5xx from a mesh
    hop or a mid-restart api-server, a reset connection) with exponential
    backoff: a long run polls the API thousands of times, and without the
    retry a single blip on any poll kills every remaining round. Non-GETs
    default to a single attempt and opt in per call site (``retry=True``):
    event reports, finish, and plan registration are idempotent on the
    server (spans upsert by id, a repeated finish answers 409), so they
    retry; ``spawn`` never does — a duplicated POST /invocations is a
    second worker, not a dup."""
    root, _ = _config()
    data = json.dumps(body).encode("utf-8") if body is not None else None
    if retry is None:
        retry = method == "GET"
    attempts = _RETRY_ATTEMPTS if retry else 1
    last_error: Exception | None = None
    for attempt in range(attempts):
        if attempt:
            time.sleep(_RETRY_BASE_DELAY_S * (2 ** (attempt - 1)))
        req = urllib.request.Request(
            f"{root}{path}",
            data=data,
            method=method,
            headers={"content-type": "application/json"} if data else {},
        )
        try:
            with urllib.request.urlopen(req) as res:
                text = res.read().decode("utf-8")
        except urllib.error.HTTPError as err:
            detail = err.read().decode("utf-8", errors="replace")
            if err.code == 409:
                raise ExperimentClosed(detail) from None
            last_error = RuntimeError(f"{method} {path} -> {err.code}: {detail}")
            if err.code in _TRANSIENT_HTTP and attempt + 1 < attempts:
                continue
            raise last_error from None
        except urllib.error.URLError as err:
            last_error = RuntimeError(f"{method} {path} failed: {err.reason}")
            if attempt + 1 < attempts:
                continue
            raise last_error from None
        return json.loads(text) if text else None
    raise last_error if last_error else RuntimeError(f"{method} {path} failed")


# ---- schema shorthand --------------------------------------------------------

_PRIMITIVES = {"string", "number", "integer", "boolean", "null"}
_SCHEMA_MARKERS = {
    "type",
    "properties",
    "items",
    "enum",
    "const",
    "$ref",
    "anyOf",
    "oneOf",
    "allOf",
}


def s(spec: Any) -> dict[str, Any]:
    """Expand shorthand into JSON Schema (mirrors the JS driver-sdk ``s``):

    ``s("integer")`` → ``{"type": "integer"}``;
    ``s({"pass": "boolean", "note": "string?"})`` → object, ``note`` optional;
    ``s(["string"])`` → array of strings; a dict that already looks like JSON
    Schema passes through; a pydantic model class/instance is accepted via
    duck typing (``model_json_schema``)."""
    schema_method = getattr(spec, "model_json_schema", None)
    if callable(schema_method):
        return schema_method()
    if isinstance(spec, str):
        if spec not in _PRIMITIVES:
            raise ValueError(
                f'unknown shorthand type "{spec}" — use one of {sorted(_PRIMITIVES)}, or pass raw JSON Schema.'
            )
        return {"type": spec}
    if isinstance(spec, (list, tuple)):
        return {"type": "array", "items": s(spec[0]) if spec else {}}
    if isinstance(spec, dict):
        if _SCHEMA_MARKERS & spec.keys():
            return spec
        properties: dict[str, Any] = {}
        required: list[str] = []
        for key, val in spec.items():
            if isinstance(val, str) and val.endswith("?"):
                properties[key] = s(val[:-1])
            else:
                properties[key] = s(val)
                required.append(key)
        return {
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": False,
        }
    raise ValueError(f"cannot interpret schema spec: {spec!r}")


def _s_enum(values: Any) -> dict[str, Any]:
    return {"enum": list(values)}


s.enum = _s_enum  # type: ignore[attr-defined]


# ---- driver surface (Invocations) --------------------------------------------


def list_images() -> list[dict[str, Any]]:
    """The image catalog an Invocation may run; pass an ``id`` as template."""
    return _request("GET", "/images")["images"]


def require_image(template_id: str) -> str:
    """Assert the catalog offers ``template_id`` and return it, for use as
    ``spawn(template=...)``.

    Call this in the declaration section, next to ``list_connections()``: the
    worker image is the loop's most consequential choice, and in plan mode the
    loop body never runs, so an id that doesn't exist would otherwise go
    unnoticed until a run's first spawn. Raises ``UnknownImage`` naming the ids
    that do exist.

        template = x.require_image("nous")
    """
    available = [str(i["id"]) for i in list_images()]
    if template_id not in available:
        raise UnknownImage(template_id, available)
    return template_id


def list_connections() -> list[dict[str, Any]]:
    """This driver's own connection grants — the spawnable subset."""
    return _request("GET", "/connections")["connections"]


def budget() -> dict[str, Any]:
    """The owner's compute budget, read live::

        {
          "cpu":    {"reservedMilli": 3000, "ceilingMilli": 6000},
          "memory": {"reservedBytes": ..., "ceilingBytes": ...},
          "defaultWorkerSize": {"cpu": "1", "memory": "1Gi"},
        }

    The ceiling caps the summed sizes of the owner's *running* agents —
    this driver included. Each catalog entry from ``list_images()`` carries
    its worker's ``size``; a raw ``image=`` spawn costs ``defaultWorkerSize``
    unless ``cpu=``/``memory=`` say otherwise. Use it while designing:
    ``(ceiling - reserved) / worker size``, floored over both dimensions,
    is how many workers run at once — further spawns queue for freed room
    (their wait burns the invocation TTL), and a single worker sized past
    the ceiling is rejected at ``spawn`` because it could never start.
    """
    return _request("GET", "/budget")


def spawn(
    prompt: str,
    schema: Any,
    *,
    template: str | None = None,
    image: str | None = None,
    connections: list[str] | None = None,
    ttl_ms: int | None = None,
    memory: str | None = None,
    cpu: str | None = None,
    label: str | None = None,
    span: "Span | None" = None,
    poll_seconds: float = _DEFAULT_POLL_SECONDS,
    timeout_seconds: float | None = None,
) -> Any:
    """Spawn an ephemeral Invocation and block until its schema-validated
    result. Inside a ``stage.run()`` block the invocation attaches to the
    active span automatically; pass ``span=`` explicitly for fan-out code.

    Targets are attenuated: they receive ONLY the ``connections`` you pass
    (ids from ``list_connections()``). A model-calling target (e.g. a
    claude-code worker) without its provider connection fails its first
    call and the invocation hangs until its liveness deadline.

    When the owner's resource budget is full, the target queues and starts
    automatically as room frees (e.g. earlier invocations completing) —
    the wait counts against the invocation's TTL, so over-budget fan-out
    degrades to sequential execution rather than failing.

    ``ttl_ms`` is a kill deadline, not pacing: the platform reaps the
    target the moment it lapses, even if the target is mid-work. Size it
    at the worst plausible round plus generous slack (target pod cold
    start alone takes minutes) — a generous TTL costs nothing when the
    round finishes early, a tight one destroys a working round."""
    if (template is None) == (image is None):
        raise ValueError("pass exactly one of template= or image=")
    name = label or template or image or "invocation"
    active = span if span is not None else _ACTIVE_SPAN.get(None)
    body: dict[str, Any] = {"prompt": prompt, "schema": s(schema)}
    if template is not None:
        body["templateId"] = template
    if image is not None:
        body["image"] = image
    if connections:
        body["connections"] = connections
    if ttl_ms is not None:
        body["ttlMs"] = ttl_ms
    if memory is not None:
        body["memory"] = memory
    if cpu is not None:
        body["cpu"] = cpu
    if active is not None:
        body["experimentSpanId"] = (
            f"{active.experiment._experiment_id}/{active.span_id}"
        )

    invocation_id = _request("POST", "/invocations", body)["id"]
    _log(f"spawned {name} ({invocation_id})")

    deadline = time.monotonic() + (
        timeout_seconds
        if timeout_seconds is not None
        else (ttl_ms / 1000 + 60 if ttl_ms else _DEFAULT_SPAWN_TIMEOUT_S)
    )
    while True:
        view = _request("GET", f"/invocations/{invocation_id}")
        status = view["status"]
        if status == "done":
            _log(f"{name} ({invocation_id}) done")
            return view.get("result")
        if status == "failed":
            raise InvocationFailed(invocation_id, name, view.get("errorReason"))
        if time.monotonic() > deadline:
            raise InvocationFailed(invocation_id, f"{name} (client timeout)")
        time.sleep(poll_seconds)


# ---- experiment observation ----------------------------------------------------

_ACTIVE_SPAN: contextvars.ContextVar["Span | None"] = contextvars.ContextVar(
    "experiment_active_span", default=None
)
_CURRENT_ITERATION: contextvars.ContextVar[int | None] = contextvars.ContextVar(
    "experiment_iteration", default=None
)


class Stage:
    def __init__(self, experiment: "Experiment", stage_id: str):
        self.id = stage_id
        self.experiment = experiment

    def run(self, iteration: int | None = None) -> "Span":
        """Open a span for one execution of this stage. Use as a context
        manager; set ``span.score`` before the block ends."""
        return self.experiment._open_span(self.id, iteration)


class Loop:
    def __init__(
        self,
        experiment: "Experiment",
        loop_id: str,
        description: str | None = None,
    ):
        self.id = loop_id
        self.description = description
        self.experiment = experiment
        self.stage_ids: list[str] = []

    def stage(
        self, stage_id: str, after: Any = None, description: str | None = None
    ) -> Stage:
        stage = self.experiment.stage(stage_id, after=after, description=description)
        self.stage_ids.append(stage_id)
        return stage


class Span:
    def __init__(self, experiment: "Experiment", span_id: str, stage: str):
        self.experiment = experiment
        self.span_id = span_id
        self.stage = stage
        self.score: float | None = None
        self.attrs: dict[str, Any] = {}
        self._artifact_ids: list[str] = []
        self._token: contextvars.Token | None = None

    def artifact(self, artifact_id: str) -> None:
        """Reference an Artifact Library id this span produced."""
        self._artifact_ids.append(artifact_id)

    def __enter__(self) -> "Span":
        self._token = _ACTIVE_SPAN.set(self)
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        if self._token is not None:
            _ACTIVE_SPAN.reset(self._token)
        end: dict[str, Any] = {
            "type": "span-end",
            "spanId": self.span_id,
            "status": "error" if exc_type is not None else "ok",
            "ts": _now_iso(),
        }
        if self.score is not None:
            end["score"] = float(self.score)
        if self._artifact_ids:
            end["artifactIds"] = self._artifact_ids
        if self.attrs:
            end["attrs"] = self.attrs
        self.experiment._emit(end, flush=True)
        # Never swallow the script's own exception.


class Experiment:
    """Declare, then run. Declarations (``loop``/``stage``) build the
    skeleton; the first ``iterations()``/``run()``/span registers the plan (in
    plan mode: registers and exits 0). Use as a context manager so an
    unhandled exception reports ``failed`` and a clean fall-through reports
    ``completed``."""

    def __init__(
        self,
        name: str,
        script_path: str | None = None,
        dashboard_path: str | None = None,
    ):
        self.name = name
        self._script_path = os.path.abspath(script_path or sys.argv[0])
        # A bespoke dashboard is just an HTML file next to the script:
        # captured at plan registration like the script itself (the platform
        # creates or re-versions the draft's dashboard artifact from it).
        # Relative paths resolve against the script's directory.
        self._dashboard_path = (
            os.path.join(os.path.dirname(self._script_path), dashboard_path)
            if dashboard_path and not os.path.isabs(dashboard_path)
            else dashboard_path
        )
        self._stages: list[dict[str, Any]] = []
        self._loops: list[Loop] = []
        self._declared: set[str] = set()
        self._experiment_id: str | None = None
        self._ready = False
        self._finished = False
        self._span_counter = 0
        self._heartbeat_stop: threading.Event | None = None
        self._buffer: list[dict[str, Any]] = []
        self._last_flush = time.monotonic()

    # -- declaration ------------------------------------------------------------

    def loop(self, loop_id: str, description: str | None = None) -> Loop:
        loop = Loop(self, loop_id, description)
        self._loops.append(loop)
        return loop

    def stage(
        self, stage_id: str, after: Any = None, description: str | None = None
    ) -> Stage:
        """Declare a stage. ``description`` is one human sentence — what
        happens in this stage and what it reports — shown on the stage's node
        in the live graph, so a reviewer can read the design off the UI."""
        if after is None:
            after_ids: list[str] = []
        elif isinstance(after, (list, tuple)):
            after_ids = [a.id if isinstance(a, Stage) else str(a) for a in after]
        else:
            after_ids = [after.id if isinstance(after, Stage) else str(after)]
        if stage_id not in self._declared:
            self._declared.add(stage_id)
            entry: dict[str, Any] = {"id": stage_id, "after": after_ids}
            if description:
                entry["description"] = description
            self._stages.append(entry)
        return Stage(self, stage_id)

    def _skeleton(self) -> dict[str, Any]:
        return {
            "stages": self._stages,
            "loops": [
                {"id": loop.id, "stages": loop.stage_ids}
                | ({"description": loop.description} if loop.description else {})
                for loop in self._loops
                if loop.stage_ids
            ],
        }

    # -- registration -----------------------------------------------------------

    def _script_capture(self) -> dict[str, Any]:
        with open(self._script_path, "rb") as f:
            raw = f.read()
        if len(raw) > SCRIPT_CONTENT_MAX_BYTES:
            raise RuntimeError(
                f"script {self._script_path} exceeds the {SCRIPT_CONTENT_MAX_BYTES // 1024} KiB capture cap"
            )
        return {
            "path": self._script_path,
            "sha256": hashlib.sha256(raw).hexdigest(),
            "content": raw.decode("utf-8", errors="replace"),
        }

    def ready(self) -> None:
        """Register the plan (plan mode: then exit 0) or announce the run.
        Called implicitly by ``iterations()`` and the first span."""
        if self._ready:
            return
        run_id = os.environ.get("PLATFORM_EXPERIMENT_ID")
        script = self._script_capture()
        if run_id:
            self._experiment_id = run_id
            self._ready = True
            self._emit(
                {
                    "type": "run-start",
                    "scriptSha256": script["sha256"],
                    "scriptContent": script["content"],
                },
                flush=True,
            )
            self._start_heartbeat()
            _log(f'experiment "{self.name}" running as {run_id}')
            return
        # No run context (PLATFORM_EXPERIMENT_ID absent): register (or refresh) the draft and stop —
        # whether invoked as `--plan` or just run by hand.
        plan: dict[str, Any] = {
            "name": self.name,
            "skeleton": self._skeleton(),
            "script": script,
        }
        if self._dashboard_path:
            with open(self._dashboard_path, "rb") as f:
                raw = f.read()
            if len(raw) > DASHBOARD_CONTENT_MAX_BYTES:
                raise RuntimeError(
                    f"dashboard {self._dashboard_path} exceeds the "
                    f"{DASHBOARD_CONTENT_MAX_BYTES // 1024} KiB capture cap"
                )
            plan["dashboard"] = {"content": raw.decode("utf-8", errors="replace")}
        response = _request("POST", "/experiments/plan", plan, retry=True)
        _log(
            f'plan registered for "{self.name}" ({response["experimentId"]}) — press "Start a new run" in the UI to run it'
        )
        sys.exit(0)

    # -- run --------------------------------------------------------------------

    def iterations(
        self, loop: Loop | None = None, max_iterations: int | None = None
    ) -> Iterator[int]:
        """Yield 0, 1, 2, … — break out whenever the loop is done. Spans opened
        inside pick up the current iteration automatically."""
        self.ready()
        i = 0
        while max_iterations is None or i < max_iterations:
            token = _CURRENT_ITERATION.set(i)
            try:
                yield i
            finally:
                _CURRENT_ITERATION.reset(token)
            i += 1

    def span(self, stage_id: str, iteration: int | None = None) -> Span:
        """Ad-hoc span for a stage that was never declared (the lenient drift
        path): the platform grows the graph and flags the stage as drift."""
        if stage_id not in self._declared:
            self._declared.add(stage_id)
            self._emit({"type": "stage-declare", "stage": stage_id})
        return self._open_span(stage_id, iteration)

    def _open_span(self, stage_id: str, iteration: int | None) -> Span:
        self.ready()
        self._span_counter += 1
        span = Span(self, f"{stage_id}-{self._span_counter}", stage_id)
        effective_iteration = (
            iteration if iteration is not None else _CURRENT_ITERATION.get(None)
        )
        start: dict[str, Any] = {
            "type": "span-start",
            "spanId": span.span_id,
            "stage": stage_id,
            "ts": _now_iso(),
        }
        if effective_iteration is not None:
            start["iteration"] = effective_iteration
        parent = _ACTIVE_SPAN.get(None)
        if parent is not None:
            start["parentSpanId"] = parent.span_id
        # Flush immediately, like span-end: a long stage (a spawn, a slow
        # eval) must show as live in the UI while it runs, not appear only
        # once it ends.
        self._emit(start, flush=True)
        return span

    def post_data(self, data: dict[str, Any], merge: bool = True) -> None:
        """Surface arbitrary run-level data to the dashboard (``feed.custom``):
        the best candidate so far, extra series, tables — anything JSON. By
        default shallow-merges into the run's blob; ``merge=False`` replaces
        it. Baked into the final snapshot like everything else."""
        self.ready()
        event: dict[str, Any] = {"type": "custom-data", "data": data}
        if not merge:
            event["merge"] = False
        self._emit(event, flush=True)

    def _start_heartbeat(self) -> None:
        """Liveness pings on a dedicated daemon thread with its OWN request
        path — never the shared event buffer — so a main thread parked in a
        blocking ``spawn()`` or a long local computation cannot delay it.
        The thread dies with the process, which is exactly the signal: the
        platform's inactivity sweep reaps runs whose clock stops, and the
        heartbeat keeps a healthy-but-quiet loop off its list."""
        self._heartbeat_stop = threading.Event()

        def loop() -> None:
            interval = float(
                os.environ.get("PLATFORM_EXPERIMENT_HEARTBEAT_SECONDS") or 60
            )
            while not self._heartbeat_stop.wait(interval):
                try:
                    _request(
                        "POST",
                        f"/experiments/{self._experiment_id}/events",
                        {"events": [{"type": "heartbeat"}]},
                    )
                except ExperimentClosed:
                    break  # trace closed (Stop or terminal) — nothing to keep alive
                except Exception:  # noqa: BLE001 — transient; retry next tick
                    continue

        thread = threading.Thread(target=loop, name="experiment-heartbeat", daemon=True)
        thread.start()

    def finish(self, status: str = "completed", error: str | None = None) -> None:
        if self._finished or self._experiment_id is None:
            return
        self._finished = True
        if self._heartbeat_stop is not None:
            self._heartbeat_stop.set()
        body: dict[str, Any] = {"status": status}
        if error:
            body["error"] = error[:2000]
        try:
            self._flush(force=True)
            _request(
                "POST", f"/experiments/{self._experiment_id}/finish", body, retry=True
            )
        except ExperimentClosed:
            # Already terminal on the platform (stopped by the user, or a
            # retried finish whose first attempt landed) — nothing to report.
            _log(f'experiment "{self.name}" was already closed on the platform')
            return
        _log(f'experiment "{self.name}" finished: {status}')

    def __enter__(self) -> "Experiment":
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        if exc_type is SystemExit:
            return  # plan mode exits through here; nothing to report
        if exc_type is not None:
            try:
                self.finish("failed", error=f"{exc_type.__name__}: {exc}")
            except Exception as report_err:  # noqa: BLE001
                _log(f"failed-report did not land: {report_err}")
            return  # re-raise the script's own exception
        self.finish("completed")

    # -- event transport ----------------------------------------------------------

    def _emit(self, event: dict[str, Any], flush: bool = False) -> None:
        self._buffer.append(event)
        stale = time.monotonic() - self._last_flush > _EVENT_FLUSH_SECONDS
        if flush or stale or len(self._buffer) >= _EVENT_FLUSH_MAX:
            self._flush(force=True)

    def _flush(self, force: bool = False) -> None:
        """Report buffered events; the buffer is drained only once the POST
        lands. Reports are observability, so a transient outage costs
        latency, never the run: on failure the events stay buffered (the next
        emit retries them) and the caller — often ``Span.__exit__`` — is not
        killed. ``ExperimentClosed`` still propagates: the run was stopped on
        the platform and the loop should exit promptly."""
        if not self._buffer or self._experiment_id is None:
            return
        if not force and len(self._buffer) < _EVENT_FLUSH_MAX:
            return
        events = list(self._buffer)
        try:
            _request(
                "POST",
                f"/experiments/{self._experiment_id}/events",
                {"events": events},
                retry=True,
            )
        except ExperimentClosed:
            raise
        except Exception as err:  # noqa: BLE001 — kept buffered; next emit retries
            _log(f"event report failed, {len(events)} event(s) kept for retry: {err}")
            return
        self._buffer = self._buffer[len(events) :]
        self._last_flush = time.monotonic()
