#!/bin/sh
# PreToolUse hook: deny a built-in web tool (WebSearch/WebFetch) and redirect the
# model to its DDG-backed replacement skill — but ONLY on a custom (non-Anthropic)
# backend, where the built-in Anthropic server-side tool doesn't work (#1087).
#
# model-gateway.sh exports PLATFORM_CUSTOM_BACKEND=1 exactly when the pod fronts a
# custom upstream. On genuine Anthropic backends the marker is unset: we print
# nothing and exit 0, so the built-in tool proceeds through the normal permission
# flow. Args: <ToolName> <skill-name>.
tool="$1"
skill="$2"

if [ "${PLATFORM_CUSTOM_BACKEND:-}" = "1" ]; then
	printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"The built-in %s tool is unavailable on this backend. Use the %s skill instead."}}\n' "$tool" "$skill"
fi
