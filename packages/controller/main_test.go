package main

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/tools/cache"
	"k8s.io/client-go/util/workqueue"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/reconciler"
)

func agentObj(name, resourceVersion string) *unstructured.Unstructured {
	u := &unstructured.Unstructured{}
	u.SetName(name)
	u.SetResourceVersion(resourceVersion)
	return u
}

func TestResourceVersionChanged_SameVersionIsUnchanged(t *testing.T) {
	assert.False(t, resourceVersionChanged(agentObj("a", "100"), agentObj("a", "100")))
}

func TestResourceVersionChanged_NewVersionIsChanged(t *testing.T) {
	assert.True(t, resourceVersionChanged(agentObj("a", "100"), agentObj("a", "101")))
}

func TestResourceVersionChanged_NonObjectFailsOpen(t *testing.T) {
	assert.True(t, resourceVersionChanged("not-an-object", agentObj("a", "100")))
	assert.True(t, resourceVersionChanged(agentObj("a", "100"), "not-an-object"))
}

// TEST_SCENARIO: the sweep must still re-check every agent, but not by handing the worker all of them at once — a queue that deep is what an agent someone is waiting for ends up behind. The count in the queue right after the sweep is the whole point: every agent arrives, only not yet.
func TestTheDriftSweepReachesEveryAgentWithoutFloodingTheQueue(t *testing.T) {
	store := cache.NewStore(cache.MetaNamespaceKeyFunc)
	for _, name := range []string{"agent-one", "agent-two", "agent-three", "agent-four"} {
		require.NoError(t, store.Add(agentObj(name, "1")))
	}
	queue := workqueue.NewTypedRateLimitingQueue(workqueue.DefaultTypedControllerRateLimiter[string]())
	defer queue.ShutDown()

	n := spreadStoreObjects(store, queue, 200*time.Millisecond)

	assert.Equal(t, 4, n)
	assert.Equal(t, 1, queue.Len(), "the fleet was handed over at once instead of across the interval")

	seen := map[string]bool{}
	require.Eventually(t, func() bool {
		for queue.Len() > 0 {
			name, _ := queue.Get()
			seen[name] = true
			queue.Done(name)
		}
		return len(seen) == 4
	}, 5*time.Second, 10*time.Millisecond, "an agent was never re-checked at all")
}

func drain(queue agentQueue) []string {
	var order []string
	for queue.Len() > 0 {
		name, _ := queue.Get()
		order = append(order, name)
		queue.Done(name)
	}
	return order
}

// TEST_SCENARIO: after a controller restart the startup list puts every agent in the queue, and a wake used to wait behind all of them — 22 to 41 seconds measured. The woken agent must come out next, and the backlog must still come out whole and in order after it.
func TestAWokenAgentIsReconciledBeforeTheStartupBacklog(t *testing.T) {
	queue := newAgentQueue("agent")
	defer queue.ShutDown()
	var backlog []string
	for i := range 100 {
		name := fmt.Sprintf("idle-%d", i)
		backlog = append(backlog, name)
		queue.add(true, name)
	}

	queue.AddUrgent("woken")

	assert.Equal(t, append([]string{"woken"}, backlog...), drain(queue))
}

// TEST_SCENARIO: the agent a person wakes is often already waiting in the background lane, put there by the startup list. The wake must move it to the front rather than add a second copy, so the queue's dedupe still holds and the agent is reconciled once.
func TestAWakeMovesAnAgentAlreadyInTheBacklogToTheFront(t *testing.T) {
	queue := newAgentQueue("agent")
	defer queue.ShutDown()
	for _, name := range []string{"one", "two", "three"} {
		queue.add(true, name)
	}

	queue.AddUrgent("three")

	assert.Equal(t, []string{"three", "one", "two"}, drain(queue))
}

// TEST_SCENARIO: a wake can arrive while the worker is reconciling that same agent for a background reason. The queue holds the agent back until Done, and when it comes back it must come back in the urgent lane, ahead of background work added meanwhile, and be known as urgent so a failure retries there too.
func TestAWakeDuringTheAgentsOwnReconcileStaysUrgent(t *testing.T) {
	queue := newAgentQueue("agent")
	defer queue.ShutDown()
	queue.add(true, "busy")
	name, _ := queue.Get()
	require.Equal(t, "busy", name)
	assert.False(t, queue.lanes.poppedUrgent())

	queue.AddUrgent("busy")
	queue.add(true, "later")
	queue.Done(name)

	name, _ = queue.Get()
	assert.Equal(t, "busy", name)
	assert.True(t, queue.lanes.poppedUrgent(), "a failure of this reconcile would retry in the background lane")
	queue.Done(name)
	assert.Equal(t, []string{"later"}, drain(queue))
}

