# qi-profile-dam

The DAM profile for the [quality-inspector](https://github.com/dam-agents/quality-inspector) agent — black-box QA that tests DAM through its UI, built by built, without reading this repository.
It is data only: the inspector's `helm-k3s` engine runs the published chart in a nested k3s cluster inside the inspector's VM from `profile.json` → `engine_config`.
Contract: quality-inspector `docs/profile-contract.md`; engine configuration: `engines/helm-k3s/README.md` there.

- `profile.json` — the chart, its channels (`main` = `0.0.0-main.<n>`, `release` = `X.Y.Z`), the prerequisites (cert-manager, Gateway API CRDs, Istio CRDs without the mesh dataplane), the Helm values for a single-user QA install with a generated test owner, egress, requirements, config keys.
- Two install choices keep the nested product inside the inspector's egress, which is deny-by-default on GitHub: `harnessTools.hostPath: ""` leaves out the harness tools installer (its mise backends download from GitHub hosts), and the images the chart takes from `mirror.gcr.io` are in `egress`.
- `no-mesh-marker.yaml` — the `kube-system/platform-local-no-mesh` ConfigMap that lets the chart take `istio.enforce=false`.
  The inspector's VM kernel cannot run the Istio ambient dataplane, so the nested install runs without it; applied as a `file` prerequisite (quality-inspector 2.21.0 or later).
- `SKILL.md` — DAM from a tester's point of view: vocabulary, and what the nested install cannot do.
  User-facing only — never implementation detail.

**Keep it in step with the chart.**
A change that alters what a fresh install needs — a new prerequisite, a renamed value the QA install sets (`keycloak.testUser`, `terms`, `ingress.catchAllAppHost`) — updates `profile.json` in the same PR.

## Delivery

The inspector's operator adds this repository as a skill source with path `qa` and assigns `qi-profile-dam`; the platform fetches only this directory, and the inspector's egress allows only `GET /repos/dam-agents/dam/contents/qa/*` and `GET /repos/dam-agents/dam/contents/qa?*`.
Keep `qa/` free of symlinks: the Contents API answers a symlink to a file with that file's content.

## Config (`work/CONFIG.md` of the inspector)

| Key                                                                                                            | Default                                    | Purpose                                    |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------ |
| `profile.chart_ref`                                                                                            | `oci://quay.io/dam-agents/charts/platform` | chart the builds come from                 |
| `profile.mock_image`                                                                                           | empty (asked)                              | mock harness image so nested agents answer |
| `profile.istio_version`, `profile.cert_manager_version`, `profile.gateway_api_version`, `profile.helm_version` | see `profile.json`                         | nested prerequisites                       |
