ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}

USER root

ARG BOBSHELL_VERSION=1.0.5
ARG BOBSHELL_SHA256=38fe36e42318282d8b440340a776bb16eaefe3eaa2681184c786373b501f2bf7
RUN --mount=type=cache,target=/root/.npm \
    curl -fsSL "https://s3.us-south.cloud-object-storage.appdomain.cloud/bob-shell/bobshell-${BOBSHELL_VERSION}.tgz" -o /tmp/bobshell.tgz &&\
    echo "${BOBSHELL_SHA256} /tmp/bobshell.tgz" | sha256sum -c - &&\
    npm install -g /tmp/bobshell.tgz &&\
    rm /tmp/bobshell.tgz &&\
    mise reshim &&\
    chown -R 65532:0 /app

COPY bob-acp-shim.mjs /app/bob-acp-shim.mjs
COPY harness-chat.sh /usr/local/bin/harness-chat
COPY harness-terminal.sh /usr/local/bin/harness-terminal
RUN chmod 755 /usr/local/bin/harness-chat /usr/local/bin/harness-terminal &&\
    mkdir -p /etc/bobshell &&\
    printf '{"context":{"fileName":["/etc/AGENTS.md"]}}\n' >/etc/bobshell/system-defaults.json &&\
    mkdir -p /app/working-dir/.bob &&\
    ln -s ../.agents/skills /app/working-dir/.bob/skills

COPY --chown=65532:0 runtime-manifest.yaml /app/runtime-manifest.yaml
COPY --chown=65532:0 workspace/ /app/working-dir/
ENV BOBSHELL_DEFAULT_AUTH_TYPE=api-key

USER 65532
