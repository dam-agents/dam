#!/bin/sh
# The shim reads the BOB_* env itself (bob run flags + settings merge) and
# emulates session list/load from Bob's task DB; see bob-acp-shim.mjs.
exec node /app/bob-acp-shim.mjs "$@"
