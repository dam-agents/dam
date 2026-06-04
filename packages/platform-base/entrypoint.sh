#!/bin/sh
# The agent reaches the internet only through its Envoy gateway. For some hosts
# the gateway intercepts the TLS connection and returns a certificate signed by
# the cluster's own CA (the "platform MITM CA"), so the agent must trust that CA
# on top of the normal public ones. We add it to the system trust store here
# (update-ca-trust) instead of via SSL_CERT_FILE / GIT_SSL_CAINFO, because those
# env vars replace the public CAs rather than add to them. Node is the exception:
# it doesn't read the system store, so the controller hands it the CA through
# NODE_EXTRA_CA_CERTS. Runs as the non-root agent user; the trust dirs are made
# writable at build time (see Dockerfile).
set -eu

mitm_ca=/etc/platform/ca/ca.crt
anchor=/etc/pki/ca-trust/source/anchors/platform-mitm-ca.crt

# No CA file mounted means the gateway never intercepts this agent's traffic, so
# every host returns its real public certificate, which the public CAs cover.
if [ -s "$mitm_ca" ]; then
	cp "$mitm_ca" "$anchor" && /usr/sbin/update-ca-trust extract \
		|| echo "agent-entrypoint: WARNING: could not trust the platform CA; intercepted hosts may fail TLS" >&2
fi

exec "$@"
