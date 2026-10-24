package reconciler

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/config"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

func idleCheckerCfg(timeout time.Duration) *config.Config {
	return &config.Config{
		Namespace: "test-agents",
		AgentBase: config.AgentBase{
			VMIdleTimeout: config.Duration(timeout),
		},
	}
}

func idleAgentCR(name, lastActivity string, annotations map[string]string) *apiv1.Agent {
	if annotations == nil {
		annotations = map[string]string{}
	}
	if lastActivity != "" {
		annotations["agent-platform.ai/last-activity"] = lastActivity
	}
	return &apiv1.Agent{
		ObjectMeta: metav1.ObjectMeta{
			Name: name, Namespace: "test-agents", Annotations: annotations,
		},
		Spec: apiv1.AgentSpec{Image: "foo"},
	}
}

func newIdleChecker(t *testing.T, timeout time.Duration, agents []*apiv1.Agent, sts ...runtime.Object) (*IdleChecker, *fake.Clientset) {
	t.Helper()
	dynObjs := make([]runtime.Object, 0, len(agents))
	for _, a := range agents {
		u, err := agentToUnstructured(a)
		require.NoError(t, err)
		dynObjs = append(dynObjs, u)
	}
	client := fake.NewSimpleClientset(sts...)
	checker := NewIdleChecker(client, newFakeDynamic(dynObjs...), idleCheckerCfg(timeout))
	checker.busyProbe = func(context.Context, string) bool { return false }
	return checker, client
}

func agentStatefulSet(name string, replicas int32) *appsv1.StatefulSet {
	return &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: "test-agents",
			Labels:    map[string]string{LabelAgent: name},
		},
		Spec: appsv1.StatefulSetSpec{Replicas: &replicas},
	}
}

func TestIdleChecker_SkipsRecentlyActiveInstance(t *testing.T) {
	recentTime := time.Now().UTC().Add(-10 * time.Minute).Format(time.RFC3339)
	agent := idleAgentCR("active-agent", recentTime, nil)
	ss := agentStatefulSet("active-agent", 1)
	checker, client := newIdleChecker(t, 1*time.Hour, []*apiv1.Agent{agent}, ss)

	checker.check(context.Background())

	gotSS, err := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "active-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(1), *gotSS.Spec.Replicas, "recently-active agent stays running")
}

func TestIdleChecker_SkipsActiveSession(t *testing.T) {
	staleTime := time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339)
	agent := idleAgentCR("session-agent", staleTime, map[string]string{
		"agent-platform.ai/active-session": "true",
	})
	ss := agentStatefulSet("session-agent", 1)
	checker, client := newIdleChecker(t, 1*time.Hour, []*apiv1.Agent{agent}, ss)

	checker.check(context.Background())

	gotSS, err := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "session-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(1), *gotSS.Spec.Replicas, "agent with an active session stays running")
}

func TestIdleChecker_SkipsNoLastActivity(t *testing.T) {
	agent := idleAgentCR("new-agent", "", nil)
	ss := agentStatefulSet("new-agent", 1)
	checker, client := newIdleChecker(t, 1*time.Hour, []*apiv1.Agent{agent}, ss)

	checker.check(context.Background())

	gotSS, err := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "new-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(1), *gotSS.Spec.Replicas, "agent with no activity stamp fails open and stays running")
}

func TestIdleChecker_SkipsBusyAgent(t *testing.T) {
	staleTime := time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339)
	agent := idleAgentCR("busy-agent", staleTime, nil)
	ss := agentStatefulSet("busy-agent", 1)
	checker, client := newIdleChecker(t, 1*time.Hour, []*apiv1.Agent{agent}, ss)
	checker.busyProbe = func(context.Context, string) bool { return true }

	checker.check(context.Background())

	gotSS, err := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "busy-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(1), *gotSS.Spec.Replicas, "busy agent must stay running even when idle by activity")
}

