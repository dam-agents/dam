# ShinkaEvolve on the claude-code base: the agent is Claude Code shelling out
# to `shinka_run`; the inherited harness brings the model gateway and CA trust,
# so the pod holds no model key.
ARG BASE_IMAGE=platform-claude-code

# The runner base has no package manager (sysroot-built, see platform-base);
# stage the sqlite3 CLI the same way — AGENTS.md has the agent polling run
# progress with sqlite queries against results/programs.sqlite.
FROM registry.access.redhat.com/hi/core-runtime:latest-builder AS sqlite-cli
USER root
RUN dnf install \
    -y \
    --installroot=/sqlite \
    --use-host-config \
    --releasever="$(. /etc/os-release; echo "$VERSION_ID")" \
    --setopt=install_weak_deps=0 \
    sqlite \
    &&\
    rm -rf /sqlite/var/lib/dnf /sqlite/var/cache /sqlite/var/log

FROM ${BASE_IMAGE}

USER root

COPY --from=sqlite-cli /sqlite/usr/bin/sqlite3 /usr/bin/sqlite3
COPY --from=sqlite-cli /sqlite/usr/lib64/libsqlite3.so.* /usr/lib64/
# fail the build if any transitive shared-library dep is missing from the base
RUN sqlite3 -version

ARG SHINKA_VERSION=0.0.7

# shared location so the agent user (uid 65532) can use it at runtime
ENV UV_PYTHON_INSTALL_DIR=/opt/uv/python \
    SHINKA_VENV=/opt/shinka-venv

RUN uv python install 3.11 &&\
    # The standalone interpreter's own site-packages ships setuptools 82.0.1
    # (CVE-2026-59890) — the venv floor below does not reach it, and uv marks
    # the install externally managed, hence --break-system-packages.
    uv pip install --python "$(uv python find 3.11)" --break-system-packages "setuptools>=83.0.0" &&\
    uv venv --python 3.11 "$SHINKA_VENV" &&\
    # pillow floor: CVE-2026-25990, -40192, -42308..11, -54058..60
    # hydra-core floor (CVE-2026-68508) has to be an --override, not a plain
    # requirement: shinka-evolve hard-pins hydra-core==1.3.2, so a floor is an
    # unsatisfiable conflict. Stays on the 1.3 line, which is API-compatible;
    # the import check below is what proves it.
    printf 'hydra-core>=1.3.4,<1.4\n' > /tmp/overrides.txt &&\
    uv pip install --python "$SHINKA_VENV/bin/python" --override /tmp/overrides.txt \
      "shinka-evolve==${SHINKA_VERSION}" "pillow>=12.3.0" "setuptools>=83.0.0" "msgpack>=1.2.1" &&\
    rm /tmp/overrides.txt &&\
    "$SHINKA_VENV/bin/python" -c 'import shinka, hydra' &&\
    uv cache clean &&\
    chown -R 65532:0 /opt/shinka-venv /opt/uv

ENV PATH="/opt/shinka-venv/bin:${PATH}"

# behavioral policy; claude-code symlinks /etc/claude-code/CLAUDE.md here
COPY AGENTS.md /etc/AGENTS.md

# Runs live in the work dir (where the UI and terminal look), created lazily
# by the agent at first run — NEVER pre-baked here: the first-boot seed would
# make the work dir non-empty and the platform's repo seed (which clones into
# the work-dir root and refuses a non-empty dir) would fail.
ENV SHINKA_OUTPUT_ROOT=/home/agent/work/shinka-runs

COPY --chown=65532:0 workspace/ /app/working-dir/

USER 65532
