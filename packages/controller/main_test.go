package main

import (
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/client-go/tools/cache"
	"k8s.io/client-go/util/workqueue"
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
	queue := newAgentQueue()
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
	queue := newAgentQueue()
	defer queue.ShutDown()
	for _, name := range []string{"one", "two", "three"} {
		queue.add(true, name)
	}

	queue.AddUrgent("three")

	assert.Equal(t, []string{"three", "one", "two"}, drain(queue))
}

// TEST_SCENARIO: a wake can arrive while the worker is reconciling that same agent for a background reason. The queue holds the agent back until Done, and when it comes back it must come back in the urgent lane, ahead of background work added meanwhile, and be known as urgent so a failure retries there too.
func TestAWakeDuringTheAgentsOwnReconcileStaysUrgent(t *testing.T) {
	queue := newAgentQueue()
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