// TEST_SCENARIO: Hibernating an agent already scaled to zero leaves it there.
func TestIdleChecker_HibernatingAZeroedAgentIsIdempotent(t *testing.T) {
	staleTime := time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339)
	agent := idleAgentCR("hibernated-agent", staleTime, nil)
	ss := agentStatefulSet("hibernated-agent", 0)
	checker, client := newIdleChecker(t, 1*time.Hour, []*apiv1.Agent{agent}, ss)

	checker.check(context.Background())

	gotSS, err := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "hibernated-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(0), *gotSS.Spec.Replicas, "already-hibernated agent stays at zero (idempotent)")
}

func hibernatedCondition() []metav1.Condition {
	return []metav1.Condition{{
		Type:               apiv1.ConditionReady,
		Status:             metav1.ConditionFalse,
		Reason:             apiv1.ReasonHibernated,
		LastTransitionTime: metav1.Now(),
	}}
}

// TEST_SCENARIO: An agent at zero that already reports hibernated has no work left, so it is skipped.
func TestIdleChecker_SkipsAgentAtZeroAndReportedHibernated(t *testing.T) {
	staleTime := time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339)
	agent := idleAgentCR("sleeping-agent", staleTime, nil)
	agent.Status.Conditions = hibernatedCondition()
	ss := agentStatefulSet("sleeping-agent", 0)
	checker, _ := newIdleChecker(t, 1*time.Hour, []*apiv1.Agent{agent}, ss)
	probed := false
	checker.busyProbe = func(context.Context, string) bool { probed = true; return false }

	checker.check(context.Background())

	assert.False(t, probed, "a sleeping agent must not be probed or re-hibernated")
}

func TestIdleChecker_CheckInterval(t *testing.T) {
	tests := []struct {
		timeout  time.Duration
		expected time.Duration
	}{
		{1 * time.Hour, 5 * time.Minute},
		{3 * time.Minute, 30 * time.Second},
		{15 * time.Minute, 2*time.Minute + 30*time.Second},
	}
	for _, tt := range tests {
		checker := NewIdleChecker(nil, nil, idleCheckerCfg(tt.timeout))
		assert.Equal(t, tt.expected, checker.checkInterval(), "timeout=%v", tt.timeout)
	}
}

func withHibernationTimeout(agent *apiv1.Agent, d time.Duration) *apiv1.Agent {
	agent.Spec.HibernationTimeout = &metav1.Duration{Duration: d}
	return agent
}

// TEST_SCENARIO: An agent that sets a one-minute hibernation timeout must be swept inside its own window, so the sweep cadence follows the shortest per-agent timeout in play, not the chart-wide one.
func TestIdleChecker_CheckIntervalFollowsShortestAgentTimeout(t *testing.T) {
	recentTime := time.Now().UTC().Add(-10 * time.Second).Format(time.RFC3339)
	agent := withHibernationTimeout(idleAgentCR("quick-agent", recentTime, nil), time.Minute)
	ss := agentStatefulSet("quick-agent", 1)
	checker, _ := newIdleChecker(t, 1*time.Hour, []*apiv1.Agent{agent}, ss)

	assert.Equal(t, 5*time.Minute, checker.checkInterval(), "before any sweep the chart-wide default sets the cadence")

	checker.check(context.Background())

	assert.Equal(t, 15*time.Second, checker.checkInterval(), "a one-minute agent must be swept inside its own window")
}

// TEST_SCENARIO: An agent past its own short timeout hibernates even though the chart-wide default is far longer, which is the case the one-minute setting exercises.
func TestIdleChecker_HibernatesByShortPerAgentTimeout(t *testing.T) {
	staleTime := time.Now().UTC().Add(-5 * time.Minute).Format(time.RFC3339)
	agent := withHibernationTimeout(idleAgentCR("minute-agent", staleTime, nil), time.Minute)
	ss := agentStatefulSet("minute-agent", 1)
	checker, client := newIdleChecker(t, 1*time.Hour, []*apiv1.Agent{agent}, ss)

	checker.check(context.Background())

	gotSS, err := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "minute-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(0), *gotSS.Spec.Replicas, "an agent past its own timeout hibernates whatever the chart-wide default says")
}

