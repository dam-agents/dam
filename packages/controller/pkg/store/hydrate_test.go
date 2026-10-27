package store

import (
	"reflect"
	"testing"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
)

// TEST_OVERVIEW: The rows become the object the controller reconciles. The
// TEST_OVERVIEW: custom resource was its whole vocabulary, so a field that is dropped here is
// TEST_OVERVIEW: a decision the controller makes blind: the idle clock, the pins, the restart
// TEST_OVERVIEW: revision, the machine stamps, the OOM bookkeeping, the hosts and the grants.
func at(t *testing.T, value string) *time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		t.Fatalf("parsing %q: %v", value, err)
	}
	return &parsed
}

func ptr[T any](value T) *T { return &value }

func testRow(t *testing.T) agentRow {
	return agentRow{
		ID:                    "my-agent",
		Incarnation:           "11111111-1111-1111-1111-111111111111",
		OwnerSub:              "sub-1",
		TemplateID:            ptr("tpl"),
		EnvironmentOf:         ptr("parent"),
		Name:                  "My Agent",
		Image:                 "agent:1",
		Harness:               ptr("claude-code"),
		ImagePullSecretRef:    ptr("pull"),
		SecretRef:             ptr("env"),
		HibernationTimeoutNs:  ptr(int64(90 * time.Minute)),
		NestedVirtualization:  true,
		RequireConnectionAddr: true,
		TelemetryAttribution:  ptr("root"),
		CPULimit:              "2",
		MemoryLimit:           "4Gi",
		DiskSize:              ptr("30Gi"),
		Sweepable:             true,
		LifetimeMs:            ptr(int64(3600000)),
		Generation:            7,
		CreatedAt:             time.Date(2026, 10, 24, 0, 0, 0, 0, time.UTC),
		SignalVersion:         11,
		LastActivityAt:        at(t, "2026-10-24T05:00:00.5Z"),
		LastActivityToken:     ptr("aaaaaaaa-1111-1111-1111-111111111111"),
		SessionPinned:         true,
		InvocationPinned:      true,
		StopRequestedAt:       at(t, "2026-10-24T05:01:00Z"),
		DisabledAt:            at(t, "2026-10-24T05:02:00Z"),
		RollRev:               "rev-1",
		ObservedGeneration:    6,
		MachineRestarts:       2,
		MachineRestartReason:  ptr("OOMKilled"),
		MachineUpAt:           at(t, "2026-10-24T04:00:00Z"),
		MemoryWaitUntil:       at(t, "2026-10-24T05:03:00Z"),
		RunnerOOMKillID:       ptr("kill-1@2026-10-24T04:59:00Z"),
		RunnerOOMRecoveredID:  ptr("kill-1@2026-10-24T04:59:00Z"),
	}
}

