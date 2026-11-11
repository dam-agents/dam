"""Platform driver SDK: spawn sub-agents and await their results.

Stdlib-only by design (it is baked into every agent image; a dependency would
have to be baked too). The Python twin of ``/usr/local/lib/driver-sdk.mjs``:

- ``spawn`` starts a sub-agent on a harness and blocks until its
  schema-validated result. It takes the same setup a starter kit applies:
  ``image``, ``seed``, ``install``, ``env``, ``resources``, ``skills``.
  The sub-agent runs on this driver's provider.
- ``spawn_script`` runs a shell command on a sub-agent set up the same way,
  with no model turn, and returns its exit code, stdout and stderr byte for
  byte.
- ``spawn_slate`` starts a clean slate that runs nothing until
  ``SubAgent.run`` or ``run_script``; enter it meanwhile with ``ssh sub-<id>``.
  ``sub_agent(id)`` is a handle on one spawned with ``keep``.
- ``spawn`` and ``spawn_script`` take ``cancel``, a ``threading.Event``: set
  it to stop the sub-agent, which raises ``Stopped``. ``SubAgent.stop`` stops
  a clean slate or a kept one.
- ``list_images`` / ``list_connections`` read what a spawn can use.
- ``s`` is shorthand for result schemas.

Self-configures from ``PLATFORM_MCP_URL`` (set on every agent's machine); there is no
token, the mesh proves identity. Progress goes to stderr so the script's own
stdout stays clean.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

__all__ = [
    "InvocationFailed",
    "ScriptFailed",
    "ScriptOutput",
    "Stopped",
    "SubAgent",
    "list_connections",
    "list_images",
    "s",
    "spawn",
    "spawn_script",
    "spawn_slate",
    "sub_agent",
]

_DEFAULT_POLL_SECONDS = 5.0
_SCRIPT_STOP_REASON = "its script aborted the spawn"
_MAX_STOP_REASON_CHARS = 500
# A sub-agent may wait up to its ttl for room to start, then has its whole
# ttl for the work: twice the ttl (the server's default is 1h) plus the
# liveness sweep's period and a few polls of slack.
_DEFAULT_TTL_S = 60 * 60
_TIMEOUT_SLACK_S = 5 * 60


class InvocationFailed(Exception):
    """A spawned sub-agent failed: its seed or install failed, it crashed, it
    missed its deadline, or its driver chain went away. ``reason`` is the
    platform's explanation; surface it, since the sub-agent is deleted as soon
    as it fails."""

    def __init__(self, invocation_id: str, label: str, reason: str | None = None):
        detail = f": {reason}" if reason else ""
        super().__init__(f"invocation {label} ({invocation_id}) failed{detail}")
        self.invocation_id = invocation_id
        self.reason = reason


class Stopped(Exception):
    """A spawn whose ``cancel`` event was set: the sub-agent, and every
    sub-agent it started in turn, was stopped before it ended."""

    def __init__(self, invocation_id: str | None, label: str):
        which = f"{label} ({invocation_id})" if invocation_id else label
        super().__init__(f"invocation {which} stopped")
        self.invocation_id = invocation_id


def _log(msg: str) -> None:
    sys.stderr.write(f"[invoke] {msg}\n")


def _config() -> str:
    mcp_url = os.environ.get("PLATFORM_MCP_URL")
    if not mcp_url:
        raise RuntimeError(
            "PLATFORM_MCP_URL is not set — the driver SDK only runs inside a platform agent's machine."
        )
    m = re.match(r"^(https?://[^/]+)/api/agents/([^/]+)/mcp$", mcp_url)
    if not m:
        raise RuntimeError(f"unexpected PLATFORM_MCP_URL shape: {mcp_url}")
    return f"{m.group(1)}/api/agents/{m.group(2)}"


# 500 is transient too: the api-server returns it while postgres or redis
# restart under it.
_TRANSIENT_HTTP = {500, 502, 503, 504}
_RETRY_ATTEMPTS = 4
_RETRY_BASE_DELAY_S = 1.0


_SESSION_REF_VAR = "PLATFORM_SESSION_REF"
_SESSION_ID_VARS = (
    "HARNESS_SESSION_ID",
    "CLAUDE_CODE_SESSION_ID",
    "CODEX_THREAD_ID",
    "PI_SESSION_ID",
)


def _spawning_session_headers() -> dict[str, str]:
    """The driver's session this script runs in, as the harness put it in the
    script's environment, so a spawn records it and its sub-agent shows only
    in that session's chat. Pi hands its chat sessions a session ref; every
    harness, and a terminal, sets a session id on its shell commands, the
    platform's own variable first. A blank value names nothing: Pi sets a
    blank ref outside a chat session."""
    headers: dict[str, str] = {}
    ref = os.environ.get(_SESSION_REF_VAR, "").strip()
    if ref:
        headers["x-platform-session-ref"] = ref
    session_id = next(
        (v for v in (os.environ.get(n, "").strip() for n in _SESSION_ID_VARS) if v),
        None,
    )
    if session_id:
        headers["x-platform-session-id"] = session_id
    return headers


def _log_egress(outcome: Any, target: str) -> None:
    """Say which egress rules the platform did not set, so a script that goes
    on does not find out from a refused connection."""
    for waiting in (outcome or {}).get("waitingForOwner") or []:
        _log(
            f"egress: {waiting['host']} waits for your owner's approval "
            f"(request {waiting['id']}); {target} cannot reach it until then"
        )
    for blocked in (outcome or {}).get("blockedByOwner") or []:
        _log(
            f"egress: your owner blocked {blocked['host']} on {target}; "
            "the rule allowing it was not set"
        )


def _spawned(res: dict[str, Any]) -> str:
    _log_egress({"waitingForOwner": res.get("egressWaitingForOwner")}, res["id"])
    return res["id"]


def _request(
    method: str,
    path: str,
    body: Any | None = None,
    headers: dict[str, str] | None = None,
) -> Any:
    """One platform call. GETs retry transient failures with backoff, since a
    long run polls thousands of times. A POST is sent once: a duplicated
    POST /invocations is a second sub-agent, not a duplicate."""
    root = _config()
    data = json.dumps(body).encode("utf-8") if body is not None else None
    attempts = _RETRY_ATTEMPTS if method == "GET" else 1
    last_error: Exception | None = None
    for attempt in range(attempts):
        if attempt:
            time.sleep(_RETRY_BASE_DELAY_S * (2 ** (attempt - 1)))
        req = urllib.request.Request(
            f"{root}{path}",
            data=data,
            method=method,
            headers={
                **({"content-type": "application/json"} if data else {}),
                **(headers or {}),
            },
        )
        try:
            with urllib.request.urlopen(req) as res:
                text = res.read().decode("utf-8")
        except urllib.error.HTTPError as err:
            detail = err.read().decode("utf-8", errors="replace")
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


def list_images() -> list[dict[str, Any]]:
    """The harnesses a sub-agent may run on, each with its ``harness`` name;
    pass the name as ``harness=``."""
    return _request("GET", "/images")["images"]


def list_connections() -> list[dict[str, Any]]:
    """This driver's own connection grants: the ones a spawn may pass on."""
    return _request("GET", "/connections")["connections"]


