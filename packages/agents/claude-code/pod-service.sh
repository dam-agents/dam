#!/bin/sh
# claude-code pod service (ADR-065): the local model gateway (ADR-066). The
# gateway itself decides whether there is a custom upstream to front (exit 0
# otherwise) so spawn and SIGHUP-reload share one check.
#
# NODE_USE_ENV_PROXY: fetch() must honor HTTP(S)_PROXY so the upstream hop
# crosses the Envoy gateway for credential injection; TLS to the MITM'd
# upstream verifies via the controller-injected NODE_EXTRA_CA_CERTS.
export NODE_USE_ENV_PROXY=1
exec node /usr/local/lib/model-gateway.mjs