// TEST_SCENARIO: An install whose chart-wide default never hibernates still has to serve agents that set their own positive timeout, so the sweep keeps running and honours the override.
func TestIdleChecker_ServesOverridesWhenGlobalTimeoutIsZero(t *testing.T) {
	staleTime := time.Now().UTC().Add(-5 * time.Minute).Format(time.RFC3339)
	agent := withHibernationTimeout(idleAgentCR("opt-in-agent", staleTime, nil), time.Minute)
	ss := agentStatefulSet("opt-in-agent", 1)
	checker, client := newIdleChecker(t, 0, []*apiv1.Agent{agent}, ss)

	assert.Equal(t, 5*time.Minute, checker.checkInterval(), "with nothing observed yet the sweep still runs, at its slowest cadence")

	checker.check(context.Background())

	gotSS, err := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "opt-in-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(0), *gotSS.Spec.Replicas, "an opted-in agent hibernates even when the install defaults to always-on")
	assert.Equal(t, 15*time.Second, checker.checkInterval(), "the observed override sets the cadence when the install has none")
}

// TEST_SCENARIO: A restart forgets what the last sweep observed, so the run loop must sweep once before its first tick; otherwise a one-minute agent waits out the chart-wide cadence and the reported bug returns on every restart.
func TestIdleChecker_RunLoopSweepsBeforeFirstTick(t *testing.T) {
	staleTime := time.Now().UTC().Add(-5 * time.Minute).Format(time.RFC3339)
	agent := withHibernationTimeout(idleAgentCR("minute-agent", staleTime, nil), time.Minute)
	ss := agentStatefulSet("minute-agent", 1)
	checker, client := newIdleChecker(t, 1*time.Hour, []*apiv1.Agent{agent}, ss)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	stopped := make(chan struct{})
	go func() {
		checker.RunLoop(ctx)
		close(stopped)
	}()

	require.Eventually(t, func() bool {
		gotSS, err := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "minute-agent", metav1.GetOptions{})
		return err == nil && *gotSS.Spec.Replicas == 0
	}, 2*time.Second, 10*time.Millisecond,
		"the first tick is five minutes away, so only a sweep before it can hibernate this agent")

	assert.Eventually(t, func() bool { return checker.checkInterval() == 15*time.Second }, 2*time.Second, 10*time.Millisecond,
		"the sweep before the first tick also seeds the cadence from the agent's own timeout")

	cancel()
	select {
	case <-stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("idle checker did not stop when its context was cancelled")
	}
}

// TEST_SCENARIO: The run loop used to shut itself down on an always-on install, which left every per-agent timeout unserved, so it must stay up and stop only when its context is cancelled.
func TestIdleChecker_RunLoopStaysUpWhenGlobalTimeoutIsZero(t *testing.T) {
	agent := withHibernationTimeout(idleAgentCR("opt-in-agent", "", nil), time.Minute)
	checker, _ := newIdleChecker(t, 0, []*apiv1.Agent{agent})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	stopped := make(chan struct{})
	go func() {
		checker.RunLoop(ctx)
		close(stopped)
	}()

	select {
	case <-stopped:
		t.Fatal("idle checker exited although agents can set their own hibernation timeout")
	case <-time.After(50 * time.Millisecond):
	}

	cancel()
	select {
	case <-stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("idle checker did not stop when its context was cancelled")
	}
}

// TEST_SCENARIO: A zero per-agent timeout means never hibernate, and such an agent must not drag the sweep cadence down either.
func TestIdleChecker_ZeroPerAgentTimeoutNeverHibernates(t *testing.T) {
	staleTime := time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339)
	agent := withHibernationTimeout(idleAgentCR("always-on-agent", staleTime, nil), 0)
	ss := agentStatefulSet("always-on-agent", 1)
	checker, client := newIdleChecker(t, 1*time.Hour, []*apiv1.Agent{agent}, ss)

	checker.check(context.Background())

	gotSS, err := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "always-on-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(1), *gotSS.Spec.Replicas, "an always-on agent keeps running however long it sits idle")
	assert.Equal(t, 5*time.Minute, checker.checkInterval(), "an always-on agent does not speed the sweep up")
}

