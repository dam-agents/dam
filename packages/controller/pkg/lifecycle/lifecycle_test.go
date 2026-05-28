package lifecycle

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
)

const ns = "test-agents"

// agentCM builds a merged Agent ConfigMap (ADR-046). Lifecycle tests need
// the bare minimum that ParseAgentSpec accepts plus the runtime fields the
// wake path mutates.
func agentCM(name, desiredState string) *corev1.ConfigMap {
	return &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name: name, Namespace: ns,
			Labels: map[string]string{"agent-platform.ai/type": "agent"},
		},
		Data: map[string]string{
			"spec.yaml": "version: agent-platform.ai/v1\nimage: foo\ndesiredState: " + desiredState + "\n",
		},
	}
}

func readyPod(instanceName string) *corev1.Pod {
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: instanceName + "-0", Namespace: ns},
		Status: corev1.PodStatus{
			Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionTrue}},
		},
	}
}

func notReadyPod(instanceName string) *corev1.Pod {
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: instanceName + "-0", Namespace: ns},
		Status: corev1.PodStatus{
			Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionFalse}},
		},
	}
}

// shortPoll turns the 2-minute production deadline into something test-scale.
func shortPoll(l *Lifecycle) *Lifecycle {
	l.pollInitial = 1 * time.Millisecond
	l.pollMax = 5 * time.Millisecond
	l.pollTimeout = 200 * time.Millisecond
	return l
}

func TestEnsureReady_PodAlreadyReady(t *testing.T) {
	client := fake.NewSimpleClientset(agentCM("my-instance", "running"), readyPod("my-instance"))
	var updates int32
	client.PrependReactor("update", "configmaps", func(k8stesting.Action) (bool, runtime.Object, error) {
		atomic.AddInt32(&updates, 1)
		return false, nil, nil
	})
	l := shortPoll(New(client, ns))

	require.NoError(t, l.EnsureReady(context.Background(), "my-instance"))

	updated, _ := client.CoreV1().ConfigMaps(ns).Get(context.Background(), "my-instance", metav1.GetOptions{})
	assert.Contains(t, updated.Annotations, lastActivityAnnotation, "last-activity must be bumped even on hot path")
	// The only CM update we expect is the bumpLastActivity call.
	assert.Equal(t, int32(1), atomic.LoadInt32(&updates), "hot path must not rewrite spec.yaml")
}

func TestEnsureReady_Hibernated_WakesAndWaits(t *testing.T) {
	client := fake.NewSimpleClientset(agentCM("my-instance", "hibernated"))
	l := shortPoll(New(client, ns))
	// Simulate reconciler creating the pod a bit after wake.
	go func() {
		time.Sleep(30 * time.Millisecond)
		_, _ = client.CoreV1().Pods(ns).Create(context.Background(), readyPod("my-instance"), metav1.CreateOptions{})
	}()

	require.NoError(t, l.EnsureReady(context.Background(), "my-instance"))

	updated, _ := client.CoreV1().ConfigMaps(ns).Get(context.Background(), "my-instance", metav1.GetOptions{})
	assert.Contains(t, updated.Data["spec.yaml"], "desiredState: running")
	assert.Contains(t, updated.Annotations, lastActivityAnnotation)
}

func TestEnsureReady_PodAbsent_ThenAppearsReady(t *testing.T) {
	// desiredState=running but pod hasn't been created yet — the race this
	// whole primitive exists to handle.
	client := fake.NewSimpleClientset(agentCM("my-instance", "running"))
	l := shortPoll(New(client, ns))
	go func() {
		time.Sleep(20 * time.Millisecond)
		_, _ = client.CoreV1().Pods(ns).Create(context.Background(), readyPod("my-instance"), metav1.CreateOptions{})
	}()

	require.NoError(t, l.EnsureReady(context.Background(), "my-instance"))
}

func TestEnsureReady_TimeoutWhenPodNeverReady(t *testing.T) {
	client := fake.NewSimpleClientset(agentCM("my-instance", "running"), notReadyPod("my-instance"))
	l := shortPoll(New(client, ns))

	err := l.EnsureReady(context.Background(), "my-instance")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "did not become ready")
}

