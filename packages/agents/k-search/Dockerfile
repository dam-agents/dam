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
    sed -i 's/dataset_src: str = "huggingface"/dataset_src: str = "local"/g' "${KSEARCH_ROOT}/k_search/tasks/kernelbench_task.py" && \
    sed -i 's/self.dataset_src = "huggingface"/self.dataset_src = "local"/g' "${KSEARCH_ROOT}/k_search/tasks/kernelbench/run_and_check.py" && \
    ! grep -nE '(dataset_src: str|self\.dataset_src) = "huggingface"' "${KSEARCH_ROOT}/k_search/tasks/kernelbench_task.py" "${KSEARCH_ROOT}/k_search/tasks/kernelbench/run_and_check.py" && \
    chown -R 65532:0 "${KSEARCH_ROOT}" "${VIRTUAL_ENV}" "${UV_PYTHON_INSTALL_DIR}"

# ACP shim deps (agent-runtime requires a live harness-chat).
RUN --mount=type=cache,target=/root/.npm \
    mkdir -p /opt/ksearch-acp && cd /opt/ksearch-acp && \
    npm init -y >/dev/null && \
    npm install @agentclientprotocol/sdk@0.17.1 zod@^4 && \
    chown -R 65532:0 /opt/ksearch-acp
COPY ksearch-acp-shim.mjs /opt/ksearch-acp/ksearch-acp-shim.mjs

COPY harness-chat.sh /usr/local/bin/harness-chat
COPY harness-terminal.sh /usr/local/bin/harness-terminal
COPY ksearch-run.sh /usr/local/bin/ksearch-run
# .pth auto-loads the modal proxy patch in every venv interpreter.
COPY dam_modal_proxy_patch.py ${VIRTUAL_ENV}/lib/python3.12/site-packages/dam_modal_proxy_patch.py
RUN chmod +x /usr/local/bin/harness-chat /usr/local/bin/harness-terminal /usr/local/bin/ksearch-run && \
    printf 'import dam_modal_proxy_patch\n' > "${VIRTUAL_ENV}/lib/python3.12/site-packages/zz_dam_modal_proxy.pth" && \
    chown 65532:0 "${VIRTUAL_ENV}/lib/python3.12/site-packages/dam_modal_proxy_patch.py" \
                  "${VIRTUAL_ENV}/lib/python3.12/site-packages/zz_dam_modal_proxy.pth"
COPY --chown=65532:0 workspace/ /app/working-dir/

# Placeholder only; the real key is injected at the gateway, never in-pod.
ENV OPENAI_API_KEY=dummy-placeholder

USER 65532
