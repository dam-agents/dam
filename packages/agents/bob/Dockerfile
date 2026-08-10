ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}

USER root

ARG BOBSHELL_VERSION=2.0.0
ARG BOBSHELL_SHA256=de2d773e7e7a79cddf671d1019c8852f58b4c4472f96eccf4a23b9feac620812
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
# 2.0's RuleLoader reads <workspace>/.bob/rules/ (every file appended to the
# system prompt); the 1.x context.fileName lookup and system-defaults.json are
# gone, so platform instructions ride in as a rules file instead.
RUN chmod 755 /usr/local/bin/harness-chat /usr/local/bin/harness-terminal &&\
    mkdir -p /app/working-dir/.bob/rules &&\
    ln -s /etc/AGENTS.md /app/working-dir/.bob/rules/platform.md &&\
    ln -s ../.agents/skills /app/working-dir/.bob/skills

COPY --chown=65532:0 runtime-manifest.yaml /app/runtime-manifest.yaml
COPY --chown=65532:0 workspace/ /app/working-dir/

USER 65532
