#!/bin/sh
# K-Search is a batch workload, not an interactive REPL: terminal-mode runs the
# configured kernel-optimization job out of the box. Chat-mode is intentionally
# left as the platform-base stub (no ACP chat harness).
exec ksearch-run "$@"
