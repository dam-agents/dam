package store

import (
	"context"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	apimeta "k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
)

// TEST_OVERVIEW: The controller's store on a real PostgreSQL, as the login it
// TEST_OVERVIEW: runs under. The unit suite pins the mapping; what only a real server can show
// TEST_OVERVIEW: is that the granted columns are enough to reconcile an Agent, that the status
// TEST_OVERVIEW: write and the reclaim compare-and-set hold their locks, that the change feed
// TEST_OVERVIEW: delivers a write, and that everything outside the grant is refused.
// TEST_OVERVIEW: Run by `mise run //packages/controller:test:agent-store` against a disposable
// TEST_OVERVIEW: database with this branch's migrations applied and the controller's grants
// TEST_OVERVIEW: made.
func postgresURLs(t *testing.T) (ownerURL, controllerURL string) {
	t.Helper()
	ownerURL = os.Getenv("AGENT_STORE_DATABASE_URL")
	controllerURL = os.Getenv("AGENT_STORE_CONTROLLER_URL")
	if ownerURL == "" || controllerURL == "" {
		t.Skip("AGENT_STORE_DATABASE_URL and AGENT_STORE_CONTROLLER_URL are not set")
	}
	return ownerURL, controllerURL
}

const (
	testNamespace = "platform-agents"
	testAgent     = "store-check"
	testOwner     = "sub-store-check"
)

