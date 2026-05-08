ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}

USER root

# The platform-base nodejs22 package ships without full ICU data, so
# `Intl.Segmenter::Create` segfaults inside V8 the moment any code touches it.
# pi's interactive TUI calls Intl.Segmenter on every keystroke for grapheme
# handling, so the terminal session crashes immediately. Pulling in the
# full-i18n companion package supplies the ICU data and resolves the crash.
# (`pi --print` and `pi-acp` happen to not exercise this path before
# producing output, which is why they appeared to work.)
RUN dnf install -y nodejs22-full-i18n && dnf clean all

# Pi harness
RUN npm install -g @earendil-works/pi-coding-agent pi-acp @zhafron/pi-memory \
    && chown -R 65532:0 /app

COPY harness-chat.sh /usr/local/bin/harness-chat
COPY harness-terminal.sh /usr/local/bin/harness-terminal
RUN chmod +x /usr/local/bin/harness-chat /usr/local/bin/harness-terminal

COPY --chown=65532:0 workspace/ /app/working-dir/

USER 65532
