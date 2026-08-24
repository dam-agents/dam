package main

import (
	"testing"

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

func TestEnqueueStoreObjects_EnqueuesEveryAgentOnce(t *testing.T) {
	store := cache.NewStore(cache.MetaNamespaceKeyFunc)
	require.NoError(t, store.Add(agentObj("agent-one", "1")))
	require.NoError(t, store.Add(agentObj("agent-two", "2")))
	queue := workqueue.NewTypedRateLimitingQueue(workqueue.DefaultTypedControllerRateLimiter[string]())
	defer queue.ShutDown()

	n := enqueueStoreObjects(store, queue)

	assert.Equal(t, 2, n)
	assert.Equal(t, 2, queue.Len())
	seen := map[string]bool{}
	for range 2 {
		name, _ := queue.Get()
		seen[name] = true
		queue.Done(name)
	}
	assert.True(t, seen["agent-one"] && seen["agent-two"])
}
