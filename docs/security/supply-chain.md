# Supply-chain security

Last verified: 2026-06-02

Motivated by: operational policy, not an architectural decision — no ADR.

| Dependency type | CVE defense | Zero-day defense |
|---|---|---|
| **npm (pnpm)** | **Mend SCA** via `daily.yml` — scans lockfile for transitive CVEs, auto-files GitHub issues. **Dependabot** — direct-dep advisories, auto-files PRs. **pnpm audit** — runs on PRs and daily via `mise run scan`, checks the npm advisory database. Remediation: transitive → scoped `pnpm.overrides`; direct → bump in workspace `package.json`. | Lockfile pins exact versions (`--frozen-lockfile` in CI). `minimumReleaseAge` (7 days) blocks freshly-published packages. `trustPolicy: no-downgrade` blocks rollbacks to less-trusted versions. `allowBuilds` allowlist restricts which packages may run postinstall scripts. `common:check:lockfile-age` mise task enforces the 7-day policy independently of pnpm. |
| **Go modules** | **Mend SCA** via `daily.yml` — covers Go lockfiles. **Dependabot** — configured for `/packages/controller`. **govulncheck** — runs on PRs and daily via `mise run scan`, checks compiled call graph against the Go vuln DB. Remediation: bump `go.mod` + `go mod tidy`. | Pinned by `go.sum` checksum database. Go module proxy verifies checksums against the public sumdb. |
| **Container base images** | **Quay Clair** — scans every pushed image (OS packages + language deps). `daily.yml` polls Clair API, auto-files GitHub issues. Rescans on CVE DB updates. Remediation: rebuild and push. | Red Hat UBI images pinned by major.minor tag. Keycloak pinned by digest. Images sourced from trusted registries (Red Hat, Quay.io). |
| **Third-party container runtime images** | **Not scanned by us.** [Red Hat Hardened Images](https://images.redhat.com/) used wherever possible (`postgresql`, `valkey`, `curl`). Envoy proxy uses an official distroless image. Some utility-only images are from other sources (`quay.io/adorsys/keycloak-config-cli`, `alpine/k8s`). | Tag-pinned in `values.yaml`. Sourced from trusted registries (Red Hat, `registry.k8s.io`). Manual bump only. |
| **GitHub Actions** | **Dependabot** — configured for `github-actions` ecosystem, weekly. Auto-files PRs for advisory-affected actions. | Pinned by full commit SHA with version comment (e.g. `actions/checkout@<sha> # v6.0.2`). Tag-only references not used — immune to tag rewriting. |
| **mise dev tools** | **Not scanned.** At time of writing, Dependabot and Mend both have open tickets for adding support. | Version-pinned in `mise.toml`. `mise.lock` pins resolved versions with per-platform SHA-256 checksums. |
