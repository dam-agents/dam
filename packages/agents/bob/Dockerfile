ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}

USER root

# Bob shell harness — installer is the upstream-recommended entrypoint and
# pulls bob + its npm deps under /usr/local. `--pm npm` pins the package
# manager so it doesn't try to detect pnpm/yarn from the platform-base layer.
RUN curl -fsSL https://s3.us-south.cloud-object-storage.appdomain.cloud/bobshell/install-bobshell.sh \
    | bash -s -- --pm npm \
    && chown -R 65532:0 /app

# Bob's storage layer calls os.userInfo() to derive a local encryption key,
# which libuv resolves via getpwuid_r against /etc/passwd. The platform-base
# image runs as uid 65532 (distroless-style) without a passwd entry, so the
# call fails with ENOENT and bob crashes during initializeStorage(). Add a
# minimal entry so the lookup succeeds. /sbin/nologin keeps the account
# non-interactive — bob only needs the lookup to resolve, not to log in.
RUN echo 'agent:x:65532:0:Agent User:/home/agent:/sbin/nologin' >> /etc/passwd

COPY bob-acp-shim.mjs /app/bob-acp-shim.mjs
COPY harness-chat.sh /usr/local/bin/harness-chat
COPY harness-terminal.sh /usr/local/bin/harness-terminal
RUN chmod +x /usr/local/bin/harness-chat /usr/local/bin/harness-terminal

COPY --chown=65532:0 workspace/ /app/working-dir/

USER 65532
