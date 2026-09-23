#!/usr/bin/env bash
# Stages debian-base's files into $ROOTFS: the payload platform-base's runner
# stage COPYs in, at the same paths, plus this image's Debian adapters. Runs
# from the repo root after `mise install`; $RUNTIME is the agent-runtime deploy
# the image task built on the host.
set -euo pipefail

b=packages/platform-base
here=packages/mise-oci/debian-base

cp -a "$here/rootfs/." "$ROOTFS/"

# Every file a `mise oci` layer adds is owned by the build's --owner (the agent),
# so these directories come out agent-writable like the ones platform-base
# chowns. /etc/ssl/certs and /usr/local/share/ca-certificates are the Debian
# side of the trust store the entrypoint writes as the agent.
install -d "$ROOTFS"/{home/agent,etc/logrotate.d,etc/ssl/certs} \
	"$ROOTFS"/etc/pki/ca-trust/{source/anchors,extracted/pem} \
	"$ROOTFS"/usr/local/share/{ca-certificates,tool-bin,dam-skills} \
	"$ROOTFS"/usr/local/lib/platform-python "$ROOTFS"/app/working-dir/{.claude,.agents/skills}

install -m 644 packages/experiment-sdk/src/experiment_sdk.py "$ROOTFS/usr/local/lib/platform-python/"
install -m 755 "$b/harness-chat.sh" "$ROOTFS/usr/local/bin/harness-chat"
install -m 755 "$b/harness-terminal.sh" "$ROOTFS/usr/local/bin/harness-terminal"
install -m 755 "$b/dam-run.mjs" "$ROOTFS/usr/local/bin/dam-run"
install -m 755 "$b/entrypoint.sh" "$ROOTFS/usr/local/bin/agent-entrypoint"

cp -a "$b/skills/." "$ROOTFS/app/working-dir/.agents/skills/"
cp -a "$b/dam-skills/." "$ROOTFS/usr/local/share/dam-skills/"
install -m 644 "$b/skills-manifest.json" "$ROOTFS/usr/local/share/dam-skill-manifest.json"
install -m 644 "$b/working-dir/.claude.json" "$ROOTFS/app/working-dir/.claude.json"
install -m 644 "$b/working-dir/.claude/settings.json" "$ROOTFS/app/working-dir/.claude/settings.json"
install -m 644 "$b/runtime-manifest.yaml" "$ROOTFS/app/runtime-manifest.yaml"
install -m 644 "$here/AGENTS.md" "$ROOTFS/etc/AGENTS.md"

cp -a "$RUNTIME/package.json" "$RUNTIME/node_modules" "$ROOTFS/app/"
cp -a packages/agent-runtime/dist "$ROOTFS/app/dist"
install -m 644 packages/driver-sdk/dist/driver-sdk.mjs "$ROOTFS/usr/local/lib/driver-sdk.mjs"