// TEST_SCENARIO: every reconcile writes the Agent's status, and that write comes back as an informer update. If the echo counted as urgent, a restart's backlog would put its own echoes ahead of a wake. Only a change to the spec or the annotations — what the api-server writes for a wake or an edit — is urgent.
func TestOnlyASpecOrAnnotationChangeIsUrgent(t *testing.T) {
	before := agentObj("a", "1")
	before.SetGeneration(1)
	before.SetAnnotations(map[string]string{"agent-platform.ai/last-activity": "1"})

	statusOnly := before.DeepCopy()
	statusOnly.SetResourceVersion("2")
	statusOnly.Object["status"] = map[string]any{"phase": "Running"}
	assert.False(t, specOrAnnotationsChanged(before, statusOnly))

	woken := before.DeepCopy()
	woken.SetAnnotations(map[string]string{"agent-platform.ai/last-activity": "2"})
	assert.True(t, specOrAnnotationsChanged(before, woken))

	edited := before.DeepCopy()
	edited.SetGeneration(2)
	assert.True(t, specOrAnnotationsChanged(before, edited))
}

type hungRunnerReconcile struct {
	hungOwner string
	started   chan string
	release   chan struct{}
}

func (h hungRunnerReconcile) Reconcile(_ context.Context, agent *apiv1.Agent) error {
	h.started <- agent.Name
	if reconciler.AgentOwner(agent.Labels) == h.hungOwner {
		<-h.release
	}
	return nil
}

func (hungRunnerReconcile) SetBackoffExceeded(context.Context, string, int, error) {}

func ownedAgents(t *testing.T, owners map[string]string) cache.GenericNamespaceLister {
	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{})
	for name, owner := range owners {
		u := agentObj(name, "1")
		u.SetNamespace("agents")
		u.SetLabels(map[string]string{"agent-platform.ai/owner": owner})
		require.NoError(t, indexer.Add(u))
	}
	return cache.NewGenericLister(indexer, schema.GroupResource{Group: "agent-platform.ai", Resource: "agents"}).ByNamespace("agents")
}

func nextStarted(t *testing.T, started chan string, within time.Duration) string {
	select {
	case name := <-started:
		return name
	case <-time.After(within):
		t.Fatalf("no reconcile started within %s", within)
		return ""
	}
}

// TEST_SCENARIO: a VM runner that hangs but keeps its listener holds its owner's reconcile for the runner client's whole timeout, and the drift sweep brings every agent of that owner back, so the owner is delayed rather than stranded. A wake for another owner on another worker must start at once, not after the hung reconcile ends; a second agent of the hung owner must still wait for the first, because one owner's agents are reconciled one at a time.
func TestAHungRunnerDelaysOnlyItsOwnersWorker(t *testing.T) {
	probe := newShardedAgentQueue(ownedAgents(t, nil))
	other := ""
	for i := 0; other == "" && i < 100; i++ {
		candidate := fmt.Sprintf("other-owner-%d", i)
		lister := ownedAgents(t, map[string]string{"hung": "hung-owner", "woken": candidate})
		q := shardedAgentQueue{shards: probe.shards, agents: lister}
		hung, _ := q.shard("hung")
		woken, _ := q.shard("woken")
		if hung.lanes != woken.lanes {
			other = candidate
		}
	}
	probe.ShutDown()
	require.NotEmpty(t, other, "every owner shares the hung owner's worker")

	agents := ownedAgents(t, map[string]string{"hung": "hung-owner", "hung-sibling": "hung-owner", "woken": other})
	queue := newShardedAgentQueue(agents)
	r := hungRunnerReconcile{hungOwner: "hung-owner", started: make(chan string, 3), release: make(chan struct{})}
	release := sync.OnceFunc(func() { close(r.release) })
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		queue.run(ctx, r, agents)
		close(done)
	}()
	t.Cleanup(func() {
		release()
		cancel()
		queue.ShutDown()
		<-done
	})

	queue.AddUrgent("hung")
	require.Equal(t, "hung", nextStarted(t, r.started, time.Second))
	queue.AddUrgent("hung-sibling")
	queue.AddUrgent("woken")

	assert.Equal(t, "woken", nextStarted(t, r.started, time.Second), "a wake for another owner waited behind the hung runner")
	select {
	case name := <-r.started:
		t.Fatalf("%s was reconciled while its owner's other reconcile was still running", name)
	case <-time.After(100 * time.Millisecond):
	}

	release()
	assert.Equal(t, "hung-sibling", nextStarted(t, r.started, time.Second))
}

// TEST_SCENARIO: a name the agent cache does not hold has no owner to pick a worker by. It must be dropped, not sent to some worker, because the same agent sent to two workers would be reconciled twice at once.
func TestANameTheCacheDoesNotHoldIsDropped(t *testing.T) {
	queue := newShardedAgentQueue(ownedAgents(t, map[string]string{"known": "someone"}))
	defer queue.ShutDown()

	queue.AddUrgent("unknown")
	queue.add(true, "unknown")
	queue.Add("known")

	total := 0
	for _, s := range queue.shards {
		total += s.Len()
	}
	assert.Equal(t, 1, total)
}
