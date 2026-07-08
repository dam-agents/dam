# ShinkaEvolve on the claude-code base: the agent is Claude Code shelling out
# to `shinka_run`; the inherited harness brings the model gateway and CA trust,
# so the pod holds no model key.
ARG BASE_IMAGE=platform-claude-code
FROM ${BASE_IMAGE}

USER root

ARG SHINKA_VERSION=0.0.7

# shared location so the agent user (uid 65532) can use it at runtime
ENV UV_PYTHON_INSTALL_DIR=/opt/uv/python \
    SHINKA_VENV=/opt/shinka-venv

RUN uv python install 3.11 &&\
    uv venv --python 3.11 "$SHINKA_VENV" &&\
    uv pip install --python "$SHINKA_VENV/bin/python" "shinka-evolve==${SHINKA_VERSION}" &&\
    uv cache clean &&\
    chown -R 65532:0 /opt/shinka-venv /opt/uv

ENV PATH="/opt/shinka-venv/bin:${PATH}"

# httpx/requests default to certifi's bundle and would miss the gateway CA
ENV SSL_CERT_FILE=/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem \
    REQUESTS_CA_BUNDLE=/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem

# behavioral policy; claude-code symlinks /etc/claude-code/CLAUDE.md here
COPY AGENTS.md /etc/AGENTS.md

# /app/working-dir is seeded onto persistent $HOME on first boot
ENV SHINKA_OUTPUT_ROOT=/home/agent/shinka-runs
RUN mkdir -p /app/working-dir/shinka-runs &&\
    chown -R 65532:0 /app/working-dir/shinka-runs

COPY --chown=65532:0 workspace/ /app/working-dir/

USER 65532