func runnerDeployment(annotations map[string]string) *appsv1.Deployment {
	return &appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{
		Name:        "platform-vm-runner-owner-1",
		Namespace:   "test-agents",
		Annotations: annotations,
		Labels: map[string]string{
			"app.kubernetes.io/component": vmRunnerComponent,
			envoyOwnerLabel:               testOwner,
		},
	}}
}

// TEST_SCENARIO: A runner roll waits for every machine that was ready before it to be ready again, and a hibernated machine never comes back ready, so the idle checker must leave a machine listed in the runner's `runner-awaiting` alone until the roll settles or gives up. Without the pin the sweep hibernates it a fraction of a second after the roll starts, and the roll waits out its settle timeout.
func TestIdleChecker_SkipsAMachineARunnerRollAwaits(t *testing.T) {
	staleTime := time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339)
	agent := idleAgentCR("rolled-agent", staleTime, nil)
	agent.Labels = map[string]string{envoyOwnerLabel: testOwner}
	ss := agentStatefulSet("rolled-agent", 1)
	runner := runnerDeployment(map[string]string{
		annRunnerRolledAt: time.Now().UTC().Format(time.RFC3339),
		annRunnerAwaiting: "rolled-agent,another-agent",
	})
	checker, client := newIdleChecker(t, 1*time.Hour, []*apiv1.Agent{agent}, ss, runner)
	checker.config.AgentBase.VMIdleTimeout = config.Duration(5 * time.Minute)

	checker.check(context.Background())

	gotSS, err := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "rolled-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(1), *gotSS.Spec.Replicas, "a machine the roll awaits stays up")
}

// TEST_SCENARIO: The pin is the roll's own record, so it is released the moment the roll settles or gives up: the runner's `runner-awaiting` and its roll stamp are cleared in one write, and the sweep hibernates a machine the next pass finds idle again.
func TestIdleChecker_HibernatesOnceTheRollSettles(t *testing.T) {
	staleTime := time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339)
	settle := func(t *testing.T, annotations map[string]string) int32 {
		t.Helper()
		agent := idleAgentCR("rolled-agent", staleTime, nil)
		agent.Labels = map[string]string{envoyOwnerLabel: testOwner}
		ss := agentStatefulSet("rolled-agent", 1)
		checker, client := newIdleChecker(t, 1*time.Hour, []*apiv1.Agent{agent}, ss, runnerDeployment(annotations))
		checker.config.AgentBase.VMIdleTimeout = config.Duration(5 * time.Minute)

		checker.check(context.Background())

		gotSS, err := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "rolled-agent", metav1.GetOptions{})
		require.NoError(t, err)
		return *gotSS.Spec.Replicas
	}

	rolling := map[string]string{
		annRunnerRolledAt: time.Now().UTC().Format(time.RFC3339),
		annRunnerAwaiting: "rolled-agent",
	}
	assert.Equal(t, int32(1), settle(t, rolling), "the roll pins the machine while it holds the wait")
	assert.Equal(t, int32(0), settle(t, map[string]string{}), "a settled roll leaves nothing behind to pin the machine")
	assert.Equal(t, int32(0), settle(t, map[string]string{annRunnerAwaiting: "rolled-agent"}), "a wait with no roll stamp behind it is no roll")
	stalled := map[string]string{
		annRunnerRolledAt: time.Now().UTC().Format(time.RFC3339),
		annRunnerAwaiting: "rolled-agent",
		annRunnerStalled:  time.Now().UTC().Format(time.RFC3339),
	}
	assert.Equal(t, int32(0), settle(t, stalled), "a roll whose own pod never started is waiting on nothing of the owner's")
}