func TestHydrateCarriesEveryFieldTheControllerReads(t *testing.T) {
	conditions := []metav1.Condition{{
		Type: "Ready", Status: metav1.ConditionTrue, Reason: "AllPodsReady",
		Message: "", ObservedGeneration: 6,
		LastTransitionTime: metav1.NewTime(time.Date(2026, 10, 24, 4, 0, 0, 0, time.UTC)),
	}}
	agent := hydrate("test-agents", testRow(t), agentChildren{
		conditions: conditions,
		hosts:      []string{"a.test", "b.test"},
		grants:     []string{"conn-1"},
	})

	if got := agent.GetNamespace(); got != "test-agents" {
		t.Fatalf("namespace = %q", got)
	}
	if got := agent.GetUID(); string(got) != "11111111-1111-1111-1111-111111111111" {
		t.Fatalf("uid = %q", got)
	}
	if agent.GetGeneration() != 7 || agent.GetResourceVersion() != "11" {
		t.Fatalf("generation %d, resourceVersion %q", agent.GetGeneration(), agent.GetResourceVersion())
	}
	labels := agent.GetLabels()
	if labels[labelOwner] != "sub-1" || labels[labelTemplate] != "tpl" {
		t.Fatalf("labels = %v", labels)
	}
	annotations := agent.GetAnnotations()
	for key, want := range map[string]string{
		annLastActivity:      "2026-10-24T05:00:00.5Z",
		annActiveSession:     "true",
		annInvocationsActive: "true",
		annStopRequested:     "2026-10-24T05:01:00Z",
		annDisabled:          "2026-10-24T05:02:00Z",
		annRollRev:           "rev-1",
		annSweepable:         "true",
		annMachineUp:         "2026-10-24T04:00:00Z",
		annMemoryWaitUntil:   "2026-10-24T05:03:00Z",
		annRunnerOOMKill:     "kill-1@2026-10-24T04:59:00Z",
		annRunnerOOMDone:     "kill-1@2026-10-24T04:59:00Z",
	} {
		if annotations[key] != want {
			t.Fatalf("%s = %q, want %q", key, annotations[key], want)
		}
	}
	spec := mustMap(t, agent.Object, "spec")
	if spec["image"] != "agent:1" ||
		spec["hibernationTimeout"] != "1h30m0s" ||
		spec["requireConnectionAddress"] != true ||
		spec["storageSize"] != "30Gi" ||
		spec["environmentOf"] != "parent" ||
		spec["telemetryAttributionId"] != "root" {
		t.Fatalf("spec = %v", spec)
	}
	limits := spec["resources"].(map[string]any)["limits"].(map[string]any)
	if limits["cpu"] != "2" || limits["memory"] != "4Gi" {
		t.Fatalf("limits = %v", limits)
	}
	if hosts := spec["l7Hosts"].([]any); len(hosts) != 2 || hosts[0] != "a.test" {
		t.Fatalf("hosts = %v", hosts)
	}
	if grants := spec["grantedConnectionIds"].([]any); len(grants) != 1 || grants[0] != "conn-1" {
		t.Fatalf("grants = %v", grants)
	}
	status := mustMap(t, agent.Object, "status")
	if status["observedGeneration"] != int64(6) || status["agentPodRestarts"] != int64(2) {
		t.Fatalf("status = %v", status)
	}
	if status["agentPodRestartReason"] != "OOMKilled" {
		t.Fatalf("restart reason = %v", status["agentPodRestartReason"])
	}
	gotCondition := status["conditions"].([]any)[0].(map[string]any)
	if gotCondition["type"] != "Ready" || gotCondition["status"] != "True" {
		t.Fatalf("condition = %v", gotCondition)
	}
}

// TEST_SCENARIO: The reconciler reads a typed Agent, and the conversion drops a
// TEST_SCENARIO: key the typed spec has no field for without an error. A nesting ask written
// TEST_SCENARIO: outside spec.backend.vm reached no machine, so every spec key must survive it.
func TestHydrateSpecSurvivesTheTypedAgent(t *testing.T) {
	hydrated := hydrate("ns", testRow(t), agentChildren{hosts: []string{"a.test"}, grants: []string{"conn-1"}})
	var agent apiv1.Agent
	if err := runtime.DefaultUnstructuredConverter.FromUnstructured(hydrated.Object, &agent); err != nil {
		t.Fatal(err)
	}
	if agent.Spec.Backend == nil || agent.Spec.Backend.VM == nil || !agent.Spec.Backend.VM.NestedVirtualization {
		t.Fatalf("the nesting ask was lost: backend = %+v", agent.Spec.Backend)
	}
	typed, err := runtime.DefaultUnstructuredConverter.ToUnstructured(&agent.Spec)
	if err != nil {
		t.Fatal(err)
	}
	if spec := mustMap(t, hydrated.Object, "spec"); !reflect.DeepEqual(typed, spec) {
		t.Fatalf("the typed spec differs from the hydrated one:\n typed    %v\n hydrated %v", typed, spec)
	}
}

