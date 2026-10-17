# 01 — Per-owner Envoy configuration render

**Part of:** gateway per owner — see [README](./README.md)

## Context

Today `renderEnvoyBootstrap` renders one static bootstrap per agent: an outer listener `agent_egress` on the proxy port, an internal listener `tls_inspect_internal` and every cluster.
The owner gateway needs the same chains for several agents in one Envoy, loaded from files Envoy watches so a change to one agent drains only that agent's listener.
This slice is a pure render with no cluster objects: a function from the owner's agents to a static bootstrap plus an LDS file and a CDS file.

## Implementation plan

1. In `packages/controller/pkg/reconciler/envoy_bootstrap.go`, split `buildEnvoyBootstrap` into the parts shared by the pod (node, internal-listener extension, stats sink, the shared clusters `harness_passthrough`, `objectstore_passthrough`, `dynamic_forward_proxy_*`, `otel_collector`, `otel_export`) and the parts of one agent (outer listener, internal listener, `ext_authz_cluster`, upstream clusters).
   Keep `renderEnvoyBootstrap` for container Agents unchanged in output: `envoy_test.go` and `machine_egress_test.go` must pass untouched.
2. Add a per-agent render that suffixes every per-agent resource name with the agent name: listener `agent_egress_<agent>` on the agent's proxy port, internal listener `tls_inspect_<agent>`, `ext_authz_<agent>`, `upstream_<chain>_<agent>`, and the internal cluster that reaches `tls_inspect_<agent>`.
   Every chain keeps its `stat_prefix` but gains the agent so stats stay attributable.
3. Harness guard: in the per-agent outer route config, replace the CONNECT route to `harness_passthrough` with one to a per-agent internal listener that runs an HTTP connection manager whose only route admits path prefix `/api/agents/<agent>/` (with WebSocket upgrades) to the harness cluster and answers 403 otherwise; keep the plain-HTTP harness route under the same prefix match.
   The harness listener is plain HTTP today (`API_SERVER_URL` is `http://…`), so the guard sees the path.
4. Health path: the per-agent `envoy.filters.http.health_check` stays, and a direct-response route on `/__platform_healthz` returns the agent's listener revision (a hash of that agent's rendered resources) so 05 can tell a stale listener from a current one.
5. Add `renderOwnerGateway(owner, agents []ownerGatewayAgent, cfg) (bootstrap, lds, cds string, error)`; `bootstrap` has `dynamic_resources` with `lds_config` and `cds_config` as `path_config_source` and `watched_directory` on the ConfigMap mount.
6. Pin the template rev constant (`envoyBootstrapTemplateRev`) for the owner render separately.
7. Record in a comment of the owner render the measured size per chain and the 1 MiB ConfigMap ceiling (README, numbers), with the upgrade path: an xDS server in the controller.

## Acceptance criteria

- [ ] Rendering two agents yields listener names, cluster names and stat prefixes that never collide, checked by a unit test that unmarshals the LDS and CDS and compares names (exception to the no-new-tests rule: a collision is a fatal Envoy config with no manual path to find it).
- [ ] Container `renderEnvoyBootstrap` output is byte-identical to before (existing tests pass unchanged).
- [ ] `envoy --mode validate` accepts a rendered owner bootstrap with its LDS and CDS for 0, 1 and 5 agents (run through mise: `mise x -- docker run … envoy --mode validate`, or the image the chart pins).
- [ ] The largest owner on dev (from real Secret metadata, read without data) renders under 512 KiB; record the number in the PR (README Q1).

## Smoke test

`mise run //packages/controller:test`, then validate one rendered owner config with the pinned Envoy image in `--mode validate`.
