# 03 — Prometheus export and alert rules

**Depends on:** 01-runner-cpu-pressure-metrics, 02-controller-pool-gauges
**Part of:** operator pool metrics — see [README](./README.md)

## Context

The platform's metrics land in ClickHouse only, and no alert ships with the chart.

## Implementation plan

1. `helm/templates/clickstack/collector.yaml`: a second metrics pipeline from the same receivers through a filter keeping `platform_vm_*` and `platform.vm_*` series to a `prometheus` exporter on port 9464; add the Service port.
2. New `helm/templates/monitoring/servicemonitor.yaml` and `prometheusrule.yaml`, rendered only with `monitoring.enabled` and `.Capabilities.APIVersions.Has "monitoring.coreos.com/v1"`.
3. `helm/templates/clickstack/authorizationpolicy.yaml`: a rule admitting port 9464 with no `from`, since the scraper has no mesh identity.
4. `helm/values.yaml` `monitoring:` enabled, `labels` for the rule selector, thresholds (warning 0.75, critical 0.9, throttled 0.2, overcommit 1.5); a validator that `monitoring.enabled` needs `clickstack.enabled`.
5. Rules: pool memory and storage at warning and critical per runner, CPU throttled ≥ 20% for 15 m, resize infeasible > 0, resize deferred for 15 m, cluster memory committed/capacity > 1.5, reserved/capacity > 0.9, admission refusals rising for 15 m, memory pressure; storage overcommit only when capacity is exported.
   Each description names the `kubectl get events` query that finds the owner.
6. `docs/architecture/observability.md`: an Alerts section.

## Acceptance criteria

- [ ] `helm template` with monitoring on and the API version present renders the ServiceMonitor and PrometheusRule; without it nothing renders and nothing fails.
- [ ] No exported series carries a pod label.

## Smoke test

`mise run //helm:check`, `mise run //docs:check`; on a local cluster with ClickStack and virtualization on, `curl` the collector's port 9464 from the release namespace.
