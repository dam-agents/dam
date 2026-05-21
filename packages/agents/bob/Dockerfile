ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}


USER root

# Bob installer — bobshell isn't on npmjs.org; bob.ibm.com is the
# official distribution channel. `--pm npm` skips pnpm/yarn detection.
RUN --mount=type=cache,target=/root/.npm \
    curl -fsSL https://bob.ibm.com/download/bobshell.sh \
    | bash -s -- --pm npm \
    && chown -R 65532:0 /app

# Bob needs Node 24+ — platform-base Node 22 segfaults the TUI inside
# node-pty (SIGSEGV in React commit). Harnesses pin /opt/node24/bin/node.
ARG NODE24_VERSION=24.0.0
ARG TARGETARCH
RUN ARCH="$TARGETARCH"; case "$ARCH" in amd64) NODE_ARCH=x64;; arm64) NODE_ARCH=arm64;; *) echo "Unsupported arch: $ARCH" && exit 1;; esac \
    && curl -fsSL "https://nodejs.org/dist/v${NODE24_VERSION}/node-v${NODE24_VERSION}-linux-${NODE_ARCH}.tar.gz" -o /tmp/node24.tar.gz \
    && mkdir -p /opt/node24 \
    && tar -xzf /tmp/node24.tar.gz -C /opt/node24 --strip-components=1 \
    && rm /tmp/node24.tar.gz \
    && /opt/node24/bin/node --version

# os.userInfo() needs a /etc/passwd entry for uid 65532 — distroless
# base has none and bob crashes during initializeStorage().
RUN echo 'agent:x:65532:0:Agent User:/home/agent:/sbin/nologin' >> /etc/passwd

COPY bob-acp-shim.mjs /app/bob-acp-shim.mjs
COPY harness-chat.sh /usr/local/bin/harness-chat
COPY harness-terminal.sh /usr/local/bin/harness-terminal
RUN chmod +x /usr/local/bin/harness-chat /usr/local/bin/harness-terminal

COPY --chown=65532:0 workspace/ /app/working-dir/

# Bob's default auth is W3ID SSO — opens a browser that never arrives
# in-pod, then blocks for 3 minutes. Force api-key for every bob exec.
ENV BOBSHELL_DEFAULT_AUTH_TYPE=api-key

USER 65532
