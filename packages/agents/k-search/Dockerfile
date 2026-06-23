ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}

USER root

ARG KSEARCH_REF=main
ARG KERNELBENCH_REF=main
ENV KSEARCH_ROOT=/opt/k-search \
    VIRTUAL_ENV=/opt/ksearch-venv \
    PATH=/opt/ksearch-venv/bin:$PATH \
    UV_PYTHON_INSTALL_DIR=/opt/uv-python

RUN git clone --depth 1 -b "${KSEARCH_REF}" https://github.com/caoshiyi/K-Search.git "${KSEARCH_ROOT}" && \
    git clone --depth 1 -b "${KERNELBENCH_REF}" https://github.com/ScalingIntelligence/KernelBench.git /opt/kernelbench && \
    cp -R /opt/kernelbench/src "${KSEARCH_ROOT}/k_search/tasks/src" && \
    cp -R /opt/kernelbench/scripts "${KSEARCH_ROOT}/k_search/tasks/scripts" && \
    cp -R /opt/kernelbench/KernelBench "${KSEARCH_ROOT}/k_search/tasks/KernelBench" && \
    cp /opt/kernelbench/pyproject.toml "${KSEARCH_ROOT}/k_search/tasks/pyproject.toml" && \
    [ -f /opt/kernelbench/uv.lock ] && cp /opt/kernelbench/uv.lock "${KSEARCH_ROOT}/k_search/tasks/uv.lock" || true && \
    uv venv "${VIRTUAL_ENV}" --python 3.12 && \
    uv pip install --python "${VIRTUAL_ENV}/bin/python" openai modal "/opt/kernelbench[gpu]" && \
    chown -R 65532:0 "${KSEARCH_ROOT}" "${VIRTUAL_ENV}" "${UV_PYTHON_INSTALL_DIR}"

# Minimal ACP agent for chat-mode: agent-runtime spawns harness-chat at boot and
# crashes if it exits, so K-Search ships a small ACP shim (Node, @agentclientprotocol/sdk)
# that stays alive and runs the kernel-opt job on prompt.
RUN --mount=type=cache,target=/root/.npm \
    mkdir -p /opt/ksearch-acp && cd /opt/ksearch-acp && \
    npm init -y >/dev/null && \
    npm install @agentclientprotocol/sdk@0.17.1 zod@^4 && \
    chown -R 65532:0 /opt/ksearch-acp
COPY ksearch-acp-shim.mjs /opt/ksearch-acp/ksearch-acp-shim.mjs

COPY harness-chat.sh /usr/local/bin/harness-chat
COPY harness-terminal.sh /usr/local/bin/harness-terminal
COPY ksearch-run.sh /usr/local/bin/ksearch-run
# Route the modal client through DAM's HTTPS_PROXY gateway. Installed as a .pth
# so it auto-loads in every venv interpreter — including the run_and_check.py
# subprocess that actually talks to Modal.
COPY dam_modal_proxy_patch.py ${VIRTUAL_ENV}/lib/python3.12/site-packages/dam_modal_proxy_patch.py
RUN chmod +x /usr/local/bin/harness-chat /usr/local/bin/harness-terminal /usr/local/bin/ksearch-run && \
    printf 'import dam_modal_proxy_patch\n' > "${VIRTUAL_ENV}/lib/python3.12/site-packages/zz_dam_modal_proxy.pth" && \
    chown 65532:0 "${VIRTUAL_ENV}/lib/python3.12/site-packages/dam_modal_proxy_patch.py" \
                  "${VIRTUAL_ENV}/lib/python3.12/site-packages/zz_dam_modal_proxy.pth"
COPY --chown=65532:0 workspace/ /app/working-dir/

# Placeholder satisfies the OpenAI client startup check; real key injected on
# the wire via the LiteLLM proxy. MODAL_TOKEN_ID/SECRET are NOT declared here —
# they carry real values and arrive in-pod at runtime via the Agent SecretRef
# (envFrom), since the modal client consumes them itself (no gateway injection).
ENV OPENAI_API_KEY=dummy-placeholder

USER 65532
