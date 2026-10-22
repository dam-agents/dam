package telemetry

import (
	"context"
	"sync"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

// UNIT_BOUNDARY_DESCRIPTION: how much the users' VM pools promise against what the cluster holds, as the leader's last pool pass saw it. Committed is what the runners' limits and claims promise, reserved what the scheduler accounts for in their requests, capacity what the nodes that can run a runner hold. Runners counts the users' runners at each level of their pool, pending the runner pods whose in-place resize the node has deferred or refused, node lost the runner pods sitting on a node the cluster does not report ready, and unavailable the runner Deployments that want a pod and have none available. No series names a user: a runner is per owner, so its owner on a series would be a person.
type VMPool struct {
	Committed   map[string]int64
	Reserved    map[string]int64
	Capacity    map[string]int64
	Runners     map[[2]string]int64
	Pending     map[string]int64
	NodeLost    int64
	Unavailable int64
}

var (
	vmPoolMu   sync.Mutex
	vmPoolLast *VMPool
)

var vmPoolGauges = sync.OnceFunc(func() {
	meter := otel.Meter(ScopeName)
	// UNIT_BOUNDARY_DESCRIPTION: no unit: a resource attribute picks bytes or millicores, and the Prometheus export adds a suffix for a declared unit.
	gauge := func(name, description string) metric.Int64ObservableGauge {
		g, err := meter.Int64ObservableGauge(name, metric.WithDescription(description))
		if err != nil {
			otel.Handle(err)
		}
		return g
	}
	committed := gauge("platform.vm_pool.committed", "What the users' VM pools promise, by resource: memory and storage in bytes, cpu in millicores")
	reserved := gauge("platform.vm_pool.reserved", "What the scheduler accounts for the users' VM runners, by resource")
	capacity := gauge("platform.vm_pool.capacity", "What the nodes that can run a VM runner hold, by resource; storage only where the storage driver publishes its capacity")
	runners := gauge("platform.vm_pool.runners", "Users' VM runners by resource and by the level of their pool: ok, warning (75%) or critical (90%)")
	pending := gauge("platform.vm_runner.resize_pending", "VM runner pods whose in-place resize the node has deferred or found infeasible")
	nodeLost := gauge("platform.vm_runner.node_lost", "VM runner pods on a node the cluster does not report ready; every machine of their owners is down until it returns or is fenced")
	unavailable := gauge("platform.vm_runner.unavailable", "VM runner Deployments that want a pod and have none available; those owners' agents cannot start or reach their machines")
	_, err := meter.RegisterCallback(func(_ context.Context, o metric.Observer) error {
		vmPoolMu.Lock()
		last := vmPoolLast
		vmPoolMu.Unlock()
		if last == nil {
			return nil
		}
		byResource := func(g metric.Int64ObservableGauge, values map[string]int64) {
			for res, v := range values {
				o.ObserveInt64(g, v, metric.WithAttributes(attribute.String("platform.vm_pool.resource", res)))
			}
		}
		byResource(committed, last.Committed)
		byResource(reserved, last.Reserved)
		byResource(capacity, last.Capacity)
		for key, n := range last.Runners {
			o.ObserveInt64(runners, n, metric.WithAttributes(
				attribute.String("platform.vm_pool.resource", key[0]),
				attribute.String("platform.vm_pool.level", key[1])))
		}
		for reason, n := range last.Pending {
			o.ObserveInt64(pending, n, metric.WithAttributes(attribute.String("platform.vm_runner.resize_reason", reason)))
		}
		o.ObserveInt64(nodeLost, last.NodeLost)
		o.ObserveInt64(unavailable, last.Unavailable)
		return nil
	}, committed, reserved, capacity, runners, pending, nodeLost, unavailable)
	if err != nil {
		otel.Handle(err)
	}
})

// UNIT_BOUNDARY_DESCRIPTION: only the leader runs the pool pass, so only the leader ever sets a snapshot and exports these gauges; a replica that never led exports none.
func SetVMPool(p VMPool) {
	vmPoolGauges()
	vmPoolMu.Lock()
	vmPoolLast = &p
	vmPoolMu.Unlock()
}
