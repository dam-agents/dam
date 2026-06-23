#!/bin/sh
# K-Search has no native chat agent; this minimal ACP shim keeps the
# agent-runtime subprocess alive and runs the kernel-optimization job on prompt.
exec node /opt/ksearch-acp/ksearch-acp-shim.mjs
