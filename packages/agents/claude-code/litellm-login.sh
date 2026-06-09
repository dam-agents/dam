# shellcheck shell=sh
# claude-code login hook (ADR-062 SSH access). Interactive SSH shells and VS Code
# Remote-SSH terminals spawn a bash login shell that bypasses the harness shims
# (harness-chat/harness-terminal) — the usual place a custom Anthropic upstream is
# fronted by the local LiteLLM gateway. Run the same bring-up here so `claude`
# started over SSH routes through the gateway and inherits its discovered model
# pins. No-op without a custom upstream; once-per-pod (shared lock), so concurrent
# logins reuse one gateway.
#
# Interactive-only: a login shell sources this before the prompt, so the gateway
# bring-up wait stays off non-interactive login shells (tooling/bootstrap). sftp
# and scp run no login shell at all, so transfers are never delayed.
case $- in
*i*) [ -r /usr/local/lib/litellm-proxy.sh ] && . /usr/local/lib/litellm-proxy.sh ;;
esac
