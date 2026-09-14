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
    go build -o /controller .

FROM registry.access.redhat.com/hi/core-runtime:latest AS runner

USER 65532

COPY --from=builder --chown=65532:0 /controller /usr/local/bin/controller

ENTRYPOINT ["controller"]
