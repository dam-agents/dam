#!/usr/bin/env bash
# Stages the Claude Code harness's files into $ROOTFS, at the paths
# packages/agents/claude-code/Dockerfile puts them. Runs after debian-base's
# stage.sh, so a file here replaces the base's (harness-chat, the manifest).
set -euo pipefail

c=packages/agents/claude-code

install -d "$ROOTFS"/etc/claude-code "$ROOTFS"/etc/profile.d "$ROOTFS"/usr/local/lib
ln -sfn /etc/AGENTS.md "$ROOTFS/etc/claude-code/CLAUDE.md"
install -m 644 "$c/managed-settings.json" "$ROOTFS/etc/claude-code/managed-settings.json"
for f in model-gateway.mjs report-background-work.mjs model-gateway.sh sync-otel-settings.mjs harness-history-lib.mjs; do
	install -m 644 "$c/$f" "$ROOTFS/usr/local/lib/$f"
done
install -m 755 "$c/pod-service.sh" "$ROOTFS/usr/local/bin/pod-service"
install -m 644 "$c/model-gateway-login.sh" "$ROOTFS/etc/profile.d/model-gateway.sh"
install -m 755 "$c/harness-chat.sh" "$ROOTFS/usr/local/bin/harness-chat"
install -m 755 "$c/harness-terminal.sh" "$ROOTFS/usr/local/bin/harness-terminal"
install -m 644 "$c/runtime-manifest.yaml" "$ROOTFS/app/runtime-manifest.yaml"
cp -a "$c/dam-skills/." "$ROOTFS/usr/local/share/dam-skills/"

ln -sfn ../.agents/skills "$ROOTFS/app/working-dir/.claude/skills"
cp -a "$c/workspace/." "$ROOTFS/app/working-dir/"

# The two tool-bin links the harness scripts and manifest name, resolved on the
# host and pointed at where the adapter's install sits inside the image.
acp_host="$(mise -C "$STAGE" -E claude-code where npm:@agentclientprotocol/claude-agent-acp)"
lib_host="$acp_host/lib/node_modules/@agentclientprotocol/claude-agent-acp"
cli_host="$(echo "$lib_host"/node_modules/@anthropic-ai/claude-agent-sdk-*/claude)"
test -x "$cli_host"
ln -sfn "$(in_image "$lib_host")" "$ROOTFS/usr/local/share/tool-bin/claude-agent-acp-lib"
ln -sfn "$(in_image "$cli_host")" "$ROOTFS/usr/local/share/tool-bin/claude"
