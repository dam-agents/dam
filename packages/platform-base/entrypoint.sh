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

	# A machine's console goes nowhere — stdout and stderr are both /dev/null in
	# the guest — so everything written from here on is discarded before anything
	# can read it: the rest of this boot, and then every diagnostic the harness
	# writes, including the event-loop stall monitor and the cgroup
	# memory-pressure warning that precedes an out-of-memory restart. That is
	# why a machine that dies is opaque afterwards. Point both streams at the
	# storage disk, where they outlive the machine and the agent can read back
	# the boot that killed it. This sits as early as the disk allows, so the
	# whole boot is in the record rather than only the part after the harness
	# starts.
	#
	# Each boot starts a fresh file and moves the one before it aside, so the
	# history is one boot deep: enough that a machine which died still explains
	# itself on the boot after. An over-long previous boot keeps its last
	# megabytes rather than being emptied — a failure shows at the end of a log,
	# so the cap has to trim the start, never the whole file.
	#
	# Intentional simplification: nothing bounds a *single* boot's file while it
	# is being written, so an agent that logs without pause can still fill its
	# disk; only the boot after it trims. The upgrade path is logrotate, for
	# which the image carries a directory but no binary, once something in a
	# machine can run it periodically.
	runtime_log=/workspace/log/agent-runtime.log
	runtime_log_cap=33554432
	if mkdir -p /workspace/log 2>/dev/null && : >>"$runtime_log" 2>/dev/null; then
		mv -f "$runtime_log" "$runtime_log.prev" 2>/dev/null || true
		if [ "$(wc -c <"$runtime_log.prev" 2>/dev/null || echo 0)" -gt "$runtime_log_cap" ]; then
			tail -c "$runtime_log_cap" "$runtime_log.prev" >"$runtime_log.trim" 2>/dev/null &&
				mv -f "$runtime_log.trim" "$runtime_log.prev" ||
				rm -f "$runtime_log.trim"
		fi
		exec >>"$runtime_log" 2>&1
		echo "agent-entrypoint: boot log starts $(date -u +%Y-%m-%dT%H:%M:%SZ); the previous boot is beside it"
	else
		echo "agent-entrypoint: WARNING: could not open $runtime_log; this machine's output stays discarded" >&2
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
	link_hashed_certs
)

link_hashed_certs() {
	for link in "$extracted"/pem/directory-hash/*.0; do
		[ -h "$link" ] || continue
		name=${link##*/}
		[ -e "/etc/pki/tls/certs/$name" ] ||
			ln -sf "$(readlink -f "$link")" "/etc/pki/tls/certs/$name" ||
			return 1
	done
}

# Regenerating the trust store costs a second of every boot and produces the
# same bytes each time, so a machine keeps the result on its storage disk and
# copies it back instead. The key is the MITM CA *and* the image's own trust
# source: keying on the CA alone would serve a stale store after an image
# updated its public roots, since the CA is unchanged across that. Nothing
# secret is cached — the tree is public roots plus this agent's CA certificate,
# which already sits on disk unencrypted; the private key never leaves the
# gateway.
trust_cache_key() {
	sha256sum "$mitm_ca" "$1" 2>/dev/null | cut -d' ' -f1 | tr -d '\n'
}

# No CA file mounted means the gateway never intercepts this agent's traffic, so
# every host returns its real public certificate, which the public CAs cover.
if [ -s "$mitm_ca" ]; then
	trust_t0=$(date +%s%N)
	trust_source=/usr/share/pki/ca-trust-source/ca-bundle.trust.p11-kit
	cache=/workspace/ca-trust
	key=""
	[ -d /workspace ] && key=$(trust_cache_key "$trust_source")

	trusted=no
	if cp "$mitm_ca" "$anchor"; then
		# A cache is used only when it was produced from exactly this CA and
		# this trust source, and still carries the bundle every TLS client
		# here reads. Anything else falls through to a full extraction.
		if [ -n "$key" ] && [ "$key" = "$(cat "$cache/key" 2>/dev/null)" ] &&
			[ -s "$cache/extracted/pem/tls-ca-bundle.pem" ] &&
			cp -a "$cache/extracted/." "$extracted/" && link_hashed_certs; then
			trusted=cache
		elif extract_trust_store || /usr/sbin/update-ca-trust extract; then
			trusted=extract
			if [ -n "$key" ] && rm -rf "$cache.new" && mkdir -p "$cache.new/extracted" &&
				cp -a "$extracted/." "$cache.new/extracted/" 2>/dev/null &&
				printf '%s' "$key" > "$cache.new/key"; then
				rm -rf "$cache" && mv "$cache.new" "$cache"
			fi
			rm -rf "$cache.new"
		fi
	fi

	if [ "$trusted" = no ]; then
		echo "agent-entrypoint: WARNING: could not trust the platform CA; intercepted hosts may fail TLS" >&2
	else
		echo "agent-entrypoint: platform CA trusted in $((($(date +%s%N) - trust_t0) / 1000000))ms (from $trusted)"
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

exec "$@"
