#!/usr/bin/env bash
# Build the claude-code-vm containerDisk image:
#   1. bootc OCI build (Containerfile, FROM the locally built claude-code image)
#   2. qcow2 via bootc-image-builder — hash-cached: keyed on the bootc image ID,
#      skipped when the cached disk for that ID already exists (most iteration
#      touches only the OCI layer; the expensive disk build reruns only when
#      the bootc image actually changed)
#   3. wrap the qcow2 as a KubeVirt containerDisk (scratch image, /disk/)
#
# bootc-image-builder needs a privileged container and reads images from a
# registry, not the docker daemon — an ephemeral local registry on
# 127.0.0.1:5077 bridges the two.
set -euo pipefail

PKG="packages/agents/claude-code-vm"
CACHE="$PKG/.build"
BOOTC_TAG="platform-claude-code-vm-bootc:latest"
OUT_TAG="platform-claude-code-vm:latest"
REG_NAME="platform-ccvm-registry"
REG_ADDR="127.0.0.1:5077"
BIB_IMAGE="quay.io/centos-bootc/bootc-image-builder:latest"

docker build -t "$BOOTC_TAG" --build-arg AGENT_IMAGE=platform-claude-code:latest "$PKG"

id=$(docker image inspect -f '{{.Id}}' "$BOOTC_TAG")
hash="${id#sha256:}"
hash="${hash:0:16}"
disk_dir="$CACHE/disk-$hash"

if [ ! -f "$disk_dir/disk.qcow2" ]; then
	echo "claude-code-vm: building qcow2 for bootc image $hash (cache miss)"
	mkdir -p "$disk_dir"
	docker rm -f "$REG_NAME" >/dev/null 2>&1 || true
	docker run -d --name "$REG_NAME" -p "$REG_ADDR:5000" registry:2 >/dev/null
	trap 'docker rm -f "$REG_NAME" >/dev/null 2>&1 || true' EXIT
	docker tag "$BOOTC_TAG" "$REG_ADDR/claude-code-vm:$hash"
	docker push "$REG_ADDR/claude-code-vm:$hash" >/dev/null
	docker run --rm --privileged --net=host --security-opt label=disable \
		-v "$PWD/$disk_dir:/output" \
		"$BIB_IMAGE" build --type qcow2 --tls-verify=false \
		"$REG_ADDR/claude-code-vm:$hash"
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
