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
# uv comes from the base image's lazy installers; first use here bakes it in.
ENV UV_PYTHON_INSTALL_DIR=/opt/uv/python \
    OPENEVOLVE_VENV=/opt/openevolve-venv

RUN uv python install 3.11 &&\
    uv venv --python 3.11 "$OPENEVOLVE_VENV" &&\
    uv pip install --python "$OPENEVOLVE_VENV/bin/python" "openevolve==${OPENEVOLVE_VERSION}" &&\
    chown -R 65532:0 /opt/openevolve-venv /opt/uv

# Put the venv (and thus `openevolve-run`, `python`) ahead of the base tools.
ENV PATH="/opt/openevolve-venv/bin:${PATH}"

# claude-code symlinks /etc/claude-code/CLAUDE.md -> /etc/AGENTS.md; the
# behavioral policy (pre-launch gate, resume-on-wake, guardrails) lives here.
COPY AGENTS.md /etc/AGENTS.md

# Runs live in the work dir (where the UI and terminal look), created lazily
# by the agent at first run — NEVER pre-baked here: the first-boot seed would
# make the work dir non-empty and the platform's repo seed (which clones into
# the work-dir root and refuses a non-empty dir) would fail.
ENV OPENEVOLVE_OUTPUT_ROOT=/home/agent/work/openevolve-runs

COPY --chown=65532:0 workspace/ /app/working-dir/

USER 65532
