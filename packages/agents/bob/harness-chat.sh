#!/bin/sh
# Bob is the ACP agent itself (2.0.2+); the platform speaks to it directly.
# --trust: every session/new carries the pod workspace, which Bob would
# otherwise refuse as untrusted.
#
# The bootstrap resolves the settings posture and prints the approval mode it
# settled on (Config panel over provider pin). Without the posture Bob refuses
# every tool that touches $HOME, so a failed write must fail the harness rather
# than leave a healthy-looking pod whose every session dies at its first tool
# call.
approvals=$(node /app/bob-settings.mjs) || exit 1

# Bob's ACP asks about every non-read tool or nothing at all — its own
# allowlist of safe commands is reachable from the TUI only.
set --
[ "$approvals" = "ask" ] || set -- "$@" --auto-approve
exec bob acp --trust --accept-license "$@"
