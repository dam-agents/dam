ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}

# SECURITY NOTE — autonomy posture
# --------------------------------------------------------------------
# Bob launches with `bob --experimental-acp --yolo` (see bob-acp-shim.mjs),
# meaning Bob itself never asks the user to approve a tool call. The shim
# *also* auto-selects the first `allow_always`/`allow_once` option on
# every `session/request_permission` from Bob — so the platform UI never
# shows a permission chip for Bob the way it does for Claude/Codex/Pi.
#
# This is intentional and matches upstream bobshell's deployment shape.
# The trust boundary is the Envoy egress sidecar (ADR-033/038): Bob can
# write into its workdir and exec shell commands freely, but every
# outbound HTTP request still goes through the per-instance credential
# gateway with ext_authz / egress-rules enforcement, and the agent
# container has no SA token, no Secret volume mounts, and no Envoy
# config it can rewrite (ADR-033 §Threat Model).
#
# If you need per-tool human-in-the-loop confirmation for Bob, that has
# to be re-introduced upstream — the shim's pickAllowOption() function
# would need to fall through to an interactive path. We do NOT recommend
# patching it locally without coordinating with the upstream Bob team.
# --------------------------------------------------------------------

USER root

# Bob shell harness — installer is the upstream-recommended entrypoint
# served from IBM's internal S3 bucket (the only distribution channel —
# bobshell is not on npmjs.org). The bucket is trusted, so we use the
# installer's own version detection rather than pinning. `--pm npm` pins
# the package manager so it doesn't try to detect pnpm/yarn from the
# platform-base layer.
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