def _target_body(
    *,
    harness: str | None,
    image: str | None,
    connections: list[str] | str | None,
    egress: Any | None = None,
    keep: bool = False,
    keep_for_ms: int | None = None,
    idle_timeout_min: int | None = None,
    seed: dict[str, Any] | None,
    install: str | None,
    env: dict[str, str] | None,
    resources: dict[str, str] | None,
    skills: list[dict[str, str]] | None,
    ttl_ms: int | None,
    label: str | None,
) -> dict[str, Any]:
    if harness is None and image is None:
        raise ValueError("pass harness= (or image=)")
    body: dict[str, Any] = {}
    if harness is not None:
        body["harness"] = harness
    if image is not None:
        body["image"] = image
    if label is not None:
        body["label"] = label
    if connections is not None:
        body["connections"] = connections
    if egress is not None:
        body["egress"] = egress
    if keep:
        body["keep"] = True
    if keep_for_ms is not None:
        body["keepForMs"] = keep_for_ms
    if idle_timeout_min is not None:
        body["idleTimeoutMin"] = idle_timeout_min
    if seed is not None:
        body["seed"] = seed
    if install is not None:
        body["install"] = {"command": install}
    if env:
        body["env"] = [{"name": k, "value": v} for k, v in env.items()]
    if resources is not None:
        body["resources"] = resources
    if skills:
        body["skills"] = skills
    if ttl_ms is not None:
        body["ttlMs"] = ttl_ms
    return body


