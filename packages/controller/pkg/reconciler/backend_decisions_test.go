package reconciler

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	k8stesting "k8s.io/client-go/testing"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
)

// TEST_OVERVIEW: The reconciler above the Agent store. The custom resources and
// TEST_OVERVIEW: the rows are one seam, and these specs hold the behavior that must not depend
// TEST_OVERVIEW: on which side of it is in use: no decision while the store cannot answer, no
// TEST_OVERVIEW: hibernation before the stop, the pool never guessed from an unread budget, a
// TEST_OVERVIEW: reclaim stamped at the version it read, no spec write once the rows own the
// TEST_OVERVIEW: definition, and an anchor that owns the children and outlives every cleanup
// TEST_OVERVIEW: that failed.
type recordingBackend struct {
	AgentBackend
	mu        sync.Mutex
	status    map[string]apiv1.AgentStatus
	writes    int
	patches   []map[string]*string
	reclaims  []string
	healthy   error
	writable  bool
	budget    *unstructured.Unstructured
	budgetErr error
	gone      bool
}

func newRecordingBackend(inner AgentBackend) *recordingBackend {
	return &recordingBackend{AgentBackend: inner, status: map[string]apiv1.AgentStatus{}}
}

func (b *recordingBackend) Healthy() error { return b.healthy }

func (b *recordingBackend) SpecWritable() bool { return b.writable }

func (b *recordingBackend) Get(ctx context.Context, name string) (*unstructured.Unstructured, error) {
	if b.gone {
		return nil, apierrors.NewNotFound(AgentsGVR.GroupResource(), name)
	}
	return b.AgentBackend.Get(ctx, name)
}

func (b *recordingBackend) UpdateStatus(_ context.Context, name string, mutate func(*apiv1.AgentStatus)) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.writes++
	current := b.status[name]
	mutate(&current)
	b.status[name] = current
	return nil
}

func (b *recordingBackend) PatchAgent(_ context.Context, _ string, ann map[string]*string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.patches = append(b.patches, ann)
	return nil
}

func (b *recordingBackend) StampReclaim(_ context.Context, _, _, revision string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.reclaims = append(b.reclaims, revision)
	return nil
}

func (b *recordingBackend) GetBudget(_ context.Context, owner string) (*unstructured.Unstructured, error) {
	if b.budgetErr != nil {
		return nil, b.budgetErr
	}
	if b.budget == nil {
		return nil, apierrors.NewNotFound(UserBudgetsGVR.GroupResource(), "budget-"+owner)
	}
	return b.budget, nil
}

func (b *recordingBackend) written(name string) apiv1.AgentStatus {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.status[name]
}

func (b *recordingBackend) writeCount() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.writes
}

func timeAgo(d time.Duration) string {
	return time.Now().UTC().Add(-d).Format(time.RFC3339Nano)
}

func conditionReason(t *testing.T, status apiv1.AgentStatus, condType string) string {
	t.Helper()
	for _, condition := range status.Conditions {
		if condition.Type == condType {
			return condition.Reason
		}
	}
	return ""
}

func budgetWithMemory(memory string) *unstructured.Unstructured {
	return &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": apiv1.GroupVersion.String(),
		"kind":       "UserBudget",
		"metadata":   map[string]any{"name": "budget-owner-1", "namespace": "test-agents"},
		"spec":       map[string]any{"memory": memory},
	}}
}

// TEST_SCENARIO: Hibernation is published only once the machine is stopped. A
// TEST_SCENARIO: runner that refused the stop, and one still stopping its guest, must not read
// TEST_SCENARIO: as hibernated: the api-server trusts a health answer on a wake from that
// TEST_SCENARIO: state.
func TestHibernationOnlyAfterTheStop(t *testing.T) {
	for _, tc := range []struct {
		name       string
		haltErr    error
		wantErr    bool
		hibernated bool
	}{
		{"the stop was refused", errors.New("runner unreachable"), true, false},
		{"the machine is still stopping", errMachineStopping, false, false},
		{"the machine stopped", nil, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r, _ := setupReconciler(t, agentCR())
			backend := newRecordingBackend(crAgentBackend{dynamic: r.dynamic, namespace: r.config.Namespace})
			halt := func(context.Context, string, string) error { return tc.haltErr }
			_, err := hibernateAgentPair(context.Background(), r.client, backend, halt, "owner-1", r.config.Namespace, "my-agent")
			if tc.wantErr {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
			status := backend.written("my-agent")
			got := conditionReason(t, status, apiv1.ConditionReady)
			if (got == apiv1.ReasonHibernated) != tc.hibernated {
				t.Fatalf("Ready reason = %q, hibernated = %v", got, tc.hibernated)
			}
		})
	}
}

