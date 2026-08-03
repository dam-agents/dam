# SkyDiscover on the claude-code base: the agent is Claude Code shelling out
# to `skydiscover-run`; the inherited harness brings the model gateway and CA
# trust, so the pod holds no model key. One image backs two curated presets —
# AdaEvolve and EvoX — which differ only in the SKYDISCOVER_SEARCH env the
# agent template injects (see deploy/helm/platform/values.yaml).
ARG BASE_IMAGE=platform-claude-code
FROM ${BASE_IMAGE}

USER root

ARG SKYDISCOVER_VERSION=0.1.0

# shared location so the agent user (uid 65532) can use it at runtime
ENV UV_PYTHON_INSTALL_DIR=/opt/uv/python \
    SKYDISCOVER_VENV=/opt/skydiscover-venv

# Base package only: AdaEvolve and EvoX are SkyDiscover's own strategies and
# need no extras. The `external` extra (openevolve/gepa/shinkaevolve wrappers)
# is deliberately not installed — those backends ship as their own workload
# images; the heavy `math` extra (torch, jax, …) is runtime-installed into the
# venv per run when a task actually needs it.
RUN uv python install 3.11 &&\
    uv venv --python 3.11 "$SKYDISCOVER_VENV" &&\
    uv pip install --python "$SKYDISCOVER_VENV/bin/python" "skydiscover==${SKYDISCOVER_VERSION}" &&\
    uv cache clean &&\
    chown -R 65532:0 /opt/skydiscover-venv /opt/uv

ENV PATH="/opt/skydiscover-venv/bin:${PATH}"

# behavioral policy; claude-code symlinks /etc/claude-code/CLAUDE.md here
COPY AGENTS.md /etc/AGENTS.md

# Deliberately NO baked SKYDISCOVER_SEARCH default: the harness env merge
# lets container env win name collisions, so an image-baked value would
# permanently shadow the preset the template injects over the runtime env
# rail (adaevolve vs evox). The template presets are the only source;
# AGENTS.md documents the adaevolve fallback for preset-less runs.

# /app/working-dir is seeded onto persistent $HOME on first boot
ENV SKYDISCOVER_OUTPUT_ROOT=/home/agent/skydiscover-runs
RUN mkdir -p /app/working-dir/skydiscover-runs &&\
    chown -R 65532:0 /app/working-dir/skydiscover-runs

COPY --chown=65532:0 workspace/ /app/working-dir/

USER 65532
