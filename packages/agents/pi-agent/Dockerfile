ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}

USER root

# The platform-base nodejs24 package ships without full ICU data, so
# `Intl.Segmenter::Create` segfaults inside V8 the moment any code touches it.
# pi's interactive TUI calls Intl.Segmenter on every keystroke for grapheme
# handling, so the terminal session crashes immediately. Pulling in the
# full-i18n companion package supplies the ICU data and resolves the crash.
# (`pi --print` and `pi-acp` happen to not exercise this path before
# producing output, which is why they appeared to work.)
RUN dnf install -y nodejs24-full-i18n && dnf clean all

# Pi harness — versions pinned so rebuilds are reproducible. Bump deliberately
# and keep the @earendil-works/pi-coding-agent version in sync with the
# pi-dynamic-providers extension's devDependency
# (workspace/.pi/agent/extensions/pi-dynamic-providers/package.json) so the
# extension type-checks against the same fork it actually loads against.
ARG PI_CODING_AGENT_VERSION=0.75.5
ARG PI_ACP_VERSION=0.0.27
ARG PI_MEMORY_VERSION=1.0.2
RUN --mount=type=cache,target=/root/.npm \
    npm install -g \
      "@earendil-works/pi-coding-agent@${PI_CODING_AGENT_VERSION}" \
      "pi-acp@${PI_ACP_VERSION}" \
      "@zhafron/pi-memory@${PI_MEMORY_VERSION}" \
    && chown -R 65532:0 /app

COPY harness-chat.sh /usr/local/bin/harness-chat
COPY harness-terminal.sh /usr/local/bin/harness-terminal
RUN chmod +x /usr/local/bin/harness-chat /usr/local/bin/harness-terminal

COPY --chown=65532:0 workspace/ /app/working-dir/

USER 65532
