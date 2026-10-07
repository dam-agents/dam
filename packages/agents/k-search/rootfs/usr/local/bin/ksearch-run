#!/bin/sh
set -eu

: "${KSEARCH_ROOT:=/opt/k-search}"
# Absolute path: the harness env doesn't carry the image PATH.
PYTHON="${KSEARCH_PYTHON:-/opt/ksearch-venv/bin/python3}"

# Python TLS uses certifi, not the system store — add the platform MITM CA.
MITM_CA="/etc/platform/ca/ca.crt"
if [ -s "$MITM_CA" ]; then
  CERTIFI="$("$PYTHON" -c 'import certifi; print(certifi.where())' 2>/dev/null || true)"
  if [ -n "$CERTIFI" ] && [ -w "$CERTIFI" ] && ! grep -q "platform-mitm-ca" "$CERTIFI" 2>/dev/null; then
    { echo "# platform-mitm-ca"; cat "$MITM_CA"; } >> "$CERTIFI"
  fi
fi

TASK_SOURCE="${KSEARCH_TASK_SOURCE:-kernelbench}"
EVAL_MODE="${KSEARCH_EVAL_MODE:-modal}"
TARGET_GPU="${KSEARCH_TARGET_GPU:-H100}"
LANGUAGE="${KSEARCH_LANGUAGE:-triton}"
MAX_OPT_ROUNDS="${KSEARCH_MAX_OPT_ROUNDS:-50}"
KB_LEVEL="${KSEARCH_KERNELBENCH_LEVEL:-1}"
KB_PROBLEM="${KSEARCH_KERNELBENCH_PROBLEM_ID:-1}"
ARTIFACTS_DIR="${KSEARCH_ARTIFACTS_DIR:-$HOME/work/.ksearch-output}"

# LLM access flows through the DAM-injected OpenAI-compatible env (LiteLLM proxy).
MODEL_NAME="${KSEARCH_MODEL:-${OPENAI_MODEL:-}}"
BASE_URL="${KSEARCH_BASE_URL:-${OPENAI_BASE_URL:-}}"
API_KEY="${OPENAI_API_KEY:-}"

if [ -z "$MODEL_NAME" ]; then
  echo "ksearch-run: no model set (OPENAI_MODEL or KSEARCH_MODEL)" >&2
  exit 2
fi

if [ "$EVAL_MODE" = "modal" ] && { [ -z "${MODAL_TOKEN_ID:-}" ] || [ -z "${MODAL_TOKEN_SECRET:-}" ]; }; then
  echo "ksearch-run: WARNING — eval_mode=modal but MODAL_TOKEN_ID/MODAL_TOKEN_SECRET are unset; the Modal client will fail to authenticate." >&2
fi

set -- \
  --task-source "$TASK_SOURCE" \
  --model-name "$MODEL_NAME" \
  --api-key "$API_KEY" \
  --language "$LANGUAGE" \
  --target-gpu "$TARGET_GPU" \
  --max-opt-rounds "$MAX_OPT_ROUNDS" \
  --world-model \
  --save-solutions \
  --artifacts-dir "$ARTIFACTS_DIR"

if [ -n "$BASE_URL" ]; then
  set -- "$@" --base-url "$BASE_URL"
fi

if [ "$TASK_SOURCE" = "kernelbench" ]; then
  set -- "$@" \
    --kernelbench-level "$KB_LEVEL" \
    --kernelbench-problem-id "$KB_PROBLEM" \
    --kernelbench-eval-mode "$EVAL_MODE"
fi

exec "$PYTHON" "$KSEARCH_ROOT/generate_kernels_and_eval.py" "$@"