def _segment(id_: str) -> str:
    """A sub-agent or run id as one path segment; a run id holds colons."""
    return urllib.parse.quote(id_, safe="")


def _await(
    invocation_id: str,
    name: str,
    *,
    ttl_ms: int | None,
    poll_seconds: float,
    timeout_seconds: float | None,
    cancel: threading.Event | None = None,
    cancel_reason: str | None = None,
) -> dict[str, Any]:
    deadline = time.monotonic() + (
        timeout_seconds
        if timeout_seconds is not None
        else 2 * (ttl_ms / 1000 if ttl_ms else _DEFAULT_TTL_S) + _TIMEOUT_SLACK_S
    )
    waiting = None
    while True:
        if cancel is not None and cancel.is_set():
            _stop(invocation_id, cancel_reason)
            _log(f"stopped {name} ({invocation_id})")
            raise Stopped(invocation_id, name)
        view = _request("GET", f"/invocations/{_segment(invocation_id)}")
        if view["status"] in ("done", "failed"):
            return view
        if view.get("waiting") != waiting:
            waiting = view.get("waiting")
            if waiting:
                _log(f"{name} ({invocation_id}) waits for room to start: {waiting}")
        if time.monotonic() > deadline:
            raise InvocationFailed(invocation_id, f"{name} (client timeout)")
        if cancel is not None:
            cancel.wait(poll_seconds)
        else:
            time.sleep(poll_seconds)


def _stop(invocation_id: str, reason: str | None = None) -> bool:
    reason = reason.strip()[:_MAX_STOP_REASON_CHARS].strip() if reason else None
    body = {"reason": reason} if reason else {}
    return _request("POST", f"/invocations/{_segment(invocation_id)}/stop", body)[
        "stopped"
    ]


