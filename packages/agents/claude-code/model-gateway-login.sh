# shellcheck shell=sh
# claude-code login hook (ADR-062 SSH access). Interactive SSH shells and VS Code
# Remote-SSH terminals spawn a bash login shell that bypasses the harness shims
# (harness-chat/harness-terminal) — the usual place a custom Anthropic upstream is
# fronted by the local model gateway. Run the same re-pointing here so `claude`
# started over SSH routes through the gateway and inherits its discovered model
# pins. No-op without a custom upstream; the gateway itself is pod-scoped
# (agent-runtime supervises it), so concurrent logins share it.
#
# Interactive-only: a login shell sources this before the prompt, so the gateway
# ready-wait stays off non-interactive login shells (tooling/bootstrap). sftp
# and scp run no login shell at all, so transfers are never delayed.
case $- in
*i*) [ -r /usr/local/lib/model-gateway.sh ] && . /usr/local/lib/model-gateway.sh ;;
esac
