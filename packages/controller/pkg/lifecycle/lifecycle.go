// Package lifecycle centralizes "make an agent pod reachable" as a single
// primitive, EnsureReady. Every caller that sends work to a pod (scheduler,
// ACP relay, channel adapters) routes through it instead of composing
// wake+wait ad hoc at each site.
//
// The architectural lever is a source-of-truth shift: observed pod Ready is
// the authoritative answer to "can I call this pod?" — not desiredState.
// desiredState remains user intent and continues to drive the reconciler.
//
// See docs/adrs/032-pod-reachability-primitive.md.
package lifecycle

import (
	"context"
	"fmt"
	"time"

	"golang.org/x/sync/singleflight"
	"k8s.io/client-go/kubernetes"
)

// Timeouts and poll cadence. NOTE: mirrored in
// packages/api-server/src/modules/agents/infrastructure/poll-until-ready.ts (TS).
// Keep behaviour, constants, and the shape of the loop in sync across both.
const (
	wakePollInitial = 500 * time.Millisecond
	wakePollMax     = 5 * time.Second
	wakeTimeout     = 2 * time.Minute
)

// Lifecycle carries the K8s client and per-instance single-flight group used
// by EnsureReady. One instance per process is expected.
type Lifecycle struct {
	client    kubernetes.Interface
	namespace string
	sf        singleflight.Group

	// Test seams: overridable by tests; nil in production (defaults apply).
	pollInitial time.Duration
	pollMax     time.Duration
	pollTimeout time.Duration
}

// New constructs a Lifecycle bound to a namespace.
func New(client kubernetes.Interface, namespace string) *Lifecycle {
	return &Lifecycle{
		client:      client,
		namespace:   namespace,
		pollInitial: wakePollInitial,
		pollMax:     wakePollMax,
		pollTimeout: wakeTimeout,
	}
}

// EnsureReady blocks until the instance's pod is Ready, waking it from
// hibernation if needed. Idempotent; single-flight per instance name; bumps
// agent-platform.ai/last-activity on every successful completion so any caller
// implicitly keeps the pod warm.
//
// Behaviour: if the pod is already Ready, this is one getPod + one
// annotation patch. Otherwise, wakeIfHibernated is called (a no-op if
// desiredState is already "running") and pod Ready is polled up to
// wakeTimeout. NotFound during polling counts as "not yet" — the reconciler
// may be mid-scale-up.
func (l *Lifecycle) EnsureReady(ctx context.Context, instanceName string) error {
	_, err, _ := l.sf.Do(instanceName, func() (any, error) {
		return nil, l.ensureReady(ctx, instanceName)
	})
	return err
}

func (l *Lifecycle) ensureReady(ctx context.Context, instanceName string) error {
	podName := instanceName + "-0"
	if ready, err := podIsReady(ctx, l.client, l.namespace, podName); err == nil && ready {
		return l.bumpLastActivity(ctx, instanceName)
	}

	if err := l.wakeIfHibernated(ctx, instanceName); err != nil {
		return fmt.Errorf("wake %s: %w", instanceName, err)
	}

	if !l.waitForPodReady(ctx, podName) {
		return fmt.Errorf("instance %s did not become ready within %s", instanceName, l.pollTimeout)
	}
	return l.bumpLastActivity(ctx, instanceName)
}