def spawn(
    prompt: str,
    schema: Any,
    *,
    harness: str | None = None,
    image: str | None = None,
    connections: list[str] | str | None = None,
    egress: Any | None = None,
    keep: bool = False,
    keep_for_ms: int | None = None,
    idle_timeout_min: int | None = None,
    on_spawned: Any | None = None,
    seed: dict[str, Any] | None = None,
    install: str | None = None,
    env: dict[str, str] | None = None,
    resources: dict[str, str] | None = None,
    skills: list[dict[str, str]] | None = None,
    ttl_ms: int | None = None,
    model: str | None = None,
    mode: str | None = None,
    config_options: dict[str, str] | None = None,
    label: str | None = None,
    poll_seconds: float = _DEFAULT_POLL_SECONDS,
    timeout_seconds: float | None = None,
    cancel: threading.Event | None = None,
    cancel_reason: str | None = None,
) -> Any:
    """Spawn a sub-agent and block until its schema-validated result.

    Pass ``harness`` (a name from ``list_images()``, such as ``"claude-code"``):
    the sub-agent runs on that harness's template. ``image`` (a full ref)
    runs that image instead, the way a starter kit with its own image does;
    ``harness`` then names the harness inside it.

    The sub-agent is set up the way a starter kit sets up an agent:
    ``seed={"url": ..., "ref": ..., "commit": ..., "into": "work"}`` clones a
    repository, ``install="..."`` runs a shell command in the workspace before
    the prompt, ``env={"NAME": "value"}``, ``resources={"storage": "10Gi"}``,
    and ``skills=[{"source": ..., "name": ...}]``. A failed seed or install
    fails the spawn at once with its reason.

    The sub-agent runs on this driver's model provider. ``connections`` says
    which of this driver's connections it holds: ``"none"`` (the default),
    only its model; ``"parent"``, all of them, granted and revoked with the
    driver's own; or a list of ids from ``list_connections()``, copied once.
    ``egress`` says whose rules decide its requests: ``"parent"`` (the
    default), the rules of this driver's root agent, live, except the hosts of
    its own model provider, which pass over them; ``"open"`` or
    ``{"open": [rules]}``, rules this driver sets (``SubAgent.set_egress``)
    with no prompt and anything else denied, except an allow rule to a
    wildcard host, or one that lets through a request the driver's own rules
    do not allow (its host, port, method or path) while the owner has not let
    its sub-agents and Environments have network access of their own: such a
    rule is not set, waits for the owner's approval, and is logged at the
    spawn; or ``{"scoped": [hosts]}``, a copy of the driver's rules for those
    hosts that only the user widens. With ``keep=True`` it outlives its result
    asleep until ``keep_for_ms`` (a day by default), sleeping after
    ``idle_timeout_min`` minutes idle (the install's default otherwise), so it
    can be entered over ``ssh sub-<id>`` or given more runs (``sub_agent(id)``);
    ``on_spawned`` gets its id at once. Its own Environments go with it when it is removed.

    ``ttl_ms`` is a kill deadline, not pacing: the platform removes the
    sub-agent the moment it lapses, mid-work or not. It runs from the
    sub-agent's start: a sub-agent that waits for room to start waits up to
    ``ttl_ms`` more, and the default client timeout covers both. ``label`` names the
    sub-agent, in this script's log lines and on the platform.

    ``model``, ``mode`` and ``config_options`` choose the sub-agent's harness
    config. ``model`` names a model with its provider, as the Config panel
    lists it (``model="ibm/aws/claude-haiku-4-5"``; Claude Code's own
    ``claude/ibm/...`` spelling is accepted too); a bare name such as
    ``"sonnet"`` is refused. ``config_options`` takes the values the panel
    offers (``{"effort": "low"}``). They are written before its first turn. A
    model the sub-agent's harness does not list on this agent is refused
    before anything is created; a setting the harness cannot apply fails the
    spawn once the sub-agent boots. Omit ``model`` to run on this agent's
    default model, on the harness that default runs on; on any other
    harness, or with no default, the spawn is refused.

    Set ``cancel`` (a ``threading.Event``) from another thread to stop the
    sub-agent, and every sub-agent it started in turn, before it ends: the
    call raises ``Stopped``, and an event set before the call spawns nothing.
    ``cancel_reason`` is the stop's reason, which the user reads; a spawn with
    ``keep``, which is stopped only with a reason, says its script aborted it
    when none is given."""
    body = _target_body(
        harness=harness,
        image=image,
        connections=connections,
        egress=egress,
        keep=keep,
        keep_for_ms=keep_for_ms,
        idle_timeout_min=idle_timeout_min,
        seed=seed,
        install=install,
        env=env,
        resources=resources,
        skills=skills,
        ttl_ms=ttl_ms,
        label=label,
    )
    name = label or harness or image or "invocation"
    body["prompt"] = prompt
    body["schema"] = s(schema)
    harness_config: dict[str, Any] = {}
    if model is not None:
        harness_config["model"] = model
    if mode is not None:
        harness_config["mode"] = mode
    if config_options:
        harness_config["configOptions"] = config_options
    if harness_config:
        body["harnessConfig"] = harness_config

    if cancel is not None and cancel.is_set():
        raise Stopped(None, name)
    invocation_id = _spawned(
        _request("POST", "/invocations", body, _spawning_session_headers())
    )
    _log(f"spawned {name} ({invocation_id})")
    if on_spawned is not None:
        on_spawned(invocation_id)

    view = _await(
        invocation_id,
        name,
        ttl_ms=ttl_ms,
        poll_seconds=poll_seconds,
        timeout_seconds=timeout_seconds,
        cancel=cancel,
        cancel_reason=cancel_reason or (_SCRIPT_STOP_REASON if keep else None),
    )
    if view["status"] == "failed":
        raise InvocationFailed(invocation_id, name, view.get("errorReason"))
    _log(f"{name} ({invocation_id}) done")
    return view.get("result")


