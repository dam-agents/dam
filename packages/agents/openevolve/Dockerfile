# OpenEvolve agent — an evolutionary code-optimization workload. Built FROM the
# claude-code image (not platform-base) on purpose: the agent is Claude Code,
# which shells out to OpenEvolve's `openevolve-run` for the evolution loop.
# Inheriting the claude-code harness gives it the model gateway and CA trust, so
# the pod holds no model key, exactly like the Claude Code harness.
#
# OpenEvolve installs from PyPI (no vendoring); the build is a plain `docker build`.
# Override the pinned version with `--build-arg OPENEVOLVE_VERSION=<v>`.
ARG BASE_IMAGE=platform-claude-code
FROM ${BASE_IMAGE}

USER root

# Pinned OpenEvolve release. Bump here (or pass --build-arg OPENEVOLVE_VERSION=...).
ARG OPENEVOLVE_VERSION=0.2.27

# uv-managed Python in a shared location so the agent user (uid 65532) can use
# it at runtime. UV_PYTHON_INSTALL_DIR keeps interpreters out of root's $HOME.
# uv itself is provided by the mise-managed base image.
ENV UV_PYTHON_INSTALL_DIR=/opt/uv/python \
    OPENEVOLVE_VENV=/opt/openevolve-venv

RUN uv python install 3.11 &&\
    uv venv --python 3.11 "$OPENEVOLVE_VENV" &&\
    uv pip install --python "$OPENEVOLVE_VENV/bin/python" "openevolve==${OPENEVOLVE_VERSION}" &&\
    chown -R 65532:0 /opt/openevolve-venv /opt/uv

# Put the venv (and thus `openevolve-run`, `python`) ahead of the base tools.
ENV PATH="/opt/openevolve-venv/bin:${PATH}"

# OpenEvolve's loop calls the model endpoint via the OpenAI SDK (httpx), which
# defaults to certifi's bundle and so misses the egress-gateway CA the platform
# injects into the system store at runtime (curl and the node driver trust it; a
# bare Python httpx call wouldn't, failing TLS verification). Point Python's TLS
# clients at the system bundle — httpx honors SSL_CERT_FILE, requests honors
# REQUESTS_CA_BUNDLE.
ENV SSL_CERT_FILE=/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem \
    REQUESTS_CA_BUNDLE=/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem

# claude-code symlinks /etc/claude-code/CLAUDE.md -> /etc/AGENTS.md; the
# behavioral policy (pre-launch gate, resume-on-wake, guardrails) lives here.
COPY AGENTS.md /etc/AGENTS.md

# Run outputs (target clones + checkpoints) persist on $HOME. /app/working-dir is
# ephemeral image content the agent init seeds into $HOME on first boot, so create
# the dir under the seed and point the env at the persisted path.
ENV OPENEVOLVE_OUTPUT_ROOT=/home/agent/openevolve-runs
RUN mkdir -p /app/working-dir/openevolve-runs &&\
    chown -R 65532:0 /app/working-dir/openevolve-runs

COPY --chown=65532:0 workspace/ /app/working-dir/

USER 65532
