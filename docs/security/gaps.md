# Security gaps

Last verified: 2026-06-02

Motivated by: operational policy, not an architectural decision — no ADR.

Known gaps tracked as future work:

- **Runtime container scanning** (Falco, kube-bench) — we rely on image scans pre-deploy; nothing watches running containers.
- **Kubernetes manifest hardening** (kubesec, polaris) — Helm linting in CI doesn't include SAST-style policy checks.
- **Supply-chain provenance** (cosign, SLSA, SBOM) — no code signing, no provenance attestations, no software bill of materials generation.