class SubAgent:
    """A sub-agent this driver works in rather than fires once: spawned by
    ``spawn_slate`` as a clean slate that runs nothing, entered over the link
    (``ssh sub-<id>``, ``scp``) to put files in and take them out, and given
    runs, a prompt with its schema or a script, each on the same machine with
    its files. Without keep it is removed after its first result; with keep it
    takes runs until its keep expiry, which ``keep`` moves. Its own
    Environments go with it when it is removed. A kept one takes several runs
    at once (from threads), each awaited on its own. A prompt run continues the
    conversation of the latest prompt run unless it names another ``session``
    (``last_session`` holds the one each run ran in), or ``"new"`` for a fresh
    one."""

    last_session: str | None = None

    def __init__(self, invocation_id: str, name: str | None = None):
        self.id = invocation_id
        self._name = name or invocation_id

    def _start(
        self,
        body: dict[str, Any],
        ttl_ms: int | None,
        poll_seconds: float,
        timeout_seconds: float | None,
    ) -> dict[str, Any]:
        if ttl_ms is not None:
            body["ttlMs"] = ttl_ms
        run = _request("POST", f"/invocations/{_segment(self.id)}/run", body)["run"]
        _log(f"run {run} started in {self._name} ({self.id})")
        return _await(
            run,
            self._name,
            ttl_ms=ttl_ms,
            poll_seconds=poll_seconds,
            timeout_seconds=timeout_seconds,
        )

    def run(
        self,
        prompt: str,
        schema: Any,
        *,
        model: str | None = None,
        session: str | None = None,
        ttl_ms: int | None = None,
        poll_seconds: float = _DEFAULT_POLL_SECONDS,
        timeout_seconds: float | None = None,
    ) -> Any:
        """Run a prompt in this sub-agent and block until its schema-validated
        result. ``model`` names the model as ``spawn`` takes it; this agent's
        default model on the sub-agent's harness otherwise. ``session`` picks
        the conversation it continues, as described on the class."""
        body: dict[str, Any] = {"prompt": prompt, "schema": s(schema)}
        if model is not None:
            body["model"] = model
        if session is not None:
            body["session"] = session
        view = self._start(body, ttl_ms, poll_seconds, timeout_seconds)
        if view.get("session"):
            self.last_session = view["session"]
        if view["status"] == "failed":
            raise InvocationFailed(self.id, self._name, view.get("errorReason"))
        return view.get("result")

    def run_script(
        self,
        script: str,
        *,
        ttl_ms: int | None = None,
        poll_seconds: float = _DEFAULT_POLL_SECONDS,
        timeout_seconds: float | None = None,
    ) -> ScriptOutput:
        """Run a shell command in this sub-agent, as ``spawn_script`` does."""
        view = self._start({"script": script}, ttl_ms, poll_seconds, timeout_seconds)
        output = ScriptOutput(
            view.get("run") or self.id, view.get("exitCode"), view.get("output") or {}
        )
        if view["status"] == "failed":
            raise ScriptFailed(self.id, self._name, view.get("errorReason"), output)
        return output

    def keep(
        self, keep_for_ms: int | None = None, *, idle_timeout_min: int | None = None
    ) -> str:
        """Keep this sub-agent ``keep_for_ms`` from now, and let it sleep after
        ``idle_timeout_min`` minutes idle; returns the keep expiry."""
        body: dict[str, Any] = {}
        if keep_for_ms is not None:
            body["keepForMs"] = keep_for_ms
        if idle_timeout_min is not None:
            body["idleTimeoutMin"] = idle_timeout_min
        return _request("POST", f"/invocations/{_segment(self.id)}/keep", body)[
            "keepUntil"
        ]

    def stop(self, reason: str | None = None) -> bool:
        """Stop its runs, and every sub-agent it started in turn. A kept one
        keeps its conversation and is stopped only with a ``reason``, which its
        user reads. False when nothing was running."""
        stopped = _stop(self.id, reason)
        _log(
            f"{'stopped' if stopped else 'nothing running in'} {self._name} ({self.id})"
        )
        return stopped

    def wake(self) -> None:
        """Wake it when it sleeps; ``ssh sub-<id>`` does this itself."""
        _request("POST", f"/invocations/{self.id}/wake", {})

    def set_egress(self, rules: list[dict[str, Any]]) -> dict[str, Any]:
        """Replace the rules of a sub-agent spawned with ``egress="open"``.

        Returns ``{"waitingForOwner": [{"host", "id"}], "blockedByOwner":
        [{"host"}]}``: the rules that were not set. One waits for your
        owner's approval, the other names a host your owner blocked on the
        sub-agent. Both are logged, and the sub-agent cannot reach those
        hosts."""
        outcome = _request("POST", f"/invocations/{self.id}/egress", {"rules": rules})
        outcome = {
            "waitingForOwner": (outcome or {}).get("waitingForOwner") or [],
            "blockedByOwner": (outcome or {}).get("blockedByOwner") or [],
        }
        _log_egress(outcome, self.id)
        return outcome


