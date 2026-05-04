# ADR-010: OneCLI deployment — single image, two Services, platform-managed lifecycle

**Date:** 2026-04-02
**Status:** Superseded by [ADR-033](033-envoy-credential-gateway.md)
**Owner:** @pilartomas

## Context

OneCLI is the credential-injecting gateway that enforces ADR-005 (agent never sees tokens). It ships as a single Docker image (`ghcr.io/onecli/onecli:latest`) containing both a Rust gateway and a Node.js web dashboard, started via `entrypoint.sh`. There is no upstream Helm chart — the project must define its own K8s manifests.

The platform also needs to programmatically manage OneCLI: provision per-agent tokens, configure per-service rules, and invalidate caches when credentials rotate. OneCLI requires PostgreSQL as a hard dependency (no SQLite support).

## Decision

Deploy OneCLI as one Deployment with two Services pointing at different ports on the same pod:

- **Gateway Service** — port 10255, handles MITM proxy traffic from agent pods
- **Web Service** — port 10254, serves the admin dashboard for rule configuration

Supporting infrastructure:

- **cert-manager** generates a self-signed ECDSA CA (PKCS8 format) for OneCLI's MITM TLS. The CA cert is stored in a Secret and volume-mounted into agent pods via `SSL_CERT_FILE` so they trust the gateway's intercepted connections.
- **PostgreSQL** deployed as a separate StatefulSet in the Helm chart. This is OneCLI's internal dependency — neither the Controller nor the API Server touches it.
- **Controller integration** — the Controller uses OneCLI's REST API to provision agent tokens and invalidate caches when agent instances are created, updated, or deleted.

## Alternatives Considered

**Separate containers for gateway and web.** Split into two Deployments. Rejected: OneCLI's image is designed to run both processes together. Splitting would require custom entrypoints, and the two processes share state (config, database connection). No operational benefit for the added complexity.

**Upstream Helm chart.** Wait for or contribute a Helm chart to the OneCLI project. Rejected for now: no upstream chart exists, and the platform needs custom integration (cert-manager CA, Controller-managed tokens). A platform-owned chart gives full control. Can contribute upstream once patterns stabilize.

**SQLite instead of PostgreSQL.** Would eliminate the database dependency. Rejected: OneCLI has no SQLite support — PostgreSQL is a hard requirement. Accepted as OneCLI's dependency, not the platform's.

**No OneCLI — build credential injection in-house.** Eliminate the OneCLI dependency entirely and implement credential injection directly in the platform. Attractive because OneCLI does not yet support human-in-the-loop flows (though it is on their roadmap). This is problematic when the platform needs targeted human-in-the-loop interactions for specific third parties (e.g., GitHub OAuth device flow) where the credential proxy must pause and prompt the user. Kept as a future option if OneCLI's roadmap doesn't deliver HITL support, but rejected for now: OneCLI already solves the harder MITM proxy and credential-injection plumbing, and rebuilding that from scratch is a significant effort.

## Consequences

- Single pod simplifies deployment but means gateway and dashboard scale together
- cert-manager dependency adds installation complexity but provides automatic CA rotation
- PostgreSQL is an operational burden (backups, storage) even though only OneCLI uses it
- Controller's programmatic integration with OneCLI's REST API creates a coupling — OneCLI API changes can break the Controller
- The CA cert distribution pattern (`SSL_CERT_FILE` volume mount) must be applied to every agent pod template
