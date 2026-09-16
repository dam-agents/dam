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

# openrc's service registry, kept on the machine's storage disk so a service an
# agent installs outlives the throwaway overlay. Each step reports its own
# failure: errexit is suppressed for the caller's `if`, so it cannot be relied
# on here, and a half-written registry must not read as success.
persist_openrc_registry() {
	for reg in /etc/init.d /etc/runlevels; do
		[ "$(stat -c %d "$reg")" = "$(stat -c %d /workspace)" ] && continue
		mkdir -p "/workspace$reg" || return 1
		# Image-owned scripts are copied over the store on every boot rather
		# than seeded once: they are version-coupled to the openrc binaries,
		# and a copy taken at first boot would outlive an openrc upgrade.
		cp -a "$reg/." "/workspace$reg/" || return 1
		mount --bind "/workspace$reg" "$reg" || return 1
	done
}

# On the vm Backend the root filesystem is a throwaway overlay and only the
# machine's storage disk at /workspace survives a stop, so every path the
# controller declared persistent (PLATFORM_VM_PERSIST_PATHS) is bind-mounted
# from there, seeded from the image on its first boot. The guest runs as root,
# which is what lets a plain agent image do this; a container never sets the
# variable and skips it.
if [ "${PLATFORM_VM_PERSIST_PATHS+vm}" = vm ]; then
	# sshd would otherwise drop an `agent` login to uid 65532, into a home the
	# root-run harness owns: nothing writable, none of the injected environment.
	if [ "$(id -u)" = 0 ]; then
		sed -i 's/^agent:x:65532:0:/agent:x:0:0:/' /etc/passwd
	fi
	if [ "$(stat -c %d /workspace 2>/dev/null)" = "$(stat -c %d / 2>/dev/null)" ]; then
		echo "agent-entrypoint: /workspace is not the machine's storage disk; refusing to boot without persistence" >&2
		exit 1
	fi
	for path in $(printf '%s' "$PLATFORM_VM_PERSIST_PATHS" | tr ',' ' '); do
		store="/workspace$path"
		if [ ! -d "$store" ]; then
			mkdir -p "$store"
			[ -d "$path" ] && [ ! "$path" -ef "$store" ] && cp -a "$path/." "$store/"
		fi
		mkdir -p "$path"
		[ "$path" -ef "$store" ] || mount --bind "$store" "$path"
	done

	# A machine is a whole VM, so it can run the services a container cannot,
	# but its init is still catatonit. openrc supplies the supervisor those
	# installers look for (k3s gives up without systemd or /sbin/openrc-run),
	# and the image stages that one path out of reach so a container agent
	# keeps failing the probe. Linking it in is what makes this a machine that
	# can host services. openrc's own state lives in /run, which every boot
	# starts empty, and without it every openrc command fails.
	#
	# None of it is allowed to end the boot. The harness runs with or without a
	# supervisor, so a storage disk that refuses a write costs the machine its
	# services, never the agent — unlike the persisted paths above, which are
	# the contract this guest exists to honor.
	if [ "$(id -u)" = 0 ] && [ -x /usr/libexec/openrc-run ]; then
		if ln -sf /usr/libexec/openrc-run /sbin/openrc-run &&
			mkdir -p /run/openrc && touch /run/openrc/softlevel &&
			persist_openrc_registry; then
			# Backgrounded: a wedged service would otherwise hold the boot past
			# the runner's readiness window and the machine would read as never
			# ready. A service whose program was not persisted fails here and
			# says so.
			openrc default &
		else
			# The link goes with it. A machine that kept it would answer the
			# probe an installer makes while having no supervisor behind it,
			# which is the late, confusing failure the staged path exists to
			# prevent.
			rm -f /sbin/openrc-run
			echo "agent-entrypoint: WARNING: no service supervisor; software that installs itself as a service will fail" >&2
		fi
	fi
fi