func TestEnsureReady_Concurrent_SingleFlight(t *testing.T) {
	client := fake.NewSimpleClientset(agentCM("my-instance", "hibernated"))
	var cmUpdates int32
	client.PrependReactor("update", "configmaps", func(k8stesting.Action) (bool, runtime.Object, error) {
		atomic.AddInt32(&cmUpdates, 1)
		return false, nil, nil
	})
	l := shortPoll(New(client, ns))
	// Pod becomes Ready shortly after the first caller starts work.
	go func() {
		time.Sleep(15 * time.Millisecond)
		_, _ = client.CoreV1().Pods(ns).Create(context.Background(), readyPod("my-instance"), metav1.CreateOptions{})
	}()

	var wg sync.WaitGroup
	errs := make([]error, 5)
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			errs[i] = l.EnsureReady(context.Background(), "my-instance")
		}(i)
	}
	wg.Wait()

	for _, err := range errs {
		assert.NoError(t, err)
	}
	// One wake write + one bump = 2 CM updates max. Without single-flight this
	// would be ~10 (wake + bump per caller, plus retries).
	assert.LessOrEqual(t, atomic.LoadInt32(&cmUpdates), int32(2),
		"single-flight must collapse concurrent callers to one wake + one bump")
}

func TestEnsureReady_ConcurrentDifferentInstances_NoCrossBlock(t *testing.T) {
	client := fake.NewSimpleClientset(
		agentCM("a", "hibernated"),
		agentCM("b", "hibernated"),
		readyPod("a"),
		readyPod("b"),
	)
	l := shortPoll(New(client, ns))

	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); assert.NoError(t, l.EnsureReady(context.Background(), "a")) }()
	go func() { defer wg.Done(); assert.NoError(t, l.EnsureReady(context.Background(), "b")) }()
	wg.Wait()
}

// --- pollUntilReady ---

func TestPollUntilReady_ReadyImmediately(t *testing.T) {
	called := 0
	ok := pollUntilReady(context.Background(), func(context.Context) bool {
		called++
		return true
	}, 10*time.Millisecond, 100*time.Millisecond, time.Second)
	assert.True(t, ok)
	assert.Equal(t, 1, called)
}

func TestPollUntilReady_EventuallyReady(t *testing.T) {
	called := 0
	ok := pollUntilReady(context.Background(), func(context.Context) bool {
		called++
		return called >= 3
	}, 10*time.Millisecond, 100*time.Millisecond, time.Second)
	assert.True(t, ok)
	assert.Equal(t, 3, called)
}

func TestPollUntilReady_Timeout(t *testing.T) {
	called := 0
	start := time.Now()
	ok := pollUntilReady(context.Background(), func(context.Context) bool {
		called++
		return false
	}, 10*time.Millisecond, 30*time.Millisecond, 100*time.Millisecond)
	elapsed := time.Since(start)
	assert.False(t, ok)
	assert.GreaterOrEqual(t, called, 2)
	assert.GreaterOrEqual(t, elapsed, 100*time.Millisecond)
	assert.Less(t, elapsed, 500*time.Millisecond)
}

func TestPollUntilReady_ContextCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	go func() { time.Sleep(20 * time.Millisecond); cancel() }()
	start := time.Now()
	ok := pollUntilReady(ctx, func(context.Context) bool { return false },
		100*time.Millisecond, time.Second, 10*time.Second)
	elapsed := time.Since(start)
	assert.False(t, ok)
	assert.Less(t, elapsed, 500*time.Millisecond)
}

// --- wakeIfHibernated ---

func TestWakeIfHibernated_WakesInstance(t *testing.T) {
	client := fake.NewSimpleClientset(agentCM("my-instance", "hibernated"))
	l := New(client, ns)
	require.NoError(t, l.wakeIfHibernated(context.Background(), "my-instance"))

	updated, _ := client.CoreV1().ConfigMaps(ns).Get(context.Background(), "my-instance", metav1.GetOptions{})
	assert.Contains(t, updated.Data["spec.yaml"], "desiredState: running")
	assert.Contains(t, updated.Annotations, lastActivityAnnotation)
}

func TestWakeIfHibernated_NoopWhenRunning(t *testing.T) {
	client := fake.NewSimpleClientset(agentCM("my-instance", "running"))
	l := New(client, ns)
	require.NoError(t, l.wakeIfHibernated(context.Background(), "my-instance"))

	updated, _ := client.CoreV1().ConfigMaps(ns).Get(context.Background(), "my-instance", metav1.GetOptions{})
	// Spec unchanged, no last-activity bump from wake path (bump happens in
	// EnsureReady, not wakeIfHibernated when state is already running).
	assert.NotContains(t, updated.Annotations, lastActivityAnnotation)
}

// --- waitForPodReady ---

func TestWaitForPodReady_PodReady(t *testing.T) {
	client := fake.NewSimpleClientset(readyPod("my-instance"))
	l := shortPoll(New(client, ns))
	assert.True(t, l.waitForPodReady(context.Background(), "my-instance-0"))
}

func TestWaitForPodReady_PodNotFound_Timeout(t *testing.T) {
	client := fake.NewSimpleClientset()
	l := shortPoll(New(client, ns))
	assert.False(t, l.waitForPodReady(context.Background(), "missing-0"))
}
