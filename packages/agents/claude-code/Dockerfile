ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}

USER root

# LiteLLM gateway (Python; base ships none). When the agent is provisioned
# against a custom Anthropic-compatible upstream (ANTHROPIC_BASE_URL set),
# agent-runtime supervises it as the pod service (ADR-065) and the harness
# shims re-point Claude Code at it — see pod-service.sh and litellm-proxy.sh.
# Before the npm layer so a frequent Claude Code bump doesn't rebuild it.
# Pinned; bump deliberately.
ARG LITELLM_VERSION=1.88.1
RUN --mount=from=ghcr.io/astral-sh/uv:0.11.19,source=/uv,target=/usr/local/bin/uv \
    --mount=type=cache,target=/root/.cache/uv \
    dnf install -y python3.12 && dnf clean all \
    && uv pip install --system --python /usr/bin/python3.12 "litellm[proxy]==${LITELLM_VERSION}"

# Bundled model-cost map; the upstream fetch host isn't egress-allowed.
ENV LITELLM_LOCAL_MODEL_COST_MAP=True

# Patch @anthropic-ai/sdk (transitive via claude-agent-acp) for CVE-2026-41686.
RUN --mount=type=cache,target=/root/.npm \
    npm pkg set "overrides.@anthropic-ai/sdk"=">=0.100.1" \
    && npm install @agentclientprotocol/claude-agent-acp \
    && npm install -g @anthropic-ai/claude-code \
    && chown -R 65532:0 /app

COPY litellm-gateway.py /usr/local/lib/litellm-gateway.py
COPY litellm-proxy.sh /usr/local/lib/litellm-proxy.sh
# Pod service (ADR-065): agent-runtime spawns and supervises this once env is
# materialized; it brings up the LiteLLM gateway when the upstream is custom.
COPY --chmod=0755 pod-service.sh /usr/local/bin/pod-service
# SSH sessions (ADR-062) bypass the harness shims; front the upstream here too.
COPY litellm-login.sh /etc/profile.d/litellm-proxy.sh
COPY --chmod=0755 harness-chat.sh /usr/local/bin/harness-chat
COPY --chmod=0755 harness-terminal.sh /usr/local/bin/harness-terminal

RUN ln -s ../.agents/skills /app/working-dir/.claude/skills

COPY --chown=65532:0 workspace/ /app/working-dir/

USER 65532