// TEST_SCENARIO: A store that cannot answer lately is no basis for a sweep. The
// TEST_SCENARIO: idle checker must leave every machine alone, and the same sweep with a
// TEST_SCENARIO: healthy store must still hibernate, so the gate is what changed.
func TestIdleSweepWaitsForAHealthyStore(t *testing.T) {
	idle := agentCR()
	idle.Annotations = map[string]string{annLastActivity: timeAgo(2 * time.Hour)}
	r, client := setupReconciler(t, idle)
	checker := NewIdleChecker(client, r.dynamic, r.config)
	checker.busyProbe = func(context.Context, string) bool { return false }
	backend := newRecordingBackend(crAgentBackend{dynamic: r.dynamic, namespace: r.config.Namespace})
	checker.WithAgentBackend(backend)

	backend.healthy = errors.New("the feed is down")
	checker.check(context.Background())
	assert.Zero(t, backend.writeCount(), "an unread store hibernated an agent")

	backend.healthy = nil
	checker.check(context.Background())
	assert.NotZero(t, backend.writeCount(), "a healthy sweep did not hibernate an idle agent")
	assert.Equal(t, apiv1.ReasonHibernated, conditionReason(t, backend.written("my-agent"), apiv1.ConditionReady))
}

// TEST_SCENARIO: An unread pool is unknown, not the install's default. A read
// TEST_SCENARIO: that failed must not become a size, and a lower budget read later must reach
// TEST_SCENARIO: the next decision.
func TestUnreadBudgetNeverBecomesASize(t *testing.T) {
	r, _ := setupReconciler(t, nil)
	backend := newRecordingBackend(crAgentBackend{dynamic: r.dynamic, namespace: r.config.Namespace})
	backend.budgetErr = errors.New("the store timed out")
	r.WithAgentBackend(backend)

	if _, err := r.refreshVMPool(context.Background(), "owner-1"); !errors.Is(err, errVMPoolUnread) {
		t.Fatalf("an unread budget answered %v, want errVMPoolUnread", err)
	}

	backend.budgetErr = nil
	backend.budget = budgetWithMemory("8Gi")
	if limit, err := r.runnerLimitMiB(context.Background(), "owner-1"); err != nil || limit != 8192 {
		t.Fatalf("limit = %d, err = %v", limit, err)
	}
	backend.budget = budgetWithMemory("4Gi")
	r.ForgetVMPools()
	if limit, err := r.runnerLimitMiB(context.Background(), "owner-1"); err != nil || limit != 4096 {
		t.Fatalf("a lowered pool did not reach the next read: limit = %d, err = %v", limit, err)
	}
}

// TEST_SCENARIO: A reclaim names the signals version it decided from, so a wake
// TEST_SCENARIO: that landed in between makes the store refuse the stamp rather than spend an
// TEST_SCENARIO: activity somebody just made.
func TestReclaimStampsTheVersionItRead(t *testing.T) {
	r, _ := setupReconciler(t, nil)
	backend := newRecordingBackend(crAgentBackend{dynamic: r.dynamic, namespace: r.config.Namespace})
	r.WithAgentBackend(backend)
	require.NoError(t, r.stampAnnotation(context.Background(), "my-agent", annReclaimedAt, timeAgo(0), "7"))
	assert.Equal(t, []string{"7"}, backend.reclaims)
}

