# shellcheck shell=sh
# claude-code SSH login hook (ADR-062): interactive SSH / VS Code Remote-SSH
# shells bypass the harness shims, so run the same gateway bring-up here.
# Interactive-only, so non-login tooling and sftp/scp aren't delayed.
case $- in
*i*) [ -r /usr/local/lib/litellm-proxy.sh ] && . /usr/local/lib/litellm-proxy.sh ;;
esac