// TEST_SCENARIO: A runner roll starts while the sweep is probing the machine it will wait on. The probe is the last thing the sweep does before it hibernates, so a pin read before it would be stale and the machine would be halted under the roll. The sweep must read the pin under the owner's lock, the one a roll start takes, and leave that machine up.
func TestIdleChecker_RollStartingDuringTheSweepKeepsItsMachineAwake(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t, testOwner)
	nodes[testOwner].specs["my-agent"] = vmrunner.MachineSpec{Running: true}
	nodes[testOwner].set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	raw, err := r.dynamic.Resource(AgentsGVR).Namespace(r.config.Namespace).Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	raw.SetAnnotations(map[string]string{annLastActivity: time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339)})
	_, err = r.dynamic.Resource(AgentsGVR).Namespace(r.config.Namespace).Update(ctx, raw, metav1.UpdateOptions{})
	require.NoError(t, err)
	_, err = r.client.AppsV1().StatefulSets(r.config.Namespace).Create(ctx, agentStatefulSet("my-agent", 1), metav1.CreateOptions{})
	require.NoError(t, err)
	checker := NewIdleChecker(r.client, r.dynamic, r.config).WithMachineHalt(r.HaltMachine).WithOwnerLock(r.OwnerLock)
	checker.busyProbe = func(context.Context, string) bool {
		changeRunnerPod(r)
		require.NoError(t, r.applyRunnerDeployment(context.Background(), testOwner, r.runnerOwnerRef(context.Background()), true))
		dep, err := r.client.AppsV1().Deployments(r.config.Namespace).Get(ctx, r.runnerName(testOwner), metav1.GetOptions{})
		require.NoError(t, err)
		require.Equal(t, "my-agent", dep.Annotations[annRunnerAwaiting])
		return false
	}

	checker.check(ctx)

	ss, err := r.client.AppsV1().StatefulSets(r.config.Namespace).Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(1), *ss.Spec.Replicas, "a machine a roll started waiting on is not scaled down")
	assert.True(t, nodes[testOwner].spec("my-agent").Running, "a machine a roll started waiting on is not halted")
}

// TEST_SCENARIO: The pin read and the halt must be one decision, taken under the owner's lock, the one a runner roll start takes. A pin read before the probe, or a halt taken outside that lock, lets a roll begin in between and wait on a machine the sweep then stops. This asserts the lock is held at the moment of the halt, which is what closes that window.
func TestIdleChecker_HaltsUnderTheOwnersLock(t *testing.T) {
	agent := idleAgentCR("locked-agent", time.Now().UTC().Add(-2*time.Hour).Format(time.RFC3339), nil)
	agent.Labels = map[string]string{envoyOwnerLabel: testOwner}
	checker, _ := newIdleChecker(t, time.Hour, []*apiv1.Agent{agent}, agentStatefulSet("locked-agent", 1))
	checker.config.AgentBase.VMIdleTimeout = config.Duration(time.Hour)
	lock := checker.lockOf(testOwner)
	inside := false
	checker.halt = func(context.Context, string, string) error {
		inside = !lock.TryLock()
		if !inside {
			lock.Unlock()
		}
		return nil
	}

	checker.check(context.Background())

	assert.True(t, inside, "the halt runs inside the owner's lock, so a roll start cannot land between the pin read and the halt")
}

