ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}

USER root

# Pinned: the model gateway (ADR-066) leans on undocumented Claude Code
# discovery behavior (the claude/ prefix filter and
# CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY), so bump deliberately and
# smoke-check model discovery against a custom upstream when you do.
ARG CLAUDE_CODE_VERSION=2.1.170

# Patch @anthropic-ai/sdk (transitive via claude-agent-acp) for CVE-2026-41686.
RUN --mount=type=cache,target=/root/.npm \
    npm pkg set "overrides.@anthropic-ai/sdk"=">=0.100.1" \
    && npm install @agentclientprotocol/claude-agent-acp \
    && npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
    && chown -R 65532:0 /app

# Local model gateway (ADR-066). When the agent is provisioned against a custom
# Anthropic-compatible upstream (ANTHROPIC_BASE_URL set), agent-runtime
# supervises this gateway as the pod service (ADR-065) and the harness shims
# re-point Claude Code at it. Plain Node (already in the base) — no extra
# runtime dependencies.
COPY model-gateway.mjs /usr/local/lib/model-gateway.mjs
COPY model-gateway.sh /usr/local/lib/model-gateway.sh
COPY --chmod=0755 pod-service.sh /usr/local/bin/pod-service
# SSH sessions (ADR-062) bypass the harness shims; front the upstream here too.
COPY model-gateway-login.sh /etc/profile.d/model-gateway.sh
# Override the platform-base shims with claude-code's, which source the gateway
# helper before launching the harness.
COPY --chmod=0755 harness-chat.sh /usr/local/bin/harness-chat
COPY --chmod=0755 harness-terminal.sh /usr/local/bin/harness-terminal

RUN ln -s ../.agents/skills /app/working-dir/.claude/skills

COPY --chown=65532:0 workspace/ /app/working-dir/

USER 65532
