#!/bin/sh
# Bob speaks ACP under `--experimental-acp`, but advertises
# agentCapabilities.loadSession: false — so unlike pi-agent / claude-code
# there's no way for agent-runtime to resume a chat by $HARNESS_SESSION_ID.
# Every `session/new` from the runtime spawns a fresh bob session; the
# shim doesn't try to fake persistence on top.
exec node /app/bob-acp-shim.mjs "$@"