def spawn_slate(
    *,
    harness: str | None = None,
    image: str | None = None,
    connections: list[str] | str | None = None,
    egress: Any | None = None,
    keep: bool = False,
    keep_for_ms: int | None = None,
    idle_timeout_min: int | None = None,
    seed: dict[str, Any] | None = None,
    install: str | None = None,
    env: dict[str, str] | None = None,
    resources: dict[str, str] | None = None,
    skills: list[dict[str, str]] | None = None,
    ttl_ms: int | None = None,
    label: str | None = None,
) -> SubAgent:
    """Spawn a clean slate: a sub-agent set up as ``spawn`` sets one up that
    runs nothing until ``SubAgent.run`` or ``run_script``. Enter it meanwhile
    with ``ssh sub-<id>``. Not kept, it is removed after its first result, or
    at ``ttl_ms`` if it never runs."""
    body = _target_body(
        harness=harness,
        image=image,
        connections=connections,
        egress=egress,
        keep=keep,
        keep_for_ms=keep_for_ms,
        idle_timeout_min=idle_timeout_min,
        seed=seed,
        install=install,
        env=env,
        resources=resources,
        skills=skills,
        ttl_ms=ttl_ms,
        label=label,
    )
    invocation_id = _spawned(
        _request("POST", "/invocations", body, _spawning_session_headers())
    )
    name = label or harness or image or invocation_id
    _log(f"spawned clean slate {name} ({invocation_id})")
    return SubAgent(invocation_id, name)


def sub_agent(invocation_id: str) -> SubAgent:
    """A handle on a sub-agent this driver spawned, by its id."""
    return SubAgent(invocation_id)


_STREAMS = ("stdout", "stderr")
_CHUNK_BYTES = 1024 * 1024
_MAX_IN_MEMORY_BYTES = 512 * 1024 * 1024


class ScriptOutput:
    """What a script sub-agent left behind: ``exit_code`` and its stdout and
    stderr, held by the platform until read. Each read checks the bytes
    against the sha256 the sub-agent reported, then tells the platform to
    delete that stream, so a stream reads once. A stream nobody reads is
    deleted after seven days."""

    def __init__(
        self, invocation_id: str, exit_code: int | None, output: dict[str, Any]
    ):
        self.invocation_id = invocation_id
        self.exit_code = exit_code
        self._output = dict(output)

    def size(self, stream: str) -> int | None:
        blob = self._output.get(stream)
        return blob["sizeBytes"] if blob else None

    def bytes(self, stream: str) -> bytes:
        size = self.size(stream) or 0
        if size > _MAX_IN_MEMORY_BYTES:
            raise RuntimeError(
                f"invocation {self.invocation_id}: its {stream} is {size} bytes, too large to read "
                f"into memory; use download({stream!r}, path)"
            )
        link = self._link(stream)
        with urllib.request.urlopen(link["url"]) as res:
            body = res.read()
        self._verify(stream, link, len(body), hashlib.sha256(body).hexdigest())
        self._ack(stream)
        return body

    def text(self, stream: str) -> str:
        return self.bytes(stream).decode("utf-8", errors="replace")

    def download(self, stream: str, path: str) -> None:
        link = self._link(stream)
        digest = hashlib.sha256()
        size = 0
        with urllib.request.urlopen(link["url"]) as res, open(path, "wb") as out:
            while chunk := res.read(_CHUNK_BYTES):
                digest.update(chunk)
                size += len(chunk)
                out.write(chunk)
        self._verify(stream, link, size, digest.hexdigest())
        self._ack(stream)

    def _path(self, stream: str) -> str:
        if stream not in _STREAMS:
            raise ValueError(f"stream is one of {_STREAMS}, not {stream!r}")
        return f"/invocations/{_segment(self.invocation_id)}/output/{stream}"

    def _link(self, stream: str) -> dict[str, Any]:
        path = self._path(stream)
        if stream not in self._output:
            raise RuntimeError(
                f"invocation {self.invocation_id} holds no {stream}: it was already read, or it expired"
            )
        return _request("GET", path)

    def _verify(
        self, stream: str, link: dict[str, Any], size: int, digest: str
    ) -> None:
        if size != link["sizeBytes"] or digest != link["sha256"]:
            raise RuntimeError(
                f"invocation {self.invocation_id}: the {stream} read back did not match what the script produced "
                f"({size} bytes, sha256 {digest}; expected {link['sizeBytes']} bytes, sha256 {link['sha256']}); "
                "it is kept, so read it again"
            )

    def _ack(self, stream: str) -> None:
        _request("POST", f"{self._path(stream)}/ack")
        self._output.pop(stream, None)


