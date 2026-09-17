package main

import (
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
