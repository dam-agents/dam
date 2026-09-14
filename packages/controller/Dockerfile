FROM --platform=$BUILDPLATFORM registry.access.redhat.com/hi/go:1.25-builder AS builder

# The hardened base pins GOTOOLCHAIN=local at Go 1.25.10; honor go.mod's
# toolchain directive instead so the build picks up patched stdlib (1.25.11).
ENV GOTOOLCHAIN=auto

WORKDIR /app
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY . .
ARG TARGETOS TARGETARCH
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH} \
    go build -o /controller . && \
    for arch in amd64 arm64; do \
      CGO_ENABLED=0 GOOS=linux GOARCH=$arch go build -o /sandbox-node-$arch ./cmd/sandbox-node; \
    done

FROM registry.access.redhat.com/hi/core-runtime:latest AS runner

USER 65532

COPY --from=builder --chown=65532:0 /controller /usr/local/bin/controller
# Both node architectures ship in every image: the provisioner Job uploads the
# one matching the sandbox node, which need not match the cluster's.
COPY --from=builder --chown=65532:0 /sandbox-node-amd64 /sandbox-node-arm64 /usr/local/lib/platform/

ENTRYPOINT ["controller"]
