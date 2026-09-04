#!/bin/sh
# Bob is the ACP agent itself (2.0.2+); the platform speaks to it directly.
# --trust: every session/new carries the pod workspace, which Bob would
# otherwise refuse as untrusted.
node /app/bob-settings.mjs

# Bob's ACP asks about every non-read tool or nothing at all — its own
# allowlist of safe commands is reachable from the TUI only — so auto-approve
# is the default and BOB_AUTO_APPROVE=0 buys per-tool prompts instead.
set --
[ "$BOB_AUTO_APPROVE" = "0" ] || set -- "$@" --auto-approve
exec bob acp --trust --accept-license "$@"
