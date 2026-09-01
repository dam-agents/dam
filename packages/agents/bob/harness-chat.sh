#!/bin/sh
# Bob is the ACP agent itself (2.0.2+); the platform speaks to it directly.
# --trust: every session/new carries the pod workspace, which Bob would
# otherwise refuse as untrusted. Permission requests are left to reach the
# client, the way every other chat harness here behaves — no --auto-approve.
node /app/bob-settings.mjs
exec bob acp --trust --accept-license "$@"