class ScriptFailed(InvocationFailed):
    """A script sub-agent failed: its script exited non-zero, was killed, ran
    past its deadline, or its setup failed. ``reason`` carries the exit code
    and the tail of stderr; ``output`` still reads what the script wrote."""

    def __init__(
        self, invocation_id: str, label: str, reason: str | None, output: ScriptOutput
    ):
        super().__init__(invocation_id, label, reason)
        self.output = output


def spawn_script(
    script: str,
    *,
    harness: str | None = None,
    image: str | None = None,
    connections: list[str] | str | None = None,
    egress: Any | None = None,
    keep: bool = False,
    keep_for_ms: int | None = None,
    idle_timeout_min: int | None = None,
    on_spawned: Any | None = None,
    seed: dict[str, Any] | None = None,
    install: str | None = None,
    env: dict[str, str] | None = None,
    resources: dict[str, str] | None = None,
    skills: list[dict[str, str]] | None = None,
    ttl_ms: int | None = None,
    label: str | None = None,
    poll_seconds: float = _DEFAULT_POLL_SECONDS,
    timeout_seconds: float | None = None,
    cancel: threading.Event | None = None,
    cancel_reason: str | None = None,
) -> ScriptOutput:
    """Run ``script`` on a sub-agent instead of a prompt, and block until it
    ends. No model turn runs: the sub-agent is set up exactly as ``spawn``
    sets one up (``seed``, ``install``, ``env``, ``resources``,
    ``skills``), then runs ``bash -lc script`` in its workspace once.

    Returns a ``ScriptOutput`` when the script exits 0; read its streams with
    ``bytes``, ``text`` or ``download``. Any other end raises ``ScriptFailed``
    with the exit code and the tail of stderr in ``reason``. ``ttl_ms`` is the
    script's deadline: past it the script is killed and the spawn fails.
    ``cancel`` stops it as it stops a ``spawn``."""
    if not script.strip():
        raise ValueError("pass a script")
    body = _target_body(
        harness=harness,
        image=image,
        connections=connections,
        egress=egress,
        keep=keep,
        keep_for_ms=keep_for_ms,
        idle_timeout_min=idle_timeout_min,
        seed=seed,
        install=install,
        env=env,
        resources=resources,
        skills=skills,
        ttl_ms=ttl_ms,
        label=label,
    )
    body["script"] = script
    name = label or harness or image or "invocation"

    if cancel is not None and cancel.is_set():
        raise Stopped(None, name)
    invocation_id = _spawned(
        _request("POST", "/invocations", body, _spawning_session_headers())
    )
    _log(f"spawned {name} ({invocation_id})")
    if on_spawned is not None:
        on_spawned(invocation_id)
    view = _await(
        invocation_id,
        name,
        ttl_ms=ttl_ms,
        poll_seconds=poll_seconds,
        timeout_seconds=timeout_seconds,
        cancel=cancel,
        cancel_reason=cancel_reason or (_SCRIPT_STOP_REASON if keep else None),
    )
    output = ScriptOutput(invocation_id, view.get("exitCode"), view.get("output") or {})
    if view["status"] == "failed":
        raise ScriptFailed(invocation_id, name, view.get("errorReason"), output)
    _log(f"{name} ({invocation_id}) done")
    return output
