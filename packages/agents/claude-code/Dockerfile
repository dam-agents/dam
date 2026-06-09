ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}

USER root

# Local LiteLLM gateway. When the agent is provisioned against a custom
# Anthropic-compatible upstream (ANTHROPIC_BASE_URL set), the harness shims
# front it with this proxy and re-point Claude Code at it — see
# litellm-proxy.sh. LiteLLM is a Python package and the base ships no Python,
# so pull python3.12 (litellm 1.88.x requires >=3.10,<3.14) and bootstrap pip
# via ensurepip (there is no python3.12-pip rpm). Pin the version — bump
# deliberately (no-downgrade policy). Installed before the npm layer so a
# Claude Code CLI bump (frequent) doesn't rebuild this heavy layer.
ARG LITELLM_VERSION=1.88.1
RUN --mount=type=cache,target=/root/.cache/pip \
    dnf install -y python3.12 && dnf clean all \
    && python3.12 -m ensurepip --upgrade \
    && python3.12 -m pip install "litellm[proxy]==${LITELLM_VERSION}"

# Use the bundled model-cost map instead of fetching it from GitHub at startup
# — that host isn't on the agent's egress allow-list, so the fetch would just
# fail and fall back to this anyway.
ENV LITELLM_LOCAL_MODEL_COST_MAP=True

# claude-agent-acp pulls @anthropic-ai/sdk transitively; override it to a patched
# release (CVE-2026-41686). Set before install so npm resolves the nested dep to it.
RUN --mount=type=cache,target=/root/.npm \
    npm pkg set "overrides.@anthropic-ai/sdk"=">=0.100.1" \
    && npm install @agentclientprotocol/claude-agent-acp \
    && npm install -g @anthropic-ai/claude-code \
    && chown -R 65532:0 /app

COPY litellm-gateway.py /usr/local/lib/litellm-gateway.py
COPY litellm-proxy.sh /usr/local/lib/litellm-proxy.sh
# SSH / VS Code Remote-SSH sessions (ADR-062) bypass the harness shims, so also
# front the upstream from a login hook. profile.d is sourced by interactive login
# shells but not by sftp/scp (no shell) or `ssh host cmd` (non-login).
COPY litellm-login.sh /etc/profile.d/litellm-proxy.sh
# Override the platform-base shims with claude-code's, which source the proxy
# helper before launching the harness.
COPY harness-chat.sh /usr/local/bin/harness-chat
COPY harness-terminal.sh /usr/local/bin/harness-terminal
RUN chmod +x /usr/local/bin/harness-chat /usr/local/bin/harness-terminal

# Claude Code reads skills from $HOME/.claude/skills; symlink onto the
# cross-harness store at $HOME/.agents/skills so installs land once.
RUN ln -s ../.agents/skills /app/working-dir/.claude/skills

COPY --chown=65532:0 workspace/ /app/working-dir/

USER 65532
