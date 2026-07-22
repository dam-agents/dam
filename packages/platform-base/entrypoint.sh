#!/bin/sh
# The agent reaches the internet only through its Envoy gateway. For some hosts
# the gateway intercepts the TLS connection and returns a certificate signed by
# the cluster's own CA (the "platform MITM CA"), so the agent must trust that CA
# on top of the normal public ones. We add it to the system trust store here
# (update-ca-trust) rather than pointing SSL_CERT_FILE / GIT_SSL_CAINFO at the
# bare CA file, which would replace the public CAs instead of adding to them.
# Two clients skip the system store: Node gets the CA through NODE_EXTRA_CA_CERTS
# (set by the controller), and Python's certifi-based libs get SSL_CERT_FILE /
# REQUESTS_CA_BUNDLE aimed at the merged bundle this extraction rewrites (set in
# the Dockerfile). Runs as the non-root agent user; the trust dirs are made
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

# `dam-vm` only works when the deployment has a VM host configured (the
# controller sets DAM_VM_ENABLED then). Drop the whole dam-vm block from the
# agent instructions otherwise, so we don't advertise a command that would just
# fail; when enabled, drop only the marker comments and keep the tool doc.
# /etc is reset from the image each boot, so this re-runs cleanly; the file is
# made agent-writable at build time (see Dockerfile).
agents_md=/etc/AGENTS.md
if [ -w "$agents_md" ]; then
	if [ "${DAM_VM_ENABLED:-}" = "1" ]; then
		sed -i '/<!-- dam-vm:start/d; /<!-- dam-vm:end -->/d' "$agents_md" 2>/dev/null || true
	else
		sed -i '/<!-- dam-vm:start/,/<!-- dam-vm:end -->/d' "$agents_md" 2>/dev/null || true
	fi
fi

exec "$@"
