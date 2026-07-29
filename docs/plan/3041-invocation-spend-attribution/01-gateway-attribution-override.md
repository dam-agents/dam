# 01 — Gateway attribution override + invocation id stamp

**Part of:** Invocation spend attribution — see [README](./README.md)

## Context

The trusted attribution attribute is stamped by the agent's paired gateway: the Envoy
collector chain overwrites `x-platform-agent-id` with the gateway's own instance id, and
the collector promotes it to `platform.agent.id`. This slice makes that stamp overridable
per agent via a new Agent CR spec field, and adds the second trusted header,
`x-platform-invocation-id`, so child rows stay distinguishable after their attribution is
merged. Pure platform plumbing — nothing sets the field yet (02 does).

## Implementation plan

1. **CRD field.** In `packages/controller/api/v1/agent_types.go`, add to `AgentSpec`:
   `TelemetryAttributionID string` with json tag `telemetryAttributionId,omitempty`.
   Doc comment: the agent id stamped as the trusted telemetry attribution
   (`x-platform-agent-id`) instead of this agent's own id; set by the api-server for
   Invocation targets to their root Driver; when set, the gateway also stamps
   `x-platform-invocation-id` with this agent's own id. Never user-settable.
2. **Codegen.** Bump the constant in `packages/controller/api/v1/schema_generation.go`
   (the CRD schema-generation gate, see `packages/controller/tasks.toml:129`). Run
   `mise run api-server-api:gen:crd-types` (depends on `controller:generate`); commit the
   regenerated CRD YAML under `deploy/helm/platform/crds/` and
   `packages/api-server-api/src/crd-types.gen.ts`.
3. **Thread the field to the bootstrap renderer.** It does not reach it today:
   - `packages/controller/pkg/reconciler/agent_reconciler.go:106` — read
     `agentSpec.TelemetryAttributionID`, pass into `BuildEnvoyBootstrapConfigMap`.
   - `packages/controller/pkg/reconciler/envoy.go:682` — extend the signature.
   - `packages/controller/pkg/reconciler/envoy_bootstrap.go:78` (`renderEnvoyBootstrap`)
     — new `bootstrapParams` fields (around `:38-61`), e.g. `AttributionID` (defaulted to
     `instanceID` when the override is empty) alongside the existing `InstanceID`.
   - The fork call site (`packages/controller/pkg/reconciler/fork.go:117`) passes no
     override — forks keep stamping their own id. Do not touch fork behavior.
4. **Collector chain stamping.** In `buildCollectorChain`
   (`packages/controller/pkg/reconciler/envoy_bootstrap.go:478`):
   - Stamp `x-platform-agent-id` with the attribution id (override when set, own id
     otherwise) — keep `OVERWRITE_IF_EXISTS_OR_ADD`.
   - When the override is set, also stamp `x-platform-invocation-id: <own instance id>`
     with `OVERWRITE_IF_EXISTS_OR_ADD`.
   - **Always** add `request_headers_to_remove: ["x-platform-invocation-id"]` on the
     route when the override is *not* set — an agent must not be able to smuggle a forged
     invocation id past the gateway (the agent-id header is safe because it is always
     overwritten; the invocation-id header is only sometimes added).
5. **Collector promotion.** In
   `deploy/helm/platform/templates/clickstack/collector.yaml`, extend the
   `resource/agent-identity` processor with the same delete-then-upsert pair for
   `platform.invocation.id` from `metadata.x-platform-invocation-id`, and add the header
   to the receiver comment. A missing header leaves the attribute absent (upsert from a
   missing context key is a no-op), which is exactly the non-target case.
6. **Fix the now-false doc contracts.** `envoy_bootstrap.go:63-77` and
   `packages/controller/pkg/config/config.go:142` both assert the telemetry header
   carries the gateway's own instance id — rewrite them to describe the override.
7. **Keep the suite green.** `packages/controller/pkg/reconciler/envoy_test.go` asserts
   the stamped header (`:442`, `:487`, fork split at `:494`); extend the existing
   assertions to cover the override case (this is behavior the suite already pins — not
   new-test authoring).

## Acceptance criteria

- [ ] `AgentSpec` carries `telemetryAttributionId`; CRD YAML and `crd-types.gen.ts` are
      regenerated and committed together (`mise run api-server-api:check:gen` passes).
- [ ] With the field unset, the rendered bootstrap is byte-identical in intent to today:
      own id stamped, and `x-platform-invocation-id` stripped from agent requests.
- [ ] With the field set, the collector chain stamps `x-platform-agent-id: <override>`
      and `x-platform-invocation-id: <own id>`, both OVERWRITE.
- [ ] Fork bootstrap rendering is unchanged.
- [ ] `collector.yaml` sanitizes and promotes `platform.invocation.id` with the same
      delete-then-upsert pattern as `platform.agent.id`.
- [ ] The doc comments in `envoy_bootstrap.go` and `config.go` no longer claim the header
      always carries the gateway's own id.

## Smoke test

```
mise run controller:check
mise run api-server-api:check:gen
```

(Heads-up: `controller:check:staticcheck` may fail locally on a go1.26-vs-1.25 toolchain
mismatch — environmental, ignore if the failure is the toolchain complaint.)

Then print a short manual guide: render the chart (`mise run` helm template task or
`cluster-ops`) and eyeball the collector config for the new processor entries.
