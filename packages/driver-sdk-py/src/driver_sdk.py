"""Platform driver SDK: spawn sub-agents and await their results.

Stdlib-only by design (it is baked into every agent image; a dependency would
have to be baked too). The Python twin of ``/usr/local/lib/driver-sdk.mjs``:

- ``spawn`` starts a sub-agent on a harness and blocks until its
  schema-validated result. It takes the same setup a starter kit applies:
  ``image``, ``seed``, ``install``, ``env``, ``resources``, ``backend``,
  ``skills``. The sub-agent runs on this driver's provider.
- ``spawn_script`` runs a shell command on a sub-agent set up the same way,
  with no model turn, and returns its exit code, stdout and stderr byte for
  byte.
- ``list_images`` / ``list_connections`` / ``budget`` read what a spawn can use.
- ``s`` is shorthand for result schemas.

Self-configures from ``PLATFORM_MCP_URL`` (set on every agent pod); there is no
token, the mesh proves identity. Progress goes to stderr so the script's own
stdout stays clean.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from typing import Any

__all__ = [
    "InvocationFailed",
    "ScriptFailed",
    "ScriptOutput",
    "budget",
    "list_connections",
    "list_images",
    "s",
    "spawn",
    "spawn_script",
]

_DEFAULT_POLL_SECONDS = 5.0
# Mirrors the server's ttl clamp (~1min..6h) plus a poll of slack.
_DEFAULT_SPAWN_TIMEOUT_S = 6 * 60 * 60 + 60


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


def _log(msg: str) -> None:
    sys.stderr.write(f"[invoke] {msg}\n")


def _config() -> str:
    mcp_url = os.environ.get("PLATFORM_MCP_URL")
    if not mcp_url:
        raise RuntimeError(
            "PLATFORM_MCP_URL is not set — the driver SDK only runs inside a platform agent pod."
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


def _request(method: str, path: str, body: Any | None = None) -> Any:
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
            headers={"content-type": "application/json"} if data else {},
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
    """The harnesses a sub-agent may run on, each with its ``harness`` name and
    ``size``; pass the name as ``harness=``."""
    return _request("GET", "/images")["images"]


def list_connections() -> list[dict[str, Any]]:
    """This driver's own connection grants: the ones a spawn may pass on."""
    return _request("GET", "/connections")["connections"]


def budget() -> dict[str, Any]:
    """The owner's compute budget, read live::

        {
          "cpu":    {"reservedMilli": 3000, "ceilingMilli": 6000},
          "memory": {"reservedBytes": ..., "ceilingBytes": ...},
          "defaultWorkerSize": {"cpu": "1", "memory": "1Gi"},
        }

    The ceiling caps the summed sizes of the owner's running agents, this
    driver included. A spawn past the free room queues until room frees, and
    that wait counts against its TTL."""
    return _request("GET", "/budget")


def _target_body(
    *,
    harness: str | None,
    image: str | None,
    connections: list[str] | None,
    seed: dict[str, Any] | None,
    install: str | None,
    env: dict[str, str] | None,
    resources: dict[str, str] | None,
    backend: str | None,
    skills: list[dict[str, str]] | None,
    ttl_ms: int | None,
    memory: str | None,
    cpu: str | None,
    label: str | None,
) -> dict[str, Any]:
    if harness is None and image is None:
        raise ValueError("pass harness= (or image=)")
    if resources is not None and (memory is not None or cpu is not None):
        raise ValueError("pass cpu and memory inside resources=, not beside it")
    body: dict[str, Any] = {}
    if harness is not None:
        body["harness"] = harness
    if image is not None:
        body["image"] = image
    if label is not None:
        body["label"] = label
    if connections:
        body["connections"] = connections
    if seed is not None:
        body["seed"] = seed
    if install is not None:
        body["install"] = {"command": install}
    if env:
        body["env"] = [{"name": k, "value": v} for k, v in env.items()]
    if resources is not None:
        body["resources"] = resources
    if backend is not None:
        body["backend"] = backend
    if skills:
        body["skills"] = skills
    if ttl_ms is not None:
        body["ttlMs"] = ttl_ms
    if memory is not None:
        body["memory"] = memory
    if cpu is not None:
        body["cpu"] = cpu
    return body


def _await(
    invocation_id: str,
    name: str,
    *,
    ttl_ms: int | None,
    poll_seconds: float,
    timeout_seconds: float | None,
) -> dict[str, Any]:
    deadline = time.monotonic() + (
        timeout_seconds
        if timeout_seconds is not None
        else (ttl_ms / 1000 + 60 if ttl_ms else _DEFAULT_SPAWN_TIMEOUT_S)
    )
    while True:
        view = _request("GET", f"/invocations/{invocation_id}")
        if view["status"] != "running":
            return view
        if time.monotonic() > deadline:
            raise InvocationFailed(invocation_id, f"{name} (client timeout)")
        time.sleep(poll_seconds)