// TEST_SCENARIO: The reclaim mark applies to the activity it was stamped for.
// TEST_SCENARIO: A sleep, a disable or a wake rotates the token, and the mark must retire with
// TEST_SCENARIO: it or the idle clock would read a wake as spent.
func TestHydrateAppliesTheReclaimMarkOnlyToItsActivity(t *testing.T) {
	seed := testRow(t)
	seed.LastActivityToken = ptr("token-a")
	seed.ReclaimedActivityTok = ptr("token-a")
	seed.ReclaimedAt = at(t, "2026-10-24T05:04:00Z")
	if got := hydrate("ns", seed, agentChildren{}).GetAnnotations()[annReclaimedAt]; got == "" {
		t.Fatal("a mark on the current activity was dropped")
	}
	seed.LastActivityToken = ptr("token-b")
	if got := hydrate("ns", seed, agentChildren{}).GetAnnotations()[annReclaimedAt]; got != "" {
		t.Fatalf("a mark on an older activity survived as %q", got)
	}
}

// TEST_SCENARIO: An absorbed Agent's persisted mount is only a floor now. The
// TEST_SCENARIO: machine size is the definition's own size or the floor, whichever is larger,
// TEST_SCENARIO: and an Agent with neither asks for nothing and inherits the chart's default.
func TestDiskOf(t *testing.T) {
	cases := []struct {
		name  string
		size  *string
		floor *int64
		want  string
	}{
		{"no size and no floor", nil, nil, ""},
		{"a size alone", ptr("30Gi"), nil, "30Gi"},
		{"a floor alone", nil, ptr(int64(20 << 30)), "20Gi"},
		{"the size is larger", ptr("30Gi"), ptr(int64(20 << 30)), "30Gi"},
		{"the floor is larger", ptr("10Gi"), ptr(int64(20 << 30)), "20Gi"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := diskOf(agentRow{DiskSize: tc.size, DiskFloorBytes: tc.floor}); got != tc.want {
				t.Fatalf("diskOf = %q, want %q", got, tc.want)
			}
		})
	}
}

// TEST_SCENARIO: The feed's payload is a wake-up, and its lane is the design's:
// TEST_SCENARIO: activity, definitions, hosts and grants are urgent because a wake is exactly
// TEST_SCENARIO: an activity bump; the controller's own observations are its own echo.
func TestParseNotify(t *testing.T) {
	cases := []struct {
		payload string
		ok      bool
		event   Notify
	}{
		{`{"t":"agents","op":"U","id":"a"}`, true, Notify{Name: "a", Table: "agents", Urgent: true}},
		{`{"t":"agent_signals","op":"U","id":"a","hot":true}`, true, Notify{Name: "a", Table: "agent_signals", Urgent: true}},
		{`{"t":"agent_status","op":"U","id":"a"}`, true, Notify{Name: "a", Table: "agent_status"}},
		{`{"t":"agent_conditions","op":"U","id":"a"}`, true, Notify{Name: "a", Table: "agent_conditions"}},
		{`{"t":"agents","op":"D","id":"a"}`, true, Notify{Name: "a", Table: "agents", Delete: true, Urgent: true}},
		{`{"t":"user_budgets","op":"U"}`, true, Notify{Table: "user_budgets"}},
		{`not json`, false, Notify{}},
		{`{"op":"U","id":"a"}`, false, Notify{}},
	}
	for _, tc := range cases {
		event, ok := parseNotify([]byte(tc.payload))
		if ok != tc.ok {
			t.Fatalf("%s: ok = %v", tc.payload, ok)
		}
		if ok && (event.Name != tc.event.Name || event.Table != tc.event.Table ||
			event.Urgent != tc.event.Urgent || event.Delete != tc.event.Delete) {
			t.Fatalf("%s: event = %+v, want %+v", tc.payload, event, tc.event)
		}
	}
}

func mustMap(t *testing.T, object map[string]any, name string) map[string]any {
	t.Helper()
	value, ok := object[name].(map[string]any)
	if !ok {
		t.Fatalf("%s is not a map: %T", name, object[name])
	}
	return value
}
