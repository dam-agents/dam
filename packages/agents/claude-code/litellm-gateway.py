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
# Captured before the shim re-points ANTHROPIC_BASE_URL at the proxy.
UPSTREAM = (os.environ.get("ANTHROPIC_BASE_URL") or "").rstrip("/")
TOKEN = os.environ.get("ANTHROPIC_AUTH_TOKEN", "")

proc = None


def log(msg):
    sys.stderr.write(f"litellm-gateway: {msg}\n")
    sys.stderr.flush()


def public_name(model_id):
    """model_name Claude Code sees. Gateway discovery wants a provider prefix,
    so expose each as anthropic/<id>; the upstream id stays in
    litellm_params.model for routing."""
    return model_id if model_id.startswith("anthropic/") else f"anthropic/{model_id}"


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
    return sorted({m["id"] for m in data if isinstance(m, dict) and m.get("id")}) or None


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
        return
    env = model_env(models)
    tmp = f"{ENV_FILE}.tmp"
    with open(tmp, "w") as f:
        for key, val in env.items():
            f.write(f"[ -n \"${{{key}:-}}\" ] || export {key}='{val}'\n")
    os.replace(tmp, ENV_FILE)
    log("model env -> " + ", ".join(f"{k}={v}" for k, v in env.items()))


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


def shutdown(*_):
    stop()
    sys.exit(0)


def main():
    global proc
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    models = fetch_models()
    log(f"discovered {len(models)} model(s)" if models else "no models; wildcard fallback")
    apply_models(models)
    proc = start()

    while True:
        time.sleep(REFRESH_SECONDS)
        if proc.poll() is not None:
            log("LiteLLM exited; restarting")
            proc = start()
            continue
        latest = fetch_models()
        if latest and latest != models:
            log(f"models changed ({len(models or [])} -> {len(latest)}); restarting")
            models = latest
            apply_models(models)
            stop()
            proc = start()


if __name__ == "__main__":
    main()