func mustExec(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

func cleanup(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	mustExec(t, pool, "DELETE FROM control.agents WHERE id = $1", testAgent)
	mustExec(t, pool, "DELETE FROM control.user_budgets WHERE owner_sub = $1", testOwner)
}

func seedAgent(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	cleanup(t, pool)
	mustExec(t, pool, `
		INSERT INTO control.agents
			(id, owner_sub, template_id, image, harness, cpu_limit, memory_limit, disk_size,
			 hibernation_timeout_ns, sweepable, generation, created_at)
		VALUES ($1, $2, 'tpl', 'agent:1', 'claude-code', '2', '4Gi', '30Gi', 5400000000000, true, 7, now())`,
		testAgent, testOwner)
	mustExec(t, pool, `
		INSERT INTO control.agent_signals
			(agent_id, version, last_activity_at, last_activity_token, session_pinned, roll_rev)
		VALUES ($1, 11, now() - interval '2 hours', gen_random_uuid(), true, 'rev-1')`, testAgent)
	mustExec(t, pool, `
		INSERT INTO control.agent_status
			(agent_id, observed_generation, machine_restarts, machine_up_at)
		VALUES ($1, 7, 2, now() - interval '1 hour')`, testAgent)
	mustExec(t, pool, `
		INSERT INTO control.agent_conditions
			(agent_id, type, status, reason, observed_generation, last_transition_at)
		VALUES ($1, 'Ready', 'True', 'AllPodsReady', 7, now() - interval '1 hour')`, testAgent)
	mustExec(t, pool, `INSERT INTO control.agent_l7_hosts (agent_id, host) VALUES ($1, 'a.test'), ($1, 'b.test')`, testAgent)
	// UNIT_BOUNDARY_DESCRIPTION: A host insert advances the definition's generation, so the source value
	// UNIT_BOUNDARY_DESCRIPTION: is restored the way the absorb sets it after its children are in.
	mustExec(t, pool, `UPDATE control.agents SET generation = 7 WHERE id = $1`, testAgent)
	mustExec(t, pool, `INSERT INTO control.user_budgets (owner_sub, cpu, memory) VALUES ($1, '8', '16Gi')`, testOwner)
	mustExec(t, pool, `INSERT INTO control.agent_store (id, absorbed_at) VALUES (1, now()) ON CONFLICT (id) DO UPDATE SET absorbed_at = now()`)
}

func openAs(t *testing.T, url string) (*Store, *pgxpool.Pool) {
	t.Helper()
	s, err := Open(context.Background(), url, testNamespace)
	if err != nil {
		t.Fatalf("opening the store as the controller: %v", err)
	}
	t.Cleanup(s.Close)
	pool, err := pgxpool.New(context.Background(), url)
	if err != nil {
		t.Fatalf("opening the raw pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return s, pool
}

func TestPostgresStoreReadsAndWrites(t *testing.T) {
	ownerURL, controllerURL := postgresURLs(t)
	owner, err := pgxpool.New(context.Background(), ownerURL)
	if err != nil {
		t.Fatalf("connecting as the owner: %v", err)
	}
	t.Cleanup(func() { owner.Close() })
	seedAgent(t, owner)
	t.Cleanup(func() { cleanup(t, owner) })

	s, _ := openAs(t, controllerURL)
	ctx := context.Background()
	if err := s.Healthy(); err == nil {
		t.Fatal("a store that has not listed reported itself healthy")
	}
	if _, _, err := s.relist(ctx); err != nil {
		t.Fatalf("relisting: %v", err)
	}
	if err := s.Healthy(); err != nil {
		t.Fatalf("a listed store is not healthy: %v", err)
	}

	agent, err := s.Get(ctx, testAgent)
	if err != nil {
		t.Fatalf("reading the Agent: %v", err)
	}
	if agent.GetLabels()[labelOwner] != testOwner {
		t.Fatalf("owner label = %q", agent.GetLabels()[labelOwner])
	}
	if types.UID(agent.GetUID()) == "" {
		t.Fatal("the incarnation is not the object's uid")
	}
	if agent.GetGeneration() != 7 {
		t.Fatalf("generation = %d", agent.GetGeneration())
	}
	if got := agent.GetResourceVersion(); got != "11" {
		t.Fatalf("resourceVersion = %q, want the signals version 11", got)
	}
	if got := agent.GetAnnotations()[annLastActivity]; got == "" {
		t.Fatal("the activity stamp is missing")
	}
	if agent.GetAnnotations()[annReclaimedAt] != "" {
		t.Fatal("a reclaim mark without its token was published")
	}
	spec, _, _ := unstructured.NestedMap(agent.Object, "spec")
	if spec["image"] != "agent:1" || spec["storageSize"] != "30Gi" || spec["hibernationTimeout"] != "1h30m0s" {
		t.Fatalf("spec = %v", spec)
	}
	if hosts, _, _ := unstructured.NestedStringSlice(agent.Object, "spec", "l7Hosts"); len(hosts) != 2 {
		t.Fatalf("hosts = %v", hosts)
	}
	status, err := statusOf(t, agent)
	if err != nil {
		t.Fatalf("decoding status: %v", err)
	}
	if status.ObservedGeneration != 7 || status.AgentPodRestarts != 2 || len(status.Conditions) != 1 {
		t.Fatalf("status = %+v", status)
	}

	// TEST_SCENARIO: The status write takes the locks and keeps the observation
	// TEST_SCENARIO: columns the reconciler never mutates.
	machineUp := agent.GetAnnotations()[annMachineUp]
	if err := s.UpdateStatus(ctx, testAgent, func(status *apiv1.AgentStatus) {
		status.ObservedGeneration = 8
		status.AgentPodRestarts = 3
		setCondition(status, apiv1.ConditionReady, metav1.ConditionFalse, "PodsNotReady")
	}); err != nil {
		t.Fatalf("writing status: %v", err)
	}
	written, err := s.Get(ctx, testAgent)
	if err != nil {
		t.Fatalf("reading the written Agent: %v", err)
	}
	writtenStatus, err := statusOf(t, written)
	if err != nil {
		t.Fatalf("decoding the written status: %v", err)
	}
	if writtenStatus.ObservedGeneration != 8 || writtenStatus.AgentPodRestarts != 3 {
		t.Fatalf("the status write did not land: %+v", writtenStatus)
	}
	if conditionReason(writtenStatus.Conditions, apiv1.ConditionReady) != "PodsNotReady" {
		t.Fatalf("the condition write did not land: %+v", writtenStatus.Conditions)
	}
	if written.GetAnnotations()[annMachineUp] != machineUp {
		t.Fatal("a status write moved the machine stamp it never set")
	}
	var version, observedSignals int64
	if err := owner.QueryRow(ctx, "SELECT version, observed_signal_version FROM control.agent_status WHERE agent_id = $1", testAgent).
		Scan(&version, &observedSignals); err != nil {
		t.Fatalf("reading the status version: %v", err)
	}
	if version == 0 || observedSignals != 11 {
		t.Fatalf("status version %d, observed signals %d", version, observedSignals)
	}

	// TEST_SCENARIO: The machine marks are status columns written through the
	// TEST_SCENARIO: annotation vocabulary, and a patch leaves the rest of the row alone.
	down := time.Now().UTC().Format(time.RFC3339Nano)
	if err := s.PatchAgent(ctx, testAgent, map[string]*string{annMachineDown: &down}); err != nil {
		t.Fatalf("stamping the machine: %v", err)
	}
	patched, err := s.Get(ctx, testAgent)
	if err != nil {
		t.Fatalf("reading the stamped Agent: %v", err)
	}
	if patched.GetAnnotations()[annMachineDown] == "" {
		t.Fatal("the machine stamp did not land")
	}
	if patched.GetAnnotations()[annMachineUp] != machineUp {
		t.Fatal("a patch cleared a stamp it did not name")
	}

	// TEST_SCENARIO: A reclaim spends the activity it read, and only when the
	// TEST_SCENARIO: signals row is still the version the decision came from.
	stamp := time.Now().UTC().Format(time.RFC3339Nano)
	if err := s.StampReclaim(ctx, testAgent, stamp, "11"); err != nil {
		t.Fatalf("stamping the reclaim: %v", err)
	}
	var reclaimed, tokenMatch bool
	if err := owner.QueryRow(ctx, `
		SELECT reclaimed_at IS NOT NULL, reclaimed_activity_token = last_activity_token
		  FROM control.agent_signals WHERE agent_id = $1`, testAgent).Scan(&reclaimed, &tokenMatch); err != nil {
		t.Fatalf("reading the reclaim: %v", err)
	}
	if !reclaimed || !tokenMatch {
		t.Fatalf("reclaimed=%v token=%v", reclaimed, tokenMatch)
	}
	var currentVersion int64
	if err := owner.QueryRow(ctx, "SELECT version FROM control.agent_signals WHERE agent_id = $1", testAgent).Scan(&currentVersion); err != nil {
		t.Fatalf("reading the signals version: %v", err)
	}
	if err := s.StampReclaim(ctx, testAgent, stamp, "11"); !apierrors.IsConflict(err) {
		t.Fatalf("a stale reclaim version answered %v, want a conflict", err)
	}

	// TEST_SCENARIO: The mark retires with the activity it was stamped for.
	if err := s.UpdateStatus(ctx, testAgent, func(status *apiv1.AgentStatus) {}); err != nil {
		t.Fatalf("a no-op status write: %v", err)
	}
	if _, err := owner.Exec(ctx, "UPDATE control.agent_signals SET last_activity_token = gen_random_uuid() WHERE agent_id = $1", testAgent); err != nil {
		t.Fatalf("rotating the token: %v", err)
	}
	rotated, err := s.Get(ctx, testAgent)
	if err != nil {
		t.Fatalf("reading the rotated Agent: %v", err)
	}
	if rotated.GetAnnotations()[annReclaimedAt] != "" {
		t.Fatal("the reclaim mark outlived the activity it was stamped for")
	}

	budget, err := s.GetBudget(ctx, testOwner)
	if err != nil {
		t.Fatalf("reading the budget: %v", err)
	}
	if budgetSpec, _, _ := unstructured.NestedMap(budget.Object, "spec"); budgetSpec["cpu"] != "8" || budgetSpec["memory"] != "16Gi" {
		t.Fatalf("budget spec = %v", budgetSpec)
	}
	if _, err := s.GetBudget(ctx, "sub-nobody"); !apierrors.IsNotFound(err) {
		t.Fatalf("a missing budget answered %v", err)
	}

	if err := s.RecordAnchorsEnsured(ctx, "pod-0"); err != nil {
		t.Fatalf("recording the anchor pass: %v", err)
	}
	var holder string
	if err := owner.QueryRow(ctx, "SELECT controller_holder FROM control.agent_store WHERE id = 1").Scan(&holder); err != nil || holder != "pod-0" {
		t.Fatalf("holder = %q, err = %v", holder, err)
	}

	items, err := s.Lister().ByNamespace(testNamespace).List(labels.SelectorFromSet(labels.Set{labelOwner: testOwner}))
	if err != nil || len(items) != 1 {
		t.Fatalf("the lister answered %d agents, err = %v", len(items), err)
	}
}

// TEST_SCENARIO: A real LISTEN delivers what an owner writes, and the store's
// TEST_SCENARIO: own write is answered from the row rather than from the next relist.
func TestPostgresStoreFeed(t *testing.T) {
	ownerURL, controllerURL := postgresURLs(t)
	owner, err := pgxpool.New(context.Background(), ownerURL)
	if err != nil {
		t.Fatalf("connecting as the owner: %v", err)
	}
	t.Cleanup(func() { owner.Close() })
	cleanup(t, owner)
	t.Cleanup(func() { cleanup(t, owner) })

	s, _ := openAs(t, controllerURL)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events := make(chan Notify, 32)
	go s.Run(ctx, func(event Notify) { events <- event })
	deadline := time.Now().Add(20 * time.Second)
	for !s.Synced() && time.Now().Before(deadline) {
		time.Sleep(50 * time.Millisecond)
	}
	if !s.Synced() {
		t.Fatal("the store never listed")
	}
	// UNIT_BOUNDARY_DESCRIPTION: The queue is drained of the startup list, so the next event is the write.
	for len(events) > 0 {
		<-events
	}

	waitFor := func(match func(Notify) bool) Notify {
		t.Helper()
		deadline := time.After(20 * time.Second)
		for {
			select {
			case event := <-events:
				if match(event) {
					return event
				}
			case <-deadline:
				t.Fatal("the change feed delivered nothing that matched")
			}
		}
	}

	// TEST_SCENARIO: A create is urgent, and the controller's own status write is
	// TEST_SCENARIO: not.
	mustExec(t, owner, `
		INSERT INTO control.agents (id, owner_sub, image, cpu_limit, memory_limit)
		VALUES ($1, $2, 'agent:1', '1', '2Gi')`, testAgent, testOwner)
	mustExec(t, owner, `INSERT INTO control.agent_signals (agent_id) VALUES ($1)`, testAgent)
	created := waitFor(func(event Notify) bool { return event.Name == testAgent && event.Table == "agents" })
	if !created.Urgent || created.Delete {
		t.Fatalf("a create arrived as %+v", created)
	}
	mustExec(t, owner, `INSERT INTO control.agent_l7_hosts (agent_id, host) VALUES ($1, 'gone.test')`, testAgent)
	waitFor(func(event Notify) bool {
		return event.Name == testAgent && event.Table == "agent_l7_hosts" && !event.Delete
	})
	mustExec(t, owner, `DELETE FROM control.agent_l7_hosts WHERE agent_id = $1`, testAgent)
	// TEST_SCENARIO: A child row's delete is not the Agent's. Every host is deleted and re-inserted on a spec
	// TEST_SCENARIO: write, and a recovered condition is dropped; reading either as a delete took a live Agent
	// TEST_SCENARIO: out of the cache and handed it to the delete worker for nothing.
	hostDeleted := waitFor(func(event Notify) bool {
		return event.Name == testAgent && event.Table == "agent_l7_hosts" && !event.Delete
	})
	if hostDeleted.Delete {
		t.Fatal("a child row's delete arrived as the Agent's delete")
	}
	if _, err := s.Lister().ByNamespace(testNamespace).Get(testAgent); err != nil {
		t.Fatalf("a child row's delete removed the live Agent from the cache: %v", err)
	}
	if err := s.UpdateStatus(ctx, testAgent, func(status *apiv1.AgentStatus) { status.ObservedGeneration = 1 }); err != nil {
		t.Fatalf("writing status: %v", err)
	}
	echo := waitFor(func(event Notify) bool { return event.Name == testAgent && event.Table == "agent_status" })
	if echo.Urgent {
		t.Fatalf("the controller's own status write arrived urgent: %+v", echo)
	}
	mustExec(t, owner, `DELETE FROM control.agents WHERE id = $1`, testAgent)
	gone := waitFor(func(event Notify) bool { return event.Name == testAgent && event.Delete })
	if gone.Name != testAgent {
		t.Fatalf("a delete arrived as %+v", gone)
	}
}

// TEST_SCENARIO: The grant is the boundary, not the code: every statement the
// TEST_SCENARIO: controller's login must not issue is refused by the server.
func TestPostgresStoreGrants(t *testing.T) {
	ownerURL, controllerURL := postgresURLs(t)
	owner, err := pgxpool.New(context.Background(), ownerURL)
	if err != nil {
		t.Fatalf("connecting as the owner: %v", err)
	}
	t.Cleanup(func() { owner.Close() })
	seedAgent(t, owner)
	t.Cleanup(func() { cleanup(t, owner) })

	_, controller := openAs(t, controllerURL)
	ctx := context.Background()
	refusals := []struct {
		name string
		sql  string
	}{
		{"a definition's withheld column", "SELECT description FROM control.agents"},
		{"a definition update", "UPDATE control.agents SET image = 'other'"},
		{"a signals update outside the reclaim columns", "UPDATE control.agent_signals SET session_pinned = true"},
		{"the kit bookkeeping", "SELECT count(*) FROM control.agent_kit_state"},
		{"the snapshot archive", "SELECT count(*) FROM control.crd_snapshots"},
		{"the usage mirror", "SELECT count(*) FROM public.agents"},
		{"the connection itself", "SELECT count(*) FROM public.connections"},
		{"the absorb report", "SELECT absorb_report FROM control.agent_store"},
		{"the absorb stamp", "UPDATE control.agent_store SET absorbed_at = now()"},
	}
	for _, refusal := range refusals {
		if _, err := controller.Exec(ctx, refusal.sql); err == nil {
			t.Fatalf("the controller's login could run: %s", refusal.name)
		}
	}
}

func statusOf(t *testing.T, agent *unstructured.Unstructured) (apiv1.AgentStatus, error) {
	t.Helper()
	var status apiv1.AgentStatus
	raw, found, err := unstructured.NestedMap(agent.Object, "status")
	if err != nil || !found {
		return status, err
	}
	return status, runtime.DefaultUnstructuredConverter.FromUnstructured(raw, &status)
}

func setCondition(status *apiv1.AgentStatus, condType string, value metav1.ConditionStatus, reason string) {
	apimeta.SetStatusCondition(&status.Conditions, metav1.Condition{
		Type: condType, Status: value, Reason: reason, ObservedGeneration: 8,
	})
}

func conditionReason(conditions []metav1.Condition, condType string) string {
	for _, condition := range conditions {
		if condition.Type == condType {
			return condition.Reason
		}
	}
	return ""
}

// TEST_SCENARIO: The absorb stamp is the database's half of the fence. A store with none, or with another
// TEST_SCENARIO: install's, is a database the sweeps must not read as an empty fleet.
func TestPostgresStoreAbsorbed(t *testing.T) {
	ownerURL, controllerURL := postgresURLs(t)
	owner, err := pgxpool.New(context.Background(), ownerURL)
	if err != nil {
		t.Fatalf("connecting as the owner: %v", err)
	}
	t.Cleanup(func() { owner.Close() })
	seedAgent(t, owner)
	t.Cleanup(func() { cleanup(t, owner) })
	controller, _ := openAs(t, controllerURL)
	ctx := context.Background()
	if _, _, err := controller.relist(ctx); err != nil {
		t.Fatalf("relisting: %v", err)
	}

	at, ok, err := controller.AbsorbedAt(ctx)
	if err != nil || !ok {
		t.Fatalf("absorbed at %v, ok %v, err %v", at, ok, err)
	}
	if err := controller.AssertAbsorbed(ctx, at.UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("the database refused its own absorb stamp: %v", err)
	}
	if err := controller.AssertAbsorbed(ctx, time.Now().Add(-time.Hour).UTC().Format(time.RFC3339Nano)); err == nil {
		t.Fatal("a database absorbed at another time was accepted")
	}
	mustExec(t, owner, "UPDATE control.agent_store SET absorbed_at = NULL WHERE id = 1")
	if err := controller.AssertAbsorbed(ctx, at.UTC().Format(time.RFC3339Nano)); err == nil {
		t.Fatal("an unabsorbed database was accepted")
	}
	if err := controller.Healthy(); err != nil {
		t.Fatalf("the store stopped answering: %v", err)
	}
	mustExec(t, owner, "UPDATE control.agent_store SET absorbed_at = now() WHERE id = 1")
}

// TEST_SCENARIO: A brand-new Agent has no status row, so the first observation locks nothing unless the row
// TEST_SCENARIO: is created first. A machine stamp committed in that window was overwritten by the columns
// TEST_SCENARIO: the status write had read as absent.
func TestPostgresFirstStatusWriteKeepsAConcurrentStamp(t *testing.T) {
	ownerURL, controllerURL := postgresURLs(t)
	owner, err := pgxpool.New(context.Background(), ownerURL)
	if err != nil {
		t.Fatalf("connecting as the owner: %v", err)
	}
	t.Cleanup(func() { owner.Close() })
	t.Cleanup(func() { cleanup(t, owner) })
	controller, _ := openAs(t, controllerURL)
	ctx := context.Background()

	for round := 0; round < 25; round++ {
		cleanup(t, owner)
		mustExec(t, owner, `
			INSERT INTO control.agents (id, owner_sub, image, cpu_limit, memory_limit)
			VALUES ($1, $2, 'agent:1', '1', '2Gi')`, testAgent, testOwner)
		mustExec(t, owner, `INSERT INTO control.agent_signals (agent_id) VALUES ($1)`, testAgent)
		down := time.Now().UTC().Format(time.RFC3339Nano)
		errs := make(chan error, 2)
		go func() { errs <- controller.PatchAgent(ctx, testAgent, map[string]*string{annMachineDown: &down}) }()
		go func() {
			errs <- controller.UpdateStatus(ctx, testAgent, func(status *apiv1.AgentStatus) {
				status.ObservedGeneration = 3
				setCondition(status, apiv1.ConditionReady, metav1.ConditionTrue, "AllPodsReady")
			})
		}()
		for i := 0; i < 2; i++ {
			if err := <-errs; err != nil {
				t.Fatalf("round %d: %v", round, err)
			}
		}
		agent, err := controller.Get(ctx, testAgent)
		if err != nil {
			t.Fatalf("round %d: %v", round, err)
		}
		if agent.GetAnnotations()[annMachineDown] == "" {
			t.Fatalf("round %d: the machine stamp was overwritten by the first status write", round)
		}
		status, err := statusOf(t, agent)
		if err != nil || conditionReason(status.Conditions, apiv1.ConditionReady) != "AllPodsReady" {
			t.Fatalf("round %d: the condition did not land: %+v, %v", round, status.Conditions, err)
		}
	}
}

// TEST_SCENARIO: The api-server's definition write and the controller's first status transaction, interleaved.
// TEST_SCENARIO: The controller holds the signals row shared and inserts a row whose foreign key takes a
// TEST_SCENARIO: key-share lock on the definition; the api-server holds the definition and waits for the
// TEST_SCENARIO: signals row. A definition lock of FOR UPDATE is a deadlock the api-server loses; FOR NO KEY
// TEST_SCENARIO: UPDATE is compatible, and both commit.
func TestPostgresInterleavedWritersDoNotDeadlock(t *testing.T) {
	ownerURL, controllerURL := postgresURLs(t)
	owner, err := pgxpool.New(context.Background(), ownerURL)
	if err != nil {
		t.Fatalf("connecting as the owner: %v", err)
	}
	t.Cleanup(func() { owner.Close() })
	seedAgent(t, owner)
	t.Cleanup(func() { cleanup(t, owner) })
	controller, _ := openAs(t, controllerURL)
	ctx := context.Background()

	type result struct {
		name string
		err  error
	}
	done := make(chan result, 2)
	// UNIT_BOUNDARY_DESCRIPTION: The controller holds signals and status while its mutate runs, exactly as a real observation does.
	go func() {
		done <- result{"the controller's status write", controller.UpdateStatus(ctx, testAgent, func(status *apiv1.AgentStatus) {
			time.Sleep(250 * time.Millisecond)
			setCondition(status, apiv1.ConditionReconciled, metav1.ConditionTrue, "Reconciled")
		})}
	}()
	time.Sleep(100 * time.Millisecond)
	go func() {
		// UNIT_BOUNDARY_DESCRIPTION: The api-server's definition write: agents FOR NO KEY UPDATE, then signals FOR UPDATE.
		tx, err := owner.Begin(ctx)
		if err != nil {
			done <- result{"the api-server's transaction", err}
			return
		}
		defer func() { _ = tx.Rollback(context.Background()) }()
		if _, err := tx.Exec(ctx, "SELECT 1 FROM control.agents WHERE id = $1 FOR NO KEY UPDATE", testAgent); err != nil {
			done <- result{"the api-server's definition lock", err}
			return
		}
		if _, err := tx.Exec(ctx, "SELECT 1 FROM control.agent_signals WHERE agent_id = $1 FOR UPDATE", testAgent); err != nil {
			done <- result{"the api-server's signals lock", err}
			return
		}
		if _, err := tx.Exec(ctx, "UPDATE control.agents SET name = 'interleaved' WHERE id = $1", testAgent); err != nil {
			done <- result{"the api-server's definition update", err}
			return
		}
		done <- result{"the api-server's transaction", tx.Commit(ctx)}
	}()

	deadline := time.After(10 * time.Second)
	for i := 0; i < 2; i++ {
		select {
		case got := <-done:
			if got.err != nil {
				t.Fatalf("%s: %v", got.name, got.err)
			}
		case <-deadline:
			t.Fatal("the interleaved writers deadlocked")
		}
	}
}

// TEST_SCENARIO: An Agent re-created under the same name during a gap between relists is a different Agent.
// TEST_SCENARIO: The relist reports the old one's deletion as well as the change, so its children are
// TEST_SCENARIO: collected and the new incarnation is not mistaken for the old.
func TestPostgresRelistSeesAnIncarnationChange(t *testing.T) {
	ownerURL, controllerURL := postgresURLs(t)
	owner, err := pgxpool.New(context.Background(), ownerURL)
	if err != nil {
		t.Fatalf("connecting as the owner: %v", err)
	}
	t.Cleanup(func() { owner.Close() })
	seedAgent(t, owner)
	t.Cleanup(func() { cleanup(t, owner) })
	s, _ := openAs(t, controllerURL)
	ctx := context.Background()
	if _, _, err := s.relist(ctx); err != nil {
		t.Fatalf("relisting: %v", err)
	}
	mustExec(t, owner, "DELETE FROM control.agents WHERE id = $1", testAgent)
	mustExec(t, owner, `
		INSERT INTO control.agents (id, owner_sub, image, cpu_limit, memory_limit)
		VALUES ($1, $2, 'agent:2', '1', '2Gi')`, testAgent, testOwner)
	changed, deleted, err := s.relist(ctx)
	if err != nil {
		t.Fatalf("relisting: %v", err)
	}
	if !slices.Contains(deleted, testAgent) || !slices.Contains(changed, testAgent) {
		t.Fatalf("changed %v, deleted %v", changed, deleted)
	}
}
