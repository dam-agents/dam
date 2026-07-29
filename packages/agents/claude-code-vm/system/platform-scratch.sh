#!/bin/sh
# Mount the platform-attached scratch disk (KubeVirt emptyDisk, serial
# "scratch") and bind the docker/k3s image stores onto it — bulky, disposable
# state that must not fill the rootfs. Contents die with hibernation, matching
# the rest of the guest. Image-seeded content (k3s airgap images under
# /var/lib/rancher) is copied onto the fresh scratch once, before the bind
# mount shadows it.
set -eu

dev=/dev/disk/by-id/virtio-scratch
if [ ! -b "$dev" ]; then
	echo "platform-scratch: no scratch disk attached; using rootfs" >&2
	exit 0
fi

blkid "$dev" >/dev/null 2>&1 || mkfs.xfs -q "$dev"
mkdir -p /var/lib/platform-scratch
mountpoint -q /var/lib/platform-scratch || mount "$dev" /var/lib/platform-scratch

for d in docker rancher; do
	mkdir -p "/var/lib/platform-scratch/$d" "/var/lib/$d"
	if [ -z "$(ls -A "/var/lib/platform-scratch/$d")" ] && [ -n "$(ls -A "/var/lib/$d" 2>/dev/null)" ]; then
		rsync -a "/var/lib/$d/" "/var/lib/platform-scratch/$d/"
	fi
	mountpoint -q "/var/lib/$d" || mount --bind "/var/lib/platform-scratch/$d" "/var/lib/$d"
done
