#!/usr/bin/env python3.12
"""Local LiteLLM gateway for the claude-code agent.

Fronts a custom Anthropic-compatible upstream: discovers its models
(GET /v1/models), serves them through a local LiteLLM proxy, and pins Claude
Code's model env vars to real models. Re-fetches every REFRESH_SECONDS and
restarts LiteLLM only when the model set changes.

Concrete model entries are generated rather than relying on a wildcard +
check_provider_endpoint (which doesn't enumerate models for litellm_proxy
providers — BerriAI/litellm#20064) or POST /model/new (needs a database).
"""

import json
import os
import re
import signal
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request

import yaml  # ships with litellm[proxy]

HOST = os.environ.get("LITELLM_PROXY_HOST", "127.0.0.1")
PORT = os.environ.get("LITELLM_PROXY_PORT", "4000")
CONFIG = "/tmp/litellm-gateway.config.yaml"
ENV_FILE = "/tmp/litellm-gateway.env"  # sourced by litellm-proxy.sh
REFRESH_SECONDS = int(os.environ.get("LITELLM_MODEL_REFRESH_SECONDS", "600"))
# Pause before relaunching a crashed LiteLLM so a startup-time crash can't spin.
RESTART_BACKOFF_SECONDS = 5
# Captured before the shim re-points ANTHROPIC_BASE_URL at the proxy.
UPSTREAM = (os.environ.get("ANTHROPIC_BASE_URL") or "").rstrip("/")
TOKEN = os.environ.get("ANTHROPIC_AUTH_TOKEN", "")

proc = None


def log(msg):
    sys.stderr.write(f"litellm-gateway: {msg}\n")
    sys.stderr.flush()


def public_name(model_id):
    """model_name Claude Code sees, lowercased. Gateway discovery wants a provider
    prefix, so expose each as claude/<id>; the upstream id stays in
    litellm_params.model for routing."""
    name = model_id.lower()
    return name if name.startswith("claude/") else f"claude/{name}"


def _is_embedding(model):
    """Embedding models can't serve chat, so drop them. Detect via an explicit
    mode/type flag (LiteLLM-style gateways set mode='embedding') or an
    'embedding' substring in the model id."""
    return any(
        "embedding" in str(model.get(field, "")).lower()
        for field in ("id", "mode", "type")
    )


def fetch_models():
    """Sorted upstream model ids, or None on failure. urllib honors HTTP(S)_PROXY
    (crosses Envoy for credential injection) and trusts the system CA store."""
    if not UPSTREAM:
        return None
    req = urllib.request.Request(
        f"{UPSTREAM}/v1/models",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "x-api-key": TOKEN,
            "anthropic-version": "2023-06-01",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10, context=ssl.create_default_context()) as r:
            data = json.load(r).get("data")
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
        log(f"model fetch failed ({exc}); keeping current models")
        return None
    if not isinstance(data, list):
        return None
    return sorted(
        {
            m["id"]
            for m in data
            if isinstance(m, dict) and m.get("id") and not _is_embedding(m)
        }
    ) or None


def _version_key(model_id):
    # Numeric components approximate "latest" (opus-4-8 > opus-4-1 > 3-opus).
    return (tuple(int(n) for n in re.findall(r"\d+", model_id)), model_id)


def _latest(models, tier):
    tiered = [m for m in models if tier in m.lower()]
    return max(tiered, key=_version_key) if tiered else None


def model_env(models):
    """Claude Code's model vars → latest opus/sonnet/haiku, each falling back to
    the best available model so they are always set."""
    opus, sonnet, haiku = (_latest(models, t) for t in ("opus", "sonnet", "haiku"))
    fallback = opus or sonnet or haiku or max(models, key=_version_key)
    if not (opus or sonnet or haiku):
        log(f"no opus/sonnet/haiku model in upstream set; pinning every tier to '{fallback}'")
    return {
        "ANTHROPIC_DEFAULT_OPUS_MODEL": public_name(opus or fallback),
        "ANTHROPIC_DEFAULT_SONNET_MODEL": public_name(sonnet or fallback),
        "ANTHROPIC_DEFAULT_HAIKU_MODEL": public_name(haiku or fallback),
        "ANTHROPIC_MODEL": public_name(opus or fallback),
    }


def apply_models(models):
    """Write the LiteLLM config (concrete discovered models, else a wildcard
    fallback) and — when models are known — the shim-sourced env file. Env lines
    assign only if unset, so a model set manually on the agent wins."""
    pairs = (
        [(public_name(m), f"litellm_proxy/{m}") for m in models]
        if models
        else [("claude-*", "litellm_proxy/*")]
    )
    cfg = {
        "model_list": [
            {
                "model_name": name,
                "litellm_params": {
                    "model": target,
                    "api_base": "os.environ/ANTHROPIC_BASE_URL",
                    "api_key": "os.environ/ANTHROPIC_AUTH_TOKEN",
                },
            }
            for name, target in pairs
        ],
        "general_settings": {"master_key": "os.environ/ANTHROPIC_AUTH_TOKEN"},
    }
    with open(CONFIG, "w") as f:
        yaml.safe_dump(cfg, f, sort_keys=False)

    if not models:
        log(
            "no models discovered; serving wildcard 'claude-*' so Claude Code's "
            "built-in model names still route to the upstream"
        )
        return
    env = model_env(models)
    tmp = f"{ENV_FILE}.tmp"
    with open(tmp, "w") as f:
        for key, val in env.items():
            f.write(f"[ -n \"${{{key}:-}}\" ] || export {key}='{val}'\n")
    os.replace(tmp, ENV_FILE)
    log(f"serving {len(models)} model(s); env -> " + ", ".join(f"{k}={v}" for k, v in env.items()))


def start():
    log(f"starting LiteLLM on {HOST}:{PORT}")
    return subprocess.Popen(
        ["litellm", "--config", CONFIG, "--host", HOST, "--port", PORT, "--num_workers", "1"]
    )


def stop():
    if proc and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


def restart():
    """Swap the running LiteLLM for a fresh process on the current config."""
    global proc
    stop()
    proc = start()


def shutdown(*_):
    stop()
    sys.exit(0)


def main():
    global proc
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    models = fetch_models()
    apply_models(models)
    proc = start()

    while True:
        try:
            # Wakes immediately if LiteLLM exits; TimeoutExpired means it's still up.
            proc.wait(timeout=REFRESH_SECONDS)
            log(f"LiteLLM exited; restarting in {RESTART_BACKOFF_SECONDS}s")
            time.sleep(RESTART_BACKOFF_SECONDS)
            proc = start()
            continue
        except subprocess.TimeoutExpired:
            pass
        latest = fetch_models()
        if latest and latest != models:
            log(f"models changed ({len(models or [])} -> {len(latest)}); restarting")
            models = latest
            apply_models(models)
            restart()


if __name__ == "__main__":
    main()
