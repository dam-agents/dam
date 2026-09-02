# SkyDiscover on the claude-code base: the agent is Claude Code shelling out
# to `skydiscover-run`; the inherited harness brings the model gateway and CA
# trust, so the pod holds no model key. One image backs two curated presets —
# AdaEvolve and EvoX — which differ only in the SKYDISCOVER_SEARCH env the
# agent template injects (see deploy/helm/platform/values.yaml).
ARG BASE_IMAGE=platform-claude-code
FROM ${BASE_IMAGE}

USER root

# Pinned git ref, not a PyPI pin: the 0.1.0 wheel (latest release) predates
# EvoX's config data files — its code loads search/evox/config/search.yaml,
# which landed upstream only after the release, so `--search evox` crashes at
# startup on every released wheel. The repo's package-data now ships the
# config, so a source install at a pinned commit gives consistent code +
# config. Switch back to `skydiscover==<version>` on the next release that
# carries search/evox/config/.
ARG SKYDISCOVER_REF=e221cde39a787351df7e52c656ad3f00add402fe

# shared location so the agent user (uid 65532) can use it at runtime
ENV UV_PYTHON_INSTALL_DIR=/opt/uv/python \
    SKYDISCOVER_VENV=/opt/skydiscover-venv

# Base package only: AdaEvolve and EvoX are SkyDiscover's own strategies and
# need no extras. The `external` extra (openevolve/gepa/shinkaevolve wrappers)
# is deliberately not installed — those backends ship as their own workload
# images. scipy IS baked in: the venv resets with every pod restart and
# nearly every numerical task reaches for it, so runtime-installing it cost
# minutes on each fresh pod; the rest of the heavy `math` extra (torch, jax,
# …) stays runtime-installed per run when a task actually needs it.
RUN uv python install 3.11 &&\
    # The standalone interpreter's own site-packages ships setuptools 82.0.1
    # (CVE-2026-59890) — the venv floor below does not reach it, and uv marks
    # the install externally managed, hence --break-system-packages.
    uv pip install --python "$(uv python find 3.11)" --break-system-packages "setuptools>=83.0.0" &&\
    uv venv --python 3.11 "$SKYDISCOVER_VENV" &&\
    uv pip install --python "$SKYDISCOVER_VENV/bin/python" \
      "skydiscover @ git+https://github.com/skydiscover-ai/skydiscover@${SKYDISCOVER_REF}" \
      scipy \
      "setuptools>=83.0.0" \
      "msgpack>=1.2.1" &&\
    uv cache clean &&\
    chown -R 65532:0 /opt/skydiscover-venv /opt/uv

# fail the build if the installed package misses EvoX's config data files
# (the exact gap the git-ref install exists to close)
RUN "$SKYDISCOVER_VENV/bin/python" - <<'EOF'
import pathlib, yaml, skydiscover
pkg = pathlib.Path(skydiscover.__file__).parent
cfg = pkg / "search/evox/config"
assert yaml.safe_load((cfg / "search.yaml").read_text()), "empty search.yaml"
assert (cfg / "evox_search_sys_prompt.txt").stat().st_size > 0, "empty sys prompt"
# Inverted canary: agentic mode is documented as unsupported because upstream
# packaging omits the tool schemas. If a future ref ships them, fail the build
# so the skill's "unsupported" note gets updated instead of silently rotting.
assert not (pkg / "llm/tool_schemas").exists(), \
    "tool_schemas now ships — agentic mode may work; update the skydiscover skill"
print("evox config ok; agentic still unpackaged")
EOF

ENV PATH="/opt/skydiscover-venv/bin:${PATH}"

# behavioral policy; claude-code symlinks /etc/claude-code/CLAUDE.md here
COPY AGENTS.md /etc/AGENTS.md

# Deliberately NO baked SKYDISCOVER_SEARCH default: the harness env merge
# lets container env win name collisions, so an image-baked value would
# permanently shadow the preset the template injects over the runtime env
# rail (adaevolve vs evox). The template presets are the only source;
# AGENTS.md documents the adaevolve fallback for preset-less runs.

# /app/working-dir is seeded onto persistent $HOME on first boot
# Runs live in the work dir (where the UI and terminal look), created lazily
# by the agent at first run — NEVER pre-baked here: the first-boot seed would
# make the work dir non-empty and the platform's repo seed (which clones into
# the work-dir root and refuses a non-empty dir) would fail.
ENV SKYDISCOVER_OUTPUT_ROOT=/home/agent/work/skydiscover-runs

COPY --chown=65532:0 workspace/ /app/working-dir/

USER 65532
