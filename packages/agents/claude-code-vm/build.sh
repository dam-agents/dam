#!/usr/bin/env bash
# Build the claude-code-vm containerDisk image:
#   1. bootc OCI build (Containerfile, FROM the locally built claude-code image)
#   2. qcow2 via bootc-image-builder — hash-cached: keyed on the bootc image ID,
#      skipped when the cached disk for that ID already exists (most iteration
#      touches only the OCI layer; the expensive disk build reruns only when
#      the bootc image actually changed)
#   3. wrap the qcow2 as a KubeVirt containerDisk (scratch image, /disk/)
#
# bootc-image-builder needs a privileged container and only reads images from
# a containers-storage (it refuses to pull) — a containerized skopeo copies
# the image out of the docker daemon into a named-volume storage bib mounts.
# A named volume, not a bind mount: overlayfs won't run on macOS-shared paths.
#
# rootfs is ext4, not xfs: osbuild mounts the fresh rootfs through the *build
# host's* kernel, and Fedora 44's mkfs.xfs (xfsprogs 7) always enables the
# exchange-range + parent-pointer incompat bits, needing host kernel >= 6.12.
# Colima's Ubuntu 24.04 VM ships 6.8, so xfs fails with "unknown incompatible
# features (0xc0)". ext4 mounts on every kernel we build on.
set -euo pipefail

PKG="packages/agents/claude-code-vm"
CACHE="$PKG/.build"
BOOTC_TAG="platform-claude-code-vm-bootc:latest"
# Overridable so CI can source the harness from the registry image it just
# published and name the result for a push; local dev keeps the :latest tags
# that cluster:install loads into k3s.
AGENT_IMAGE="${AGENT_IMAGE:-platform-claude-code:latest}"
OUT_TAG="${OUT_TAG:-platform-claude-code-vm:latest}"
STORAGE_VOL="platform-ccvm-storage"
BIB_IMAGE="quay.io/centos-bootc/bootc-image-builder:latest"
SKOPEO_IMAGE="quay.io/skopeo/stable:latest"

# Preflight: osbuild assembles the disk on loop devices; containerized hosts
# whose device cgroup blocks them (e.g. Locki sandboxes) can never build this
# image — fail fast with the reason instead of 15 min into the qcow2 step.
# Detach what the probe attaches: the loop device outlives the container, and
# leaking one per build exhausts the kernel's 8-device default — after which
# every later build fails this very check and blames the environment.
if ! docker run --rm --privileged --entrypoint sh "$SKOPEO_IMAGE" -c \
	'truncate -s 1M /tmp/probe && d=$(losetup -f --show /tmp/probe) && losetup -d "$d"' >/dev/null 2>&1; then
	echo "claude-code-vm: FATAL: this environment cannot attach loop devices" >&2
	echo "(required by bootc-image-builder). Build on a host whose Docker allows" >&2
	echo "privileged loop access (macOS Docker, CI, a Linux workstation)." >&2
	exit 1
fi

# --secret, only when set: the Containerfile's agent-browser install mounts
# it to authenticate mise's GitHub API calls (release lookup + download),
# which otherwise hit the unauthenticated rate limit — shared across every
# CI runner's IP, so this isn't hypothetical. An unset --secret env= source
# hard-fails docker build even when the Dockerfile never mounts it, so this
# must stay conditional for local builds without GITHUB_TOKEN exported.
secret_args=()
if [ -n "${GITHUB_TOKEN:-}" ]; then
	secret_args=(--secret id=github_token,env=GITHUB_TOKEN)
fi
docker build -t "$BOOTC_TAG" -f "$PKG/Containerfile" --build-arg AGENT_IMAGE="$AGENT_IMAGE" "${secret_args[@]}" "$PKG"

# Key on the rootfs layers, not .Id: buildx stamps a fresh provenance
# attestation on every run, so the image index digest (.Id) changes even when
# nothing was rebuilt — which missed this cache every time and re-ran the
# ~15 min disk build. Layer diff IDs are content-addressed, so they are stable
# across rebuilds and still change the moment the image content does.
hash=$(docker image inspect -f '{{.RootFS.Layers}}' "$BOOTC_TAG" \
	| openssl dgst -sha256 -r | cut -c1-16)
disk_dir="$CACHE/disk-$hash"

if [ ! -f "$disk_dir/disk.qcow2" ]; then
	echo "claude-code-vm: building qcow2 for bootc image $hash (cache miss)"
	mkdir -p "$disk_dir"
	docker volume rm -f "$STORAGE_VOL" >/dev/null 2>&1 || true
	trap 'docker volume rm -f "$STORAGE_VOL" >/dev/null 2>&1 || true' EXIT
	docker run --rm --privileged \
		-v /var/run/docker.sock:/var/run/docker.sock \
		-v "$STORAGE_VOL:/var/lib/containers/storage" \
		"$SKOPEO_IMAGE" copy \
		"docker-daemon:$BOOTC_TAG" "containers-storage:localhost/claude-code-vm:$hash"
	# --chown: bib runs privileged and writes the output as root. macOS Docker
	# remaps ownership through its file-sharing layer and hides this, but on a
	# native Linux daemon (CI) the qcow2 really is root-owned and the mv below
	# fails for the non-root runner.
	docker run --rm --privileged --security-opt label=disable \
		-v "$STORAGE_VOL:/var/lib/containers/storage" \
		-v "$PWD/$disk_dir:/output" \
		"$BIB_IMAGE" build --type qcow2 --rootfs ext4 \
		--chown "$(id -u):$(id -g)" \
		"localhost/claude-code-vm:$hash"
	mv "$disk_dir/qcow2/disk.qcow2" "$disk_dir/disk.qcow2"
	rm -rf "$disk_dir/qcow2" "$disk_dir/manifest-qcow2.json" 2>/dev/null || true
	# keep only the current hash's disk — stale caches are pure disk waste
	find "$CACHE" -maxdepth 1 -type d -name 'disk-*' ! -name "disk-$hash" -exec rm -rf {} +
else
	echo "claude-code-vm: reusing cached qcow2 for bootc image $hash"
fi

# 107:107 = qemu, the uid virt-launcher reads containerDisks as.
docker build -t "$OUT_TAG" -f - "$disk_dir" <<'EOF'
FROM scratch
COPY --chown=107:107 disk.qcow2 /disk/disk.qcow2
EOF
echo "claude-code-vm: built $OUT_TAG"
