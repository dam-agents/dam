# qi-profile-dam

The DAM profile for the [quality-inspector](https://github.com/dam-agents/quality-inspector) agent — black-box QA that tests DAM through its UI, built by built, without reading this repository.
It is data only: the inspector's `helm-k3s` engine runs the published chart in a nested k3s cluster inside the inspector's VM from `profile.json` → `engine_config`.
Contract: quality-inspector `docs/profile-contract.md`; engine configuration: `engines/helm-k3s/README.md` there.

- `profile.json` — the chart, its channels (`main` = `0.0.0-main.<n>`, `release` = `X.Y.Z`), the prerequisites (cert-manager, Gateway API CRDs, Istio CRDs without the mesh dataplane), the Helm values for a QA install with four generated test accounts (owner, member, inspector, outsider — `keycloak.testUser` and `keycloak.extraTestUsers`), egress, the injection canary's object (one Mock agent, its text in the name), requirements, config keys.
- The **Mock** harness template (`mock_image`) is on by default: the scripted e2e mock agent, pinned to the source sha it was built from (`quay.io/dam-agents/mock` has no release tags).
  It carries the agent runtime of that sha, so bump it when a chart change needs a newer runtime: `mise run image:resolve -- source-sha mock` on main gives the tag.
- The images the chart takes from `mirror.gcr.io` are in `egress`, so the nested product stays inside the inspector's egress, which is deny-by-default on GitHub.
- The cert-manager and Gateway API manifests are `github.com` release files the inspector's kit opens (quality-inspector 3.1.0 or later); the `trusted` preset allows the hosts GitHub redirects them to, so `egress` names neither.
- `no-mesh-marker.yaml` — the `kube-system/platform-local-no-mesh` ConfigMap that lets the chart take `istio.enforce=false`.
  The inspector's VM kernel cannot run the Istio ambient dataplane, so the nested install runs without it; applied as a `file` prerequisite (quality-inspector 2.21.0 or later).
- `SKILL.md` — DAM from a tester's point of view: vocabulary, the test accounts and what each may do, and what the nested install cannot do.
  User-facing only — never implementation detail.

**Keep it in step with the chart.**
A change that alters what a fresh install needs — a new prerequisite, a renamed value the QA install sets (`keycloak.testUser`, `keycloak.extraTestUsers`, `terms`, `ingress.catchAllAppHost`) — updates `profile.json` in the same PR.

## Delivery

The inspector's operator adds this repository as a skill source with path `.quality-inspector` and assigns `qi-profile-dam`; the platform fetches only this directory.
The inspector's kit (quality-inspector 3.0.0 or later) opens `GET /repos/*/*/contents/.quality-inspector/*` and `GET /repos/*/*/contents/.quality-inspector?*` for every repository and nothing else of it, so this directory needs no egress rule of its own.
Keep `.quality-inspector/` free of symlinks and submodules: the Contents API answers a symlink to a file with that file's content, and the inspector's gate fails on one.

## Config (`work/CONFIG.md` of the inspector)

| Key                                                                                                            | Default                                    | Purpose                                    |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------ |
| `profile.chart_ref`                                                                                            | `oci://quay.io/dam-agents/charts/platform` | chart the builds come from                 |
| `profile.mock_image`                                                                                           | `quay.io/dam-agents/mock:<sha>`            | mock harness image so nested agents answer |
| `profile.istio_version`, `profile.cert_manager_version`, `profile.gateway_api_version`, `profile.helm_version` | see `profile.json`                         | nested prerequisites                       |