// TEST_SCENARIO: The last runner of an upgrade is already on the pod it should run, so its turn never asks for a place in the roll, and a machine that never comes back would leave its wait standing for good. The roll's own turn must give the wait up at the settle timeout, and the pin with it, so the machine hibernates again.
func TestIdleChecker_LastRollReleasesItsPinAtTheSettleTimeout(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t, testOwner)
	nodes[testOwner].specs["my-agent"] = vmrunner.MachineSpec{Running: true}
	nodes[testOwner].set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStarting})
	setRolledAt(t, r, testOwner, time.Now().Add(-time.Hour))
	dep, err := r.client.AppsV1().Deployments(r.config.Namespace).Get(ctx, r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	dep.Annotations[annRunnerAwaiting] = "my-agent"
	_, err = r.client.AppsV1().Deployments(r.config.Namespace).Update(ctx, dep, metav1.UpdateOptions{})
	require.NoError(t, err)
	checker := NewIdleChecker(r.client, r.dynamic, r.config).WithOwnerLock(r.OwnerLock)

	r.ReconcileRunnerRollout(ctx)

	dep, err = r.client.AppsV1().Deployments(r.config.Namespace).Get(ctx, r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Empty(t, dep.Annotations[annRunnerAwaiting], "the last unchanged runner gives its wait up at the settle timeout too")
	pinned, err := checker.machinesAwaitingRoll(ctx, testOwner)
	require.NoError(t, err)
	assert.False(t, pinned["my-agent"], "a wait that timed out pins nothing")
}

// TEST_SCENARIO: A runner already on the pod it should run whose new pod never becomes ready asks for no place in the roll, so nothing else ever evaluates its wait. Its turn must give the wait up at the settle timeout too: the roll is marked stalled, so the release goes no further, and the pin on the owner's machines ends with the wait.
func TestIdleChecker_LastUnreadyPodRollReleasesItsPin(t *testing.T) {
	ctx := context.Background()
	r, nodes := setupRolloutReconciler(t, testOwner)
	nodes[testOwner].specs["my-agent"] = vmrunner.MachineSpec{Running: true}
	nodes[testOwner].set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStarting})
	setRolledAt(t, r, testOwner, time.Now().Add(-time.Hour))
	dep, err := r.client.AppsV1().Deployments(r.config.Namespace).Get(ctx, r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	dep.Annotations[annRunnerAwaiting] = "my-agent"
	dep.Status.ReadyReplicas = 0
	_, err = r.client.AppsV1().Deployments(r.config.Namespace).Update(ctx, dep, metav1.UpdateOptions{})
	require.NoError(t, err)

	r.ReconcileRunnerRollout(ctx)

	dep, err = r.client.AppsV1().Deployments(r.config.Namespace).Get(ctx, r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	assert.NotEmpty(t, dep.Annotations[annRunnerStalled], "a pod that never started keeps the release from advancing, marked stalled")
	raw, err := r.dynamic.Resource(AgentsGVR).Namespace(r.config.Namespace).Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	raw.SetAnnotations(map[string]string{annLastActivity: time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339)})
	_, err = r.dynamic.Resource(AgentsGVR).Namespace(r.config.Namespace).Update(ctx, raw, metav1.UpdateOptions{})
	require.NoError(t, err)
	_, err = r.client.AppsV1().StatefulSets(r.config.Namespace).Create(ctx, agentStatefulSet("my-agent", 1), metav1.CreateOptions{})
	require.NoError(t, err)
	checker := NewIdleChecker(r.client, r.dynamic, r.config)
	checker.busyProbe = func(context.Context, string) bool { return false }

	checker.check(ctx)

	gotSS, err := r.client.AppsV1().StatefulSets(r.config.Namespace).Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(0), *gotSS.Spec.Replicas, "a stalled roll pins nothing, so its machine hibernates again")
}

// TEST_SCENARIO: An Agent reads the chart's idle timeout only when it carries no override of its own; one that carries an override honours it, "0s" included, so a starter kit's never-hibernate seed keeps a machine awake.
func TestEffectiveIdleTimeout(t *testing.T) {
	base := config.AgentBase{VMIdleTimeout: config.Duration(5 * time.Minute)}
	never := &metav1.Duration{}
	hour := &metav1.Duration{Duration: time.Hour}
	assert.Equal(t, time.Duration(0), effectiveIdleTimeout(never, base))
	assert.Equal(t, 5*time.Minute, effectiveIdleTimeout(nil, base))
	assert.Equal(t, time.Hour, effectiveIdleTimeout(hour, base))
}

