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

# Bob shell harness — pinned tgz + sha256 instead of `curl | bash` from the
# upstream installer. Bobshell is not on npmjs.org; the only distribution
# channel is the IBM Cloud Object Storage bucket below. Pinning the version
# AND verifying a recorded sha256 means a compromised bucket would have to
# match the hash to land in our image build. Bump both args together when
# moving bobshell forward.
ARG BOBSHELL_VERSION=1.0.3
ARG BOBSHELL_SHA256=9c0057498e52e301c97781db8b82abfd67c34273f8daa270dbb6be639f243a4f
RUN curl -fsSLo /tmp/bobshell.tgz \
      "https://s3.us-south.cloud-object-storage.appdomain.cloud/bobshell/bobshell-${BOBSHELL_VERSION}.tgz" \
    && echo "${BOBSHELL_SHA256}  /tmp/bobshell.tgz" | sha256sum -c - \
    && npm install -g /tmp/bobshell.tgz \
    && rm /tmp/bobshell.tgz \
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