mitm_ca=/etc/platform/ca/ca.crt
anchor=/etc/pki/ca-trust/source/anchors/platform-mitm-ca.crt
extracted=/etc/pki/ca-trust/extracted

extract_trust_store() (
	export P11_KIT_NO_USER_CONFIG=1
	trust extract --format=openssl-bundle --filter=certificates --overwrite --comment "$extracted/openssl/ca-bundle.trust.crt" &&
		trust extract --format=pem-bundle --filter=ca-anchors --overwrite --comment --purpose server-auth "$extracted/pem/tls-ca-bundle.pem" &&
		trust extract --format=pem-bundle --filter=ca-anchors --overwrite --comment --purpose email "$extracted/pem/email-ca-bundle.pem" &&
		trust extract --format=pem-bundle --filter=ca-anchors --overwrite --comment --purpose code-signing "$extracted/pem/objsign-ca-bundle.pem" &&
		trust extract --format=java-cacerts --filter=ca-anchors --overwrite --purpose server-auth "$extracted/java/cacerts" &&
		trust extract --format=edk2-cacerts --filter=ca-anchors --overwrite --purpose=server-auth "$extracted/edk2/cacerts.bin" &&
		trust extract --format=pem-directory-hash --filter=ca-anchors --overwrite --purpose server-auth "$extracted/pem/directory-hash" ||
		exit 1
	for link in "$extracted"/pem/directory-hash/*.0; do
		[ -h "$link" ] || continue
		name=${link##*/}
		[ -e "/etc/pki/tls/certs/$name" ] ||
			ln -sf "$(readlink -f "$link")" "/etc/pki/tls/certs/$name" ||
			exit 1
	done
)

# No CA file mounted means the gateway never intercepts this agent's traffic, so
# every host returns its real public certificate, which the public CAs cover.
if [ -s "$mitm_ca" ]; then
	trust_t0=$(date +%s)
	if cp "$mitm_ca" "$anchor" && { extract_trust_store || /usr/sbin/update-ca-trust extract; }; then
		echo "agent-entrypoint: platform CA trusted in $(($(date +%s) - trust_t0))s"
	else
		echo "agent-entrypoint: WARNING: could not trust the platform CA; intercepted hosts may fail TLS" >&2
	fi
fi

home="${HOME:-/home/agent}"
if [ ! -f "$home/.initialized" ]; then
	cp -rn /app/working-dir/. "$home/" 2>/dev/null || true
	touch "$home/.initialized"
	echo "agent-entrypoint: seeded home from image workspace"
fi
mkdir -p "$home/work"