// TEST_SCENARIO: Once the rows own the definition, the controller renders it and
// TEST_SCENARIO: writes no size into it, and the Agent's children are owned by its anchor.
func TestNoSpecWriteAndAnchorsOwnTheChildren(t *testing.T) {
	agent := agentCR()
	agent.Labels = map[string]string{envoyOwnerLabel: "owner-1"}
	agent.Spec.Resources = apiv1.ResourceSpec{}
	r, client := setupReconciler(t, agent)
	backend := newRecordingBackend(crAgentBackend{dynamic: r.dynamic, namespace: r.config.Namespace})
	r.WithAgentBackend(backend)

	// UNIT_BOUNDARY_DESCRIPTION: The machine never starts in this fake cluster; what this spec is about is
	// UNIT_BOUNDARY_DESCRIPTION: the definition write and the ownership, which both happen before it.
	_ = r.Reconcile(context.Background(), agent)

	stored, err := r.backend.Get(context.Background(), "my-agent")
	require.NoError(t, err)
	spec, _, _ := unstructured.NestedMap(stored.Object, "spec")
	limits, _, _ := unstructured.NestedStringMap(spec, "resources", "limits")
	assert.Empty(t, limits, "the controller filled a definition the rows own: %v", limits)

	anchor, err := client.CoreV1().ConfigMaps(r.config.Namespace).Get(context.Background(), anchorName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "agent-uid", anchor.Data[anchorIncarnation])
	sa, err := client.CoreV1().ServiceAccounts(r.config.Namespace).Get(context.Background(), "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	require.Len(t, sa.OwnerReferences, 1)
	assert.Equal(t, "ConfigMap", sa.OwnerReferences[0].Kind, "the ServiceAccount is not owned by the anchor")
	assert.Equal(t, anchor.UID, sa.OwnerReferences[0].UID)
}

// TEST_SCENARIO: The anchor is deleted last. It stays while the Agent is still
// TEST_SCENARIO: there, and it stays when a release-namespace cleanup failed, so the delete
// TEST_SCENARIO: worker retries instead of leaking the objects; the anchor of the previous
// TEST_SCENARIO: incarnation goes only once no row of that incarnation is left.
func TestAnchorDeletionIsLastAndConditional(t *testing.T) {
	agent := agentCR()
	agent.Labels = map[string]string{envoyOwnerLabel: "owner-1"}
	r, client := setupReconciler(t, agent)
	backend := newRecordingBackend(crAgentBackend{dynamic: r.dynamic, namespace: r.config.Namespace})
	r.WithAgentBackend(backend)
	_ = r.Reconcile(context.Background(), agent)

	// UNIT_BOUNDARY_DESCRIPTION: The Agent still exists: the cleanup must wait and keep the anchor.
	assert.Error(t, r.Delete(context.Background(), "my-agent", "owner-1", ""))
	_, err := client.CoreV1().ConfigMaps(r.config.Namespace).Get(context.Background(), anchorName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err, "the anchor went while its Agent was still there")

	// UNIT_BOUNDARY_DESCRIPTION: The row is gone, but the release-namespace cleanup fails: the anchor is
	// UNIT_BOUNDARY_DESCRIPTION: the record that there is work left.
	backend.gone = true
	failCleanup := true
	client.PrependReactor("delete", "services", func(k8stesting.Action) (bool, runtime.Object, error) {
		if failCleanup {
			return true, nil, errors.New("the API server is unavailable")
		}
		return false, nil, nil
	})
	assert.Error(t, r.Delete(context.Background(), "my-agent", "owner-1", ""))
	_, err = client.CoreV1().ConfigMaps(r.config.Namespace).Get(context.Background(), anchorName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err, "the anchor went while a cleanup was still failing")

	failCleanup = false
	require.NoError(t, r.Delete(context.Background(), "my-agent", "owner-1", ""))
	_, err = client.CoreV1().ConfigMaps(r.config.Namespace).Get(context.Background(), anchorName("my-agent"), metav1.GetOptions{})
	assert.True(t, apierrors.IsNotFound(err), "the anchor outlived a completed cleanup")
}

// TEST_SCENARIO: The sweep that runs cold hands the delete worker every anchor
// TEST_SCENARIO: whose Agent is gone, and leaves the anchors of Agents that are still there:
// TEST_SCENARIO: a deletion the controller never saw is recovered from the cluster, not from a
// TEST_SCENARIO: cache.
func TestAnchorSweepFindsMissedDeletions(t *testing.T) {
	agent := agentCR()
	agent.Labels = map[string]string{envoyOwnerLabel: "owner-1"}
	r, _ := setupReconciler(t, agent)
	backend := newRecordingBackend(crAgentBackend{dynamic: r.dynamic, namespace: r.config.Namespace})
	r.WithAgentBackend(backend)
	_ = r.Reconcile(context.Background(), agent)

	now := time.Now()
	r.clock = func() time.Time { return now }
	var enqueued []string
	require.NoError(t, r.ReconcileOrphanAnchors(context.Background(), func(name string) { enqueued = append(enqueued, name) }))
	assert.Empty(t, enqueued, "a live Agent's anchor was enqueued")

	backend.gone = true
	require.NoError(t, r.ReconcileOrphanAnchors(context.Background(), func(name string) { enqueued = append(enqueued, name) }))
	assert.Empty(t, enqueued, "an anchor was enqueued before its grace ran out")

	now = now.Add(orphanGrace + time.Minute)
	require.NoError(t, r.ReconcileOrphanAnchors(context.Background(), func(name string) { enqueued = append(enqueued, name) }))
	assert.Equal(t, []string{"my-agent"}, enqueued)
}

// TEST_SCENARIO: An Agent re-created under the same name gets a new anchor and
// TEST_SCENARIO: a new incarnation, and the children already in the cluster still name the
// TEST_SCENARIO: old authority. Converging their metadata hands them to the new anchor before
// TEST_SCENARIO: the old one is collected; without it the gateway would be garbage-collected
// TEST_SCENARIO: from under a live Agent.
func TestARecreatedAgentsChildrenAreHandedToTheNewAnchor(t *testing.T) {
	agent := agentCR()
	agent.Labels = map[string]string{envoyOwnerLabel: "owner-1"}
	r, client := setupReconciler(t, agent)
	_, err := client.CoreV1().ServiceAccounts(r.config.Namespace).Create(context.Background(), &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name: "my-agent", Namespace: r.config.Namespace, UID: "old-sa",
			OwnerReferences: []metav1.OwnerReference{{
				APIVersion: apiv1.GroupVersion.String(), Kind: "Agent", Name: "my-agent", UID: "old-agent-uid",
			}},
		},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
	backend := newRecordingBackend(crAgentBackend{dynamic: r.dynamic, namespace: r.config.Namespace})
	r.WithAgentBackend(backend)
	_ = r.Reconcile(context.Background(), agent)

	sa, err := client.CoreV1().ServiceAccounts(r.config.Namespace).Get(context.Background(), "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	require.Len(t, sa.OwnerReferences, 1)
	assert.NotEqual(t, "old-agent-uid", string(sa.OwnerReferences[0].UID))
	assert.Equal(t, "ConfigMap", sa.OwnerReferences[0].Kind)
}

// TEST_SCENARIO: The custom-resource path is byte-identical to what it was:
// TEST_SCENARIO: an owner reference it does not recognize is appended beside, never adopted
// TEST_SCENARIO: away. Adoption exists because the rows have no object for a child to name,
// TEST_SCENARIO: and it must not change the CR path's behavior.
func TestCRDModeKeepsAnExistingOwnerReference(t *testing.T) {
	agent := agentCR()
	agent.Labels = map[string]string{envoyOwnerLabel: "owner-1"}
	r, client := setupReconciler(t, agent)
	_, err := client.CoreV1().ServiceAccounts(r.config.Namespace).Create(context.Background(), &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name: "my-agent", Namespace: r.config.Namespace,
			OwnerReferences: []metav1.OwnerReference{{
				APIVersion: apiv1.GroupVersion.String(), Kind: "Agent", Name: "my-agent", UID: "old-agent-uid",
			}},
		},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
	_ = r.Reconcile(context.Background(), agent)

	sa, err := client.CoreV1().ServiceAccounts(r.config.Namespace).Get(context.Background(), "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Len(t, sa.OwnerReferences, 2, "the CR path adopted an owner reference away")
}
