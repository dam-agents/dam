#!/usr/bin/env python3
"""Build-time patch: teach Nous's campaign schema about ``channels:``.

Nous's runtime reads and dispatches ``campaign.channels`` at every
DESIGN/FINDINGS gate (``orchestrator/iteration.py`` → ``orchestrator/channels.py``),
but ``orchestrator/schemas/campaign.schema.yaml`` never declares the property
while setting ``additionalProperties: false`` at the top level. So a campaign
that uses ``channels:`` is rejected at pre-flight before the run starts::

    Campaign validation error: Additional properties are not allowed
    ('channels' was unexpected)

That makes the documented feature impossible to use — and in this image it
breaks the channel bridge (``nous-channel-bridge.py``), which relies on a
``channels:`` webhook to relay gate summaries into the agent's bound chat
thread. Upstream issue:
https://github.com/AI-native-Systems-Research/agentic-strategy-evolution/issues/296

This script patches the schema *in place in the installed package* so the fix
travels with the pinned ``NOUS_REF`` without vendoring the orchestrator. It is:

  * idempotent — re-running (or running against a future Nous that ships the
    property itself) is a no-op;
  * version-agnostic — it mutates the parsed schema dict, so it survives an
    upstream key reorder under a bumped ``NOUS_REF``;
  * self-verifying — it asserts a ``channels``-bearing campaign now validates
    AND that an unknown key is still rejected (i.e. ``additionalProperties:
    false`` is preserved), failing the build if either regresses.

The ``channels`` item shape mirrors exactly what ``orchestrator/channels.py``
reads: ``kind`` ∈ {webhook, slack} (defaults to ``webhook``); ``url`` for a
webhook channel; ``webhook_url`` for a slack channel; optional ``headers`` for a
webhook channel.

stdlib + the orchestrator's own deps (pyyaml, jsonschema) only — runs on the
nous venv python during ``docker build``.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import jsonschema
import yaml

# Schema fragment for one ``channels`` entry. Kept faithful to the dispatchers
# in ``orchestrator/channels.py`` — ``additionalProperties: false`` so a typo'd
# field is caught, matching the strictness of the rest of the campaign schema.
CHANNELS_PROPERTY = {
    "type": "array",
    "description": (
        "Notification channels POSTed a markdown gate summary at each "
        "DESIGN/FINDINGS gate (fires even under --auto-approve). Consumed by "
        "orchestrator/channels.py (issue #130). Best-effort: a timeout/5xx/DNS "
        "failure logs a warning and never blocks the gate or campaign."
    ),
    "items": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "kind": {
                "type": "string",
                "enum": ["webhook", "slack"],
                "description": (
                    "Dispatcher. 'webhook' POSTs {\"markdown\": ...} to 'url'; "
                    "'slack' POSTs {\"text\": ...} to 'webhook_url'. "
                    "Defaults to 'webhook' when omitted."
                ),
            },
            "url": {
                "type": "string",
                "description": "Target URL for a 'webhook' channel.",
            },
            "webhook_url": {
                "type": "string",
                "description": "Incoming-webhook URL for a 'slack' channel.",
            },
            "headers": {
                "type": "object",
                "additionalProperties": True,
                "description": "Optional extra HTTP headers for a 'webhook' channel.",
            },
        },
    },
}


def _schema_path() -> Path:
    """Locate the installed campaign schema without executing the package."""
    spec = importlib.util.find_spec("orchestrator")
    if spec is None or not spec.submodule_search_locations:
        raise SystemExit("[patch-schema] orchestrator package not found in venv")
    return Path(spec.submodule_search_locations[0]) / "schemas" / "campaign.schema.yaml"


def _self_test(schema: dict) -> None:
    """Prove the fix works and that strictness is preserved."""
    base = {
        "research_question": "probe",
        "target_system": {"name": "X", "description": "x"},
        "prompts": {"methodology_layer": "prompts/methodology"},
    }
    with_channels = {
        **base,
        "channels": [
            {"kind": "webhook", "url": "http://127.0.0.1:8765/gate",
             "headers": {"Authorization": "Bearer x"}},
            {"kind": "slack", "webhook_url": "https://hooks.slack.com/services/X/Y/Z"},
        ],
    }
    # Positive: a channels-bearing campaign must now validate.
    jsonschema.validate(with_channels, schema)
    # Negative: additionalProperties:false must still reject an unknown key.
    try:
        jsonschema.validate({**base, "definitely_not_a_real_key": 1}, schema)
    except jsonschema.ValidationError:
        pass
    else:
        raise SystemExit("[patch-schema] regression: unknown top-level key was accepted")


def main() -> int:
    path = _schema_path()
    schema = yaml.safe_load(path.read_text())

    properties = schema.get("properties")
    if not isinstance(properties, dict):
        raise SystemExit(f"[patch-schema] unexpected schema shape at {path}")

    if "channels" in properties:
        # Upstream (or a prior build) already declares it — verify and stop.
        _self_test(schema)
        print(f"[patch-schema] 'channels' already present in {path}; no-op.")
        return 0

    properties["channels"] = CHANNELS_PROPERTY
    _self_test(schema)  # fail the build before writing if something is off

    path.write_text(
        yaml.safe_dump(schema, sort_keys=False, allow_unicode=True, width=4096)
    )
    print(f"[patch-schema] added 'channels' property to {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