// TEST_SCENARIO: A vm agent that carries a never-hibernate override outlives the chart's vm idle timeout, and one past its own positive override hibernates inside it.
func TestIdleChecker_VMHonoursItsOwnTimeout(t *testing.T) {
	staleTime := time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339)
	swept := func(t *testing.T, override time.Duration) int32 {
		t.Helper()
		agent := withHibernationTimeout(idleAgentCR("vm-agent", staleTime, nil), override)
		checker, client := newIdleChecker(t, time.Hour, []*apiv1.Agent{agent}, agentStatefulSet("vm-agent", 1))
		checker.config.AgentBase.VMIdleTimeout = config.Duration(5 * time.Minute)

		checker.check(context.Background())

		gotSS, err := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "vm-agent", metav1.GetOptions{})
		require.NoError(t, err)
		return *gotSS.Spec.Replicas
	}

	assert.Equal(t, int32(1), swept(t, 0), "a never-hibernate vm agent outlives the chart's vm idle timeout")
	assert.Equal(t, int32(0), swept(t, time.Minute), "a vm agent past its own short override hibernates")
}

// TEST_SCENARIO: A vm agent woken five minutes ago is idle by its activity stamp, but its idle clock runs from the moment it turned ready, and a boot in progress is not idle; a boot copying a disk is held past the cap, since the runner bounds it; a decided start failure, a refused start, a boot past the cap, a hibernation the runner has not confirmed, and a ready that aged out are hibernated as before.
func TestIdleChecker_VMBootInProgressIsNotIdle(t *testing.T) {
	now := time.Now().UTC()
	at := func(ago time.Duration) string { return now.Add(-ago).Format(time.RFC3339) }
	cond := func(typ string, ok bool, reason string, ago time.Duration) metav1.Condition {
		status := metav1.ConditionFalse
		if ok {
			status = metav1.ConditionTrue
		}
		return metav1.Condition{Type: typ, Status: status, Reason: reason, LastTransitionTime: metav1.NewTime(now.Add(-ago))}
	}
	booting := cond(apiv1.ConditionAgentPodReady, false, vmrunner.ReasonNotReady, time.Hour)
	notReady := cond(apiv1.ConditionReady, false, "PodsNotReady", time.Hour)
	tests := []struct {
		name         string
		lastActivity time.Duration
		conds        []metav1.Condition
		replicas     int32
		hibernated   bool
	}{
		{"booting", 6 * time.Minute, []metav1.Condition{booting, notReady}, 1, false},
		{"ready since a minute", 6 * time.Minute, []metav1.Condition{cond(apiv1.ConditionAgentPodReady, true, "PodReady", time.Minute), cond(apiv1.ConditionReady, true, "AllPodsReady", time.Minute)}, 1, false},
		{"ready since long", 6 * time.Minute, []metav1.Condition{cond(apiv1.ConditionAgentPodReady, true, "PodReady", 6*time.Minute), cond(apiv1.ConditionReady, true, "AllPodsReady", 6*time.Minute)}, 1, true},
		{"start failed", 6 * time.Minute, []metav1.Condition{booting, notReady, cond(apiv1.ConditionStartFailed, true, apiv1.ReasonNeverReady, time.Minute)}, 1, true},
		{"boot failed", 6 * time.Minute, []metav1.Condition{cond(apiv1.ConditionAgentPodReady, false, vmrunner.ReasonBootFailed, time.Hour), notReady}, 1, true},
		{"boot past the cap", 21 * time.Minute, []metav1.Condition{booting, notReady}, 1, true},
		{"copying a disk past the cap", 3 * time.Hour, []metav1.Condition{cond(apiv1.ConditionAgentPodReady, false, vmrunner.ReasonCopyingDisk, time.Hour), notReady}, 1, false},
		{"halt unconfirmed", 6 * time.Minute, []metav1.Condition{booting, notReady}, 0, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			agent := idleAgentCR("vm-agent", at(tt.lastActivity), nil)
			agent.Status.Conditions = tt.conds
			checker, _ := newIdleChecker(t, time.Hour, []*apiv1.Agent{agent}, agentStatefulSet("vm-agent", tt.replicas))
			checker.config.AgentBase.VMIdleTimeout = config.Duration(5 * time.Minute)
			probed := false
			checker.busyProbe = func(context.Context, string) bool { probed = true; return false }

			checker.check(context.Background())

			assert.Equal(t, tt.hibernated, probed)
		})
	}
}
