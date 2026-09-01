#!/usr/bin/env bash
# Rewrite the chart's `@ci-pin` markers to content tags before packaging.
#
# A marker line looks like:
#   tag: "" # @ci-pin keycloak-image-tag
# and becomes:
#   tag: "<source sha of the component>"
#
# Content tags pin an image to the commit that last touched its inputs, so
# upgrading to a chart that didn't change the image doesn't roll the pod (or
# rebuild the workload). The repo default stays `""` — charts rendered straight
# from git keep the appVersion fallback.
#
# Both publish jobs call this, so the marker set and the component list can't
# drift apart between the dev and release paths.
#
# Usage: pin-image-tags.sh <source-shas-json> [values-file]
# Written for bash 3.2 (macOS) and portable sed — no GNU-only \s or `sed -i`.
set -euo pipefail

SOURCE_SHAS="${1:?source-shas JSON required}"
VALUES="${2:-deploy/helm/platform/values.yaml}"
here="$(cd "$(dirname "$0")" && pwd)"

[ -f "$VALUES" ] || { echo "no such values file: $VALUES" >&2; exit 1; }

for comp in keycloak $("$here/resolve-image.sh" list-workloads); do
  tag="$(jq -re --arg c "$comp" '.[$c]' <<< "$SOURCE_SHAS")"
  [ -n "$tag" ] || { echo "empty source sha for $comp" >&2; exit 1; }
  tmp="$(mktemp)"
  sed "s|^\([[:space:]]*\)tag: \"\" # @ci-pin ${comp}-image-tag\$|\1tag: \"$tag\"|" \
    "$VALUES" > "$tmp"
  mv "$tmp" "$VALUES"
done

# Every marker must have been consumed — a leftover means the component list
# and the values.yaml markers drifted apart.
! grep -n '@ci-pin .*-image-tag' "$VALUES"
