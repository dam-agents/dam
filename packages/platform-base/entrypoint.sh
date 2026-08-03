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

# $HOME is a shared RWX network volume; cache traffic (mise, uv, npm, ...)
# would hammer it, so ~/.cache points at pod-local disk (/tmp is an emptyDir)
# instead. Caches are disposable, so a pre-existing real directory (older
# volumes, or anything a harness recreated) is discarded. `ln -sfn` keeps the
# swap idempotent when the owner pod and a fork pod boot the volume together.
# The symlink persists on the volume but /tmp is fresh every pod, so the
# target is (re)created each boot to keep the link from dangling.
home="${HOME:-/home/agent}"
mkdir -p /tmp/agent-cache
if [ ! -L "$home/.cache" ]; then
	rm -rf "$home/.cache"
	ln -sfn /tmp/agent-cache "$home/.cache"
fi

# Harness tool pins ship in the image's system-level mise config
# (/etc/mise/conf.d/harness-tools.toml) so they always match the installs
# baked into the image. Images predating this seeded the pins into
# ~/.config/mise/ instead; that copy persists across template upgrades,
# outranks the system config, and after an upgrade demands a version the new
# image no longer ships — every shim call then fails trying to install it at
# runtime. Strip exactly the image-owned tools from the persisted config and
# lockfile; user-added tools stay untouched. Never let a heal failure block
# boot, hence the `|| true`s.
user_mise_cfg="$home/.config/mise/config.toml"
user_mise_lock="$home/.config/mise/mise.lock"
if [ -f "$user_mise_cfg" ]; then
	for conf in /etc/mise/conf.d/*.toml; do
		[ -e "$conf" ] || continue
		# keys of the [tools] entries, quoted or bare (see the format
		# contract in harness-tools.toml)
		sed -n \
			-e 's/^"\([^"]\{1,\}\)"[[:space:]]*=.*/\1/p' \
			-e 's/^\([^"#[:space:]][^=[:space:]]*\)[[:space:]]*=.*/\1/p' \
			"$conf"
	done | while IFS= read -r tool; do
		esc=$(printf '%s' "$tool" | sed 's/\./\\./g')
		sed -i "\%^\"\{0,1\}${esc}\"\{0,1\}[[:space:]]*=%d" "$user_mise_cfg" || true
		if [ -f "$user_mise_lock" ]; then
			sed -i "\%^\[\[tools\.\"\{0,1\}${esc}\"\{0,1\}\]\]%,/^[[:space:]]*\$/d" "$user_mise_lock" || true
		fi
	done
fi

exec "$@"
