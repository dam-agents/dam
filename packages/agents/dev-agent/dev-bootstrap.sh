#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/dam-agents/dam.git}"
REPO_REF="${REPO_REF:-feat/dam-in-dam}"
REPO_DIR="${REPO_DIR:-$HOME/platform}"

if [ -d "$REPO_DIR/.git" ]; then
  git -C "$REPO_DIR" fetch --depth 1 origin "$REPO_REF"
  git -C "$REPO_DIR" checkout -f FETCH_HEAD
else
  git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" "$REPO_DIR"
fi

mise trust "$REPO_DIR/mise.toml" >/dev/null 2>&1 || true

cat <<EOF
dev-agent ready: $REPO_DIR @ $REPO_REF
  build inner images:  cd $REPO_DIR && mise run inner:build
  deploy to inner:     cd $REPO_DIR && SKIP_IMAGE_BUILD=1 mise run cluster:install --external-kubeconfig="\${INNER_KUBECONFIG:-\$HOME/.kube/inner.yaml}"
EOF