# $HOME is a shared RWX network volume; cache traffic (mise, uv, npm, ...)
# would hammer it, so ~/.cache points at pod-local disk (/tmp is an emptyDir)
# instead. Caches are disposable, so a pre-existing real directory (older
# volumes, or anything a harness recreated) is discarded. `ln -sfn` keeps the
# swap idempotent when the owner pod and a fork pod boot the volume together.
# The symlink persists on the volume but /tmp is fresh every pod, so the
# target is (re)created each boot to keep the link from dangling.
mkdir -p /tmp/agent-cache
# A failing swap leaves a real ~/.cache on the workspace volume — a perf wart,
# never a boot failure.
if [ ! -L "$home/.cache" ]; then
	# Probe with a scratch link first so a failing swap leaves any existing
	# cache directory intact instead of deleting it with no replacement.
	if ln -sfn /tmp/agent-cache "$home/.cache.tmp" 2>/dev/null; then
		rm -rf "$home/.cache" && mv "$home/.cache.tmp" "$home/.cache"
	else
		rm -f "$home/.cache.tmp"
		echo "agent-entrypoint: WARNING: could not swap ~/.cache to local disk; caches stay on the workspace volume" >&2
	fi
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
# Retired pins are the other half of the same hazard: once the image stops
# listing a tool, the loop below stops naming it, and a workspace copy seeded
# before retirement survives forever. It is not inert — a later `mise install`
# honors that pin, installs the package without its postinstall, and the shim
# it creates shadows the real binary on PATH. Each entry carries the date it was
# retired; drop it once every agent has booted since then.
retired_harness_tools="npm:@anthropic-ai/claude-code" # retired 2026-08-27
if [ -f "$user_mise_cfg" ]; then
	{
		printf '%s\n' $retired_harness_tools
		for conf in /etc/mise/conf.d/*.toml; do
			[ -e "$conf" ] || continue
			# keys of the [tools] entries, quoted or bare (see the format
			# contract in harness-tools.toml)
			sed -n \
				-e 's/^"\([^"]\{1,\}\)"[[:space:]]*=.*/\1/p' \
				-e 's/^\([^"#[:space:]][^=[:space:]]*\)[[:space:]]*=.*/\1/p' \
				"$conf"
		done
	} | while IFS= read -r tool; do
		esc=$(printf '%s' "$tool" | sed 's/\./\\./g')
		sed -i "\%^\"\{0,1\}${esc}\"\{0,1\}[[:space:]]*=%d" "$user_mise_cfg" || true
		if [ -f "$user_mise_lock" ]; then
			sed -i "\%^\[\[tools\.\"\{0,1\}${esc}\"\{0,1\}\]\]%,/^[[:space:]]*\$/d" "$user_mise_lock" || true
		fi
	done
fi

# Maven Resolver reads proxies only from settings.xml — neither http_proxy
# env nor the JVM's -Dhttp.proxyHost reach dependency resolution — so
# without this every `mvn` dependency fetch bypasses the egress gateway and
# dies. Absent-only: a user-managed settings.xml wins.
if [ -n "${HTTPS_PROXY:-}" ] && [ ! -e "$home/.m2/settings.xml" ]; then
	_hp=${HTTPS_PROXY#http://}
	_m2_proxy() {
		printf '<proxy><id>platform-%s</id><active>true</active><protocol>%s</protocol><host>%s</host><port>%s</port><nonProxyHosts>localhost|127.0.0.1</nonProxyHosts></proxy>' \
			"$1" "$1" "${_hp%:*}" "${_hp##*:}"
	}
	if ! { mkdir -p "$home/.m2" &&
		printf '<settings><proxies>%s%s</proxies></settings>\n' "$(_m2_proxy http)" "$(_m2_proxy https)" \
			> "$home/.m2/settings.xml"; } 2>/dev/null; then
		echo "agent-entrypoint: WARNING: could not write ~/.m2/settings.xml; Maven fetches may bypass the gateway" >&2
	fi
fi

# On the vm Backend the harness inherits a console that goes nowhere: stdout and
# stderr are both /dev/null in the guest, so every diagnostic the runtime already
# writes is discarded — the ACP and pod-service startup lines, the event-loop
# stall monitor, and the cgroup memory-pressure warning that precedes an
# out-of-memory restart. Nothing reads them and nothing can, which is why a
# machine that dies is opaque afterwards. Point them at the storage disk, where
# they outlive the machine and the agent itself can read them back.
#
# Intentional simplification: one file, truncated when it exceeds the cap, with
# no rotation — a boot keeps whatever the cap allows rather than a fixed history.
# A busy agent therefore loses its oldest lines; the upgrade path is logrotate,
# which the image now has a directory for.
if [ "${PLATFORM_VM_PERSIST_PATHS+vm}" = vm ] && [ -d /workspace ]; then
	runtime_log=/workspace/log/agent-runtime.log
	if mkdir -p /workspace/log 2>/dev/null && : >>"$runtime_log" 2>/dev/null; then
		if [ "$(wc -c <"$runtime_log")" -gt 33554432 ]; then
			: >"$runtime_log"
		fi
		exec >>"$runtime_log" 2>&1
		echo "agent-entrypoint: harness output captured here from $(date -u +%Y-%m-%dT%H:%M:%SZ)"
	else
		echo "agent-entrypoint: WARNING: could not open $runtime_log; harness output stays discarded" >&2
	fi
fi

exec "$@"
