#!/usr/bin/env bash
# docker-save-images.sh <output-tar> <image> ...
#
# `docker save` that also works when podman aliases docker: podman gives
# unqualified names a `localhost/` prefix kubelet's imagePullPolicy:Never
# lookup never matches, and its docker-archive writer handles multiple
# images only with --multi-image-archive. Qualify each name as
# docker.io/library/<name> and use podman directly in that case.
set -eo pipefail

tar="$1"
shift
rm -f "$tar"
if docker --version 2>/dev/null | grep -qi podman; then
  for img in "$@"; do
    podman tag "$img" "docker.io/library/$img"
  done
  podman save --multi-image-archive -o "$tar" "${@/#/docker.io/library/}"
else
  docker save -o "$tar" "$@"
fi
