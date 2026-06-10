# shellcheck shell=sh
# SSH login shells (ADR-062) bypass the harness shims, so re-point `claude`
# at the model gateway here too. Interactive-only: keeps the gateway
# ready-wait off non-interactive login shells and sftp/scp.
case $- in
*i*) [ -r /usr/local/lib/model-gateway.sh ] && . /usr/local/lib/model-gateway.sh ;;
esac
