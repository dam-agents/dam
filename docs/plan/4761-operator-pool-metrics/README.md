# Operators can't see per-user pool use or cluster overcommit

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/4761 (epic https://github.com/dam-agents/dam/issues/4753)

## Goal

Operators see how full the users' VM pools are, how far the users' pools together promise more than the cluster holds, and which users' pools the cluster cannot fit.
The chart ships alert rules for these.

## Approach

Pages: [observability](../../architecture/observability.md), [vm-memory](../../architecture/vm-memory.md), [vm-runner](../../architecture/vm-runner.md), [persistence](../../architecture/persistence.md).

**No person in a metric.**
The observability page forbids a person-derived value on any platform series, and a runner exists per owner, so no runner series carries its owner.
"Each user" is covered three ways:

- **Per runner, unnamed:** every runner's series already stay apart by scrape target, so a ratio chart shows the distribution and the fullest pool without naming it.
- **Per band, counted:** the controller exports how many runners sit at ok, warning (75%) and critical (90%) for memory and storage, and how many are CPU-throttled.
- **Who:** a Warning Event on each of the owner's vm Agents when their pool goes critical or the node cannot fit it, which `kubectl get events` finds; the runner pod and the Agents already carry the owner label.

**Can't fit is a condition, not readiness.**
An infeasible or deferred in-place resize leaves the pod running at its old request, so the Agent stays Ready.
A separate condition type `RunnerCapacity` (False, reason `Deferred` or `Infeasible`, removed once cleared) sits in the existing conditions list: no CRD schema change.

**Alerts are PrometheusRule.**
The collector gets a second metrics pipeline carrying only `platform_vm_*` series to a `prometheus` exporter, scraped by a ServiceMonitor; both and the PrometheusRule render only when the cluster serves `monitoring.coreos.com/v1` and `monitoring.enabled` is set, which needs `clickstack.enabled`, because the collector lives there.
The exporter port is off-mesh to its scraper, and an Istio `source.namespaces` rule needs a mesh identity, so the collector's AuthorizationPolicy admits that one port with no `from`.

**Thresholds** are the epic's: 75% warning, 90% critical, 20% throttled periods; cluster memory overcommit alerts at committed/capacity > 1.5.
Storage capacity, and its alert, exist only where the runner StorageClass's driver publishes `CSIStorageCapacity`.

## Sub-issues

| #  | Title | Scope | Depends on |
|----|-------|-------|------------|
| 01 | Runner CPU and pressure metrics | Rust: cgroup `cpu.stat`/`cpu.max` reader, working set and pressure gauges | — |
| 02 | Controller pool gauges and the RunnerCapacity condition | Go: committed/reserved/capacity gauges, band counts, resize-pending gauge, condition + Events, RBAC | 01; #4798 and #4797 merged |
| 03 | Prometheus export and alert rules | Helm: exporter pipeline, ServiceMonitor, PrometheusRule, AuthorizationPolicy port, `monitoring` values | 01, 02 |

## Conventions & glossary

- **Pool**: one owner's runner limit (memory, CPU) and claim (storage).
- **Committed**: what the users' pools promise: Σ runner memory limits, Σ runner CPU limits, Σ runner claim requests.
- **Reserved**: what the scheduler accounts: Σ runner pod requests.
- **Capacity**: Σ allocatable of nodes offering the runner's device-plugin resource; storage from `CSIStorageCapacity`.
- The `cpu.stat` reader is shared with #4758 (PR #4806): whichever lands first adds `packages/vm-runner/src/cpu.rs`, the other reuses it.
- Typed comments only (`mise run //:check:comment-types`).

## Whole-feature smoke test

On a local cluster with ClickStack and virtualization on and prometheus-operator CRDs installed: `helm template` shows the ServiceMonitor and PrometheusRule; `curl` the collector's exporter port from the release namespace and see `platform_vm_runner_cpu_*` and `platform_vm_pool_*` series with no owner label; lower one user's pool below use and see `RunnerCapacity` and a Warning Event on their Agents.

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for https://github.com/dam-agents/dam/issues/4761.
