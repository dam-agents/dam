# Security gaps

Last verified: 2026-10-19

Known gaps tracked as future work:

- **Runtime container scanning** (Falco, kube-bench) — we rely on image scans pre-deploy; nothing watches running containers.
- **Kubernetes manifest hardening** (kubesec, polaris) — Helm linting in CI doesn't include SAST-style policy checks.
- **Supply-chain provenance** (cosign, SLSA, SBOM) — no code signing, no provenance attestations, no software bill of materials generation.
- **Node image cache is readable by every runner of the install on the node** — a runner mounts the whole cache directory read-only, so a runner and any guest that escapes into it read every tree another owner fetched, private images included ([vm-image-cache](../architecture/vm-image-cache.md)).
  Nothing restricts sharing a tree fetched with one owner's credentials across owners; the per-machine check gates only what the service resolves and fetches.
  The socket is not what does the reading: it checks no peer credentials, which bounds what a caller may make the service do — resolve, fetch, hold — not what it may read, since no ask is needed to read the mount.