def spawn(
    prompt: str,
    schema: Any,
    *,
    harness: str | None = None,
    image: str | None = None,
    connections: list[str] | None = None,
    seed: dict[str, Any] | None = None,
    install: str | None = None,
    env: dict[str, str] | None = None,
    resources: dict[str, str] | None = None,
    backend: str | None = None,
    skills: list[dict[str, str]] | None = None,
    ttl_ms: int | None = None,
    memory: str | None = None,
    cpu: str | None = None,
    model: str | None = None,
    mode: str | None = None,
    config_options: dict[str, str] | None = None,
    label: str | None = None,
    poll_seconds: float = _DEFAULT_POLL_SECONDS,
    timeout_seconds: float | None = None,
) -> Any:
    """Spawn a sub-agent and block until its schema-validated result.

    Pass ``harness`` (a name from ``list_images()``, such as ``"claude-code"``):
    the sub-agent runs on that harness's template. ``image`` (a full ref)
    runs that image instead, the way a starter kit with its own image does;
    ``harness`` then names the harness inside it.

    The sub-agent is set up the way a starter kit sets up an agent:
    ``seed={"url": ..., "ref": ..., "commit": ..., "into": "work"}`` clones a
    repository, ``install="..."`` runs a shell command in the workspace before
    the prompt, ``env={"NAME": "value"}``, ``resources={"cpu": "2", "memory":
    "4Gi", "storage": "10Gi"}``, ``backend="vm"``, and
    ``skills=[{"source": ..., "name": ...}]``. A failed seed or install fails
    the spawn at once with its reason.

    The sub-agent runs on this driver's model provider and receives only the
    ``connections`` passed (ids from ``list_connections()``). Its egress
    follows this driver's rules, except the hosts of its own model provider,
    which pass over them.

    ``ttl_ms`` is a kill deadline, not pacing: the platform removes the
    sub-agent the moment it lapses, mid-work or not. ``label`` names the
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
    harness, or with no default, the spawn is refused."""
    body = _target_body(
        harness=harness,
        image=image,
        connections=connections,
        seed=seed,
        install=install,
        env=env,
        resources=resources,
        backend=backend,
        skills=skills,
        ttl_ms=ttl_ms,
        memory=memory,
        cpu=cpu,
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

    invocation_id = _request("POST", "/invocations", body)["id"]
    _log(f"spawned {name} ({invocation_id})")

    view = _await(
        invocation_id,
        name,
        ttl_ms=ttl_ms,
        poll_seconds=poll_seconds,
        timeout_seconds=timeout_seconds,
    )
    if view["status"] == "failed":
        raise InvocationFailed(invocation_id, name, view.get("errorReason"))
    _log(f"{name} ({invocation_id}) done")
    return view.get("result")


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
        return f"/invocations/{self.invocation_id}/output/{stream}"

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
    connections: list[str] | None = None,
    seed: dict[str, Any] | None = None,
    install: str | None = None,
    env: dict[str, str] | None = None,
    resources: dict[str, str] | None = None,
    backend: str | None = None,
    skills: list[dict[str, str]] | None = None,
    ttl_ms: int | None = None,
    memory: str | None = None,
    cpu: str | None = None,
    label: str | None = None,
    poll_seconds: float = _DEFAULT_POLL_SECONDS,
    timeout_seconds: float | None = None,
) -> ScriptOutput:
    """Run ``script`` on a sub-agent instead of a prompt, and block until it
    ends. No model turn runs: the sub-agent is set up exactly as ``spawn``
    sets one up (``seed``, ``install``, ``env``, ``resources``, ``backend``,
    ``skills``), then runs ``bash -lc script`` in its workspace once.

    Returns a ``ScriptOutput`` when the script exits 0; read its streams with
    ``bytes``, ``text`` or ``download``. Any other end raises ``ScriptFailed``
    with the exit code and the tail of stderr in ``reason``. ``ttl_ms`` is the
    script's deadline: past it the script is killed and the spawn fails."""
    if not script.strip():
        raise ValueError("pass a script")
    body = _target_body(
        harness=harness,
        image=image,
        connections=connections,
        seed=seed,
        install=install,
        env=env,
        resources=resources,
        backend=backend,
        skills=skills,
        ttl_ms=ttl_ms,
        memory=memory,
        cpu=cpu,
        label=label,
    )
    body["script"] = script
    name = label or harness or image or "invocation"

    invocation_id = _request("POST", "/invocations", body)["id"]
    _log(f"spawned {name} ({invocation_id})")
    view = _await(
        invocation_id,
        name,
        ttl_ms=ttl_ms,
        poll_seconds=poll_seconds,
        timeout_seconds=timeout_seconds,
    )
    output = ScriptOutput(invocation_id, view.get("exitCode"), view.get("output") or {})
    if view["status"] == "failed":
        raise ScriptFailed(invocation_id, name, view.get("errorReason"), output)
    _log(f"{name} ({invocation_id}) done")
    return output
