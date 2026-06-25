# Nous agent — the Nous hypothesis-driven experimentation orchestrator, layered
# on the claude-code image. Building FROM claude-code is deliberate: Nous drives
# Claude through the Claude Agent SDK, which shells out to the `claude` CLI. By
# inheriting that CLI plus the model gateway and CA trust, Nous's LLM calls
# authenticate through the platform's Envoy credential gateway — the pod holds
# no Anthropic key, exactly like the Claude Code harness.
#
# Nous is installed straight from its public GitHub repo with pip (no vendoring):
# `mise run agents:nous:image` is a plain `docker build`. Override the pinned
# release with `--build-arg NOUS_REF=<tag|branch|sha>`.
ARG BASE_IMAGE=platform-claude-code
FROM ${BASE_IMAGE}

USER root

# Pinned Nous release. Bump here (or pass --build-arg NOUS_REF=...) to upgrade.
ARG NOUS_REF=v0.4.0

# uv-managed Python in a shared location so the agent user (uid 65532) can use
# it at runtime. UV_PYTHON_INSTALL_DIR keeps interpreters out of root's $HOME.
# uv itself is provided by the mise-managed base image.
ENV UV_PYTHON_INSTALL_DIR=/opt/uv/python \
    NOUS_VENV=/opt/nous-venv

# Python 3.11 + Nous (and its claude-agent-sdk dependency) from GitHub, in a
# dedicated venv. The repo is public, so the install needs no credentials.
RUN uv python install 3.11 &&\
    uv venv --python 3.11 "$NOUS_VENV" &&\
    uv pip install --python "$NOUS_VENV/bin/python" \
      "git+https://github.com/AI-native-Systems-Research/agentic-strategy-evolution.git@${NOUS_REF}" &&\
    chown -R 65532:0 /opt/nous-venv /opt/uv

# Patch the installed campaign schema so `channels:` validates (Nous issue #296).
# Nous's runtime reads campaign.channels at every DESIGN/FINDINGS gate, but the
# v0.4.0 schema never declares the property while forbidding unknown top-level
# keys — so any campaign using channels is rejected at pre-flight. That breaks
# the channel bridge below, which *requires* a `channels:` webhook to relay gate
# summaries into the agent's chat thread. The patch mutates the installed schema
# in place (no vendoring); it is idempotent and self-verifying, so it becomes a
# clean no-op once a Nous release ships the property and NOUS_REF is bumped.
COPY --chmod=0755 patch-campaign-schema.py /usr/local/bin/nous-patch-campaign-schema
RUN "$NOUS_VENV/bin/python" /usr/local/bin/nous-patch-campaign-schema

# Put the venv (and thus `nous`, `python`, `pip`) ahead of the base tools.
ENV PATH="/opt/nous-venv/bin:${PATH}"

# Every campaign in this pod runs `--auto-approve`; some Nous versions gate that
# behind this env. Setting it here makes unattended/background runs unconditional
# (the design/findings human gates auto-pass). `locked_parameters` is still
# required per campaign — see AGENTS.md / the nous skill.
ENV NOUS_ALLOW_AUTO_APPROVE=1

# Never proxy localhost. The pod's HTTP(S)_PROXY points at the egress gateway;
# without this, Nous's gate-notification POST to the in-pod channel bridge
# (http://127.0.0.1:…) would be sent to the gateway instead of staying local.
# In-cluster hosts (e.g. the MCP endpoint) are NOT exempted, so the bridge's own
# call still routes through the gateway like the harness's MCP calls.
ENV NO_PROXY=127.0.0.1,localhost,::1 \
    no_proxy=127.0.0.1,localhost,::1

# Channel bridge: re-targets Nous's native `channels:` webhook at the platform's
# per-agent `send_channel_message` MCP tool, so gate summaries land in the
# agent's bound Slack/Telegram thread (no external egress, no webhook secret on
# disk). See AGENTS.md / the nous skill. Shebang resolves to the venv python on
# PATH; the pod has no extra runtime deps, so the bridge is pure stdlib.
COPY --chmod=0755 nous-channel-bridge.py /usr/local/bin/nous-channel-bridge

# Campaign artifacts on the persistent workspace, kept out of target repos
# (Nous issue #239). $HOME (/home/agent) is the persist:true mount; /app/working-dir
# is ephemeral image content that the agent init seeds into $HOME on first boot,
# so we create the dir under the seed and point the env at the persisted path.
# The template/agent env can override NOUS_CAMPAIGN_PARENT.
ENV NOUS_CAMPAIGN_PARENT=/home/agent/nous-campaigns
RUN mkdir -p /app/working-dir/nous-campaigns &&\
    chown -R 65532:0 /app/working-dir/nous-campaigns

# Nous-oriented system context for chat-mode (Claude Code, driving `nous`).
# claude-code symlinks /etc/claude-code/CLAUDE.md -> /etc/AGENTS.md.
# Both harnesses (chat and terminal) are inherited unchanged from the
# claude-code base — nous customizes behavior via AGENTS.md + the skill, not
# the harness scripts.
COPY AGENTS.md /etc/AGENTS.md

# Ship the `nous` skill (CLI + campaign-authoring reference) into the workspace.
# The claude-code base already symlinks .claude/skills -> .agents/skills, and the
# agent init seeds /app/working-dir into $HOME on first boot.
COPY --chown=65532:0 workspace/ /app/working-dir/

USER 65532
