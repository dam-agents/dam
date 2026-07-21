# GEPA on the claude-code base: GEPA ships no CLI, so the agent is Claude Code
# authoring and running Python driver scripts against the gepa library; the
# inherited harness brings the model gateway and CA trust, so the pod holds no
# model key.
ARG BASE_IMAGE=platform-claude-code
FROM ${BASE_IMAGE}

USER root

ARG GEPA_VERSION=0.1.4

# shared location so the agent user (uid 65532) can use it at runtime
ENV UV_PYTHON_INSTALL_DIR=/opt/uv/python \
    GEPA_VENV=/opt/gepa-venv

# gepa's [full] extra minus mlflow/wandb: AGENTS.md forbids enabling the
# tracking stacks, and full mlflow alone drags Flask/matplotlib/scikit-learn
# (hundreds of MB + Trivy CVE surface). Pins copied from gepa 0.1.4 metadata —
# revisit on GEPA_VERSION bumps. The `gskill` extra needs Docker-in-Docker and
# is deliberately not installed.
RUN uv python install 3.11 &&\
    uv venv --python 3.11 "$GEPA_VENV" &&\
    uv pip install --python "$GEPA_VENV/bin/python" \
      "gepa==${GEPA_VERSION}" \
      "litellm>=1.83.0,<1.92" \
      "tqdm>=4.66.1" \
      "cloudpickle>=3.0.0" \
      "datasets>=2.14.6" &&\
    uv cache clean &&\
    chown -R 65532:0 /opt/gepa-venv /opt/uv

ENV PATH="/opt/gepa-venv/bin:${PATH}"

# httpx/requests default to certifi's bundle and would miss the gateway CA
ENV SSL_CERT_FILE=/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem \
    REQUESTS_CA_BUNDLE=/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem

# behavioral policy; claude-code symlinks /etc/claude-code/CLAUDE.md here
COPY AGENTS.md /etc/AGENTS.md

# /app/working-dir is seeded onto persistent $HOME on first boot
ENV GEPA_OUTPUT_ROOT=/home/agent/gepa-runs
RUN mkdir -p /app/working-dir/gepa-runs &&\
    chown -R 65532:0 /app/working-dir/gepa-runs

COPY --chown=65532:0 workspace/ /app/working-dir/

USER 65532
