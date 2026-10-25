package store

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	apiequality "k8s.io/apimachinery/pkg/api/equality"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
)

// UNIT_BOUNDARY_DESCRIPTION: statusRow is the observation row that is not part of what the reconciler
// UNIT_BOUNDARY_DESCRIPTION: mutates: the machine stamps and the OOM bookkeeping ride annotations on the
// UNIT_BOUNDARY_DESCRIPTION: object and columns here, and a status write must leave them exactly as it
// UNIT_BOUNDARY_DESCRIPTION: read them.
type statusRow struct {
	observedGeneration   int64
	machineRestarts      int32
	machineRestartReason *string
	machineUpAt          *time.Time
	machineDownAt        *time.Time
	memoryWaitUntil      *time.Time
	runnerOOMKillID      *string
	runnerOOMRecoveredID *string
}

// UNIT_BOUNDARY_DESCRIPTION: UpdateStatus writes one Agent's observations. It takes the signals row
// UNIT_BOUNDARY_DESCRIPTION: shared first, so a definition or lifecycle change that must not race the
// UNIT_BOUNDARY_DESCRIPTION: decision is serialized with it, and the status row exclusively, so two
// UNIT_BOUNDARY_DESCRIPTION: controller paths that observe the same Agent apply their mutations in order.
// UNIT_BOUNDARY_DESCRIPTION: The signals version the transaction saw is recorded as the row's
// UNIT_BOUNDARY_DESCRIPTION: observed_signal_version: the observations describe the definition and signals
// UNIT_BOUNDARY_DESCRIPTION: as of that version.
func (s *Store) UpdateStatus(ctx context.Context, name string, mutate func(*apiv1.AgentStatus)) error {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("writing Agent status: %w", err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()

	signalsVersion, err := lockSignals(ctx, tx, name)
	if err != nil {
		return err
	}
	// UNIT_BOUNDARY_DESCRIPTION: the status row is created before it is locked, so a first observation takes
	// UNIT_BOUNDARY_DESCRIPTION: the row's lock the way every later one does. With no row, FOR UPDATE locks
	// UNIT_BOUNDARY_DESCRIPTION: nothing, and a concurrent stamp that commits between the read and the upsert
	// UNIT_BOUNDARY_DESCRIPTION: is overwritten by the columns this transaction read as absent.
	if err := ensureStatus(ctx, tx, name); err != nil {
		return err
	}
	row, current, err := lockStatus(ctx, tx, name)
	if err != nil {
		return err
	}
	desired := *current.DeepCopy()
	mutate(&desired)
	if apiequality.Semantic.DeepEqual(current, desired) {
		return nil
	}
	if err := writeStatus(ctx, tx, name, signalsVersion, row, desired); err != nil {
		return err
	}
	if err := writeConditions(ctx, tx, name, desired.Conditions); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// UNIT_BOUNDARY_DESCRIPTION: PatchAgent applies the controller's own stamps: the two machine marks, the
// UNIT_BOUNDARY_DESCRIPTION: memory-reclaim deadline and the OOM bookkeeping. They live in the status row,
// UNIT_BOUNDARY_DESCRIPTION: so this takes the same shared signals lock and the same exclusive status lock
// UNIT_BOUNDARY_DESCRIPTION: as any other observation write.
func (s *Store) PatchAgent(ctx context.Context, name string, ann map[string]*string) error {
	if len(ann) == 0 {
		return nil
	}
	type patch struct {
		column string
		value  any
	}
	patches := make([]patch, 0, len(ann))
	for key, value := range ann {
		switch key {
		case annMachineUp, annMachineDown, annMemoryWaitUntil:
			at, err := stampTime(value)
			if err != nil {
				return fmt.Errorf("%s on agent %s: %w", key, name, err)
			}
			patches = append(patches, patch{column: columnOf(key), value: at})
		case annRunnerOOMKill, annRunnerOOMDone:
			patches = append(patches, patch{column: columnOf(key), value: value})
		default:
			return fmt.Errorf("agent %s: %s is not a controller-written annotation", name, key)
		}
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("stamping agent %s: %w", name, err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	if _, err := lockSignals(ctx, tx, name); err != nil {
		return err
	}
	// UNIT_BOUNDARY_DESCRIPTION: The row must exist for the UPDATE below to land; a patch on an Agent that
	// UNIT_BOUNDARY_DESCRIPTION: no reconcile has observed yet creates the empty row first.
	if err := ensureStatus(ctx, tx, name); err != nil {
		return err
	}
	for _, p := range patches {
		if _, err := tx.Exec(ctx,
			fmt.Sprintf("UPDATE control.agent_status SET %s = $2, updated_at = now() WHERE agent_id = $1", p.column),
			name, p.value); err != nil {
			return fmt.Errorf("stamping agent %s: %w", name, err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("stamping agent %s: %w", name, err)
	}
	return nil
}

func columnOf(key string) string {
	switch key {
	case annMachineUp:
		return "machine_up_at"
	case annMachineDown:
		return "machine_down_at"
	case annMemoryWaitUntil:
		return "memory_wait_until"
	case annRunnerOOMKill:
		return "runner_oom_kill_id"
	default:
		return "runner_oom_recovered_id"
	}
}

func stampTime(value *string) (any, error) {
	if value == nil || *value == "" {
		return nil, nil
	}
	at, err := time.Parse(time.RFC3339Nano, *value)
	if err != nil {
		return nil, err
	}
	return at, nil
}

// UNIT_BOUNDARY_DESCRIPTION: StampReclaim marks the activity window the controller is about to sleep as
// UNIT_BOUNDARY_DESCRIPTION: spent, and only while the signals row is the version the decision read: a
// UNIT_BOUNDARY_DESCRIPTION: wake, a pin, a disable or a definition change that landed in between moved
// UNIT_BOUNDARY_DESCRIPTION: it, and the top-up would otherwise spend an activity somebody just made.
func (s *Store) StampReclaim(ctx context.Context, name, stamp, revision string) error {
	version, err := strconv.ParseInt(revision, 10, 64)
	if err != nil {
		return apierrors.NewConflict(agentsResource, name, fmt.Errorf("the Agent's signals version %q is not a number", revision))
	}
	at, err := time.Parse(time.RFC3339Nano, stamp)
	if err != nil {
		return fmt.Errorf("stamping %s on agent %s: %w", annReclaimedAt, name, err)
	}
	tag, err := s.pool.Exec(ctx, `
		UPDATE control.agent_signals
		   SET reclaimed_at = $2, reclaimed_activity_token = last_activity_token
		 WHERE agent_id = $1 AND version = $3 AND last_activity_token IS NOT NULL`,
		name, at, version)
	if err != nil {
		return fmt.Errorf("stamping %s on agent %s: %w", annReclaimedAt, name, err)
	}
	if tag.RowsAffected() == 0 {
		var exists bool
		if err := s.pool.QueryRow(ctx,
			"SELECT EXISTS (SELECT 1 FROM control.agent_signals WHERE agent_id = $1)", name).Scan(&exists); err != nil {
			return fmt.Errorf("stamping %s on agent %s: %w", annReclaimedAt, name, err)
		}
		if !exists {
			return apierrors.NewNotFound(agentsResource, name)
		}
		return apierrors.NewConflict(agentsResource, name,
			errors.New("the Agent's activity moved while its reclaim was being decided"))
	}
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: GetBudget is the owner's pool, in the shape the reconciler's custom-resource
// UNIT_BOUNDARY_DESCRIPTION: read produced. A missing row is a missing budget, which means the install's
// UNIT_BOUNDARY_DESCRIPTION: values apply field by field.
func (s *Store) GetBudget(ctx context.Context, owner string) (*unstructured.Unstructured, error) {
	var cpu, memory, storage *string
	err := s.pool.QueryRow(ctx,
		`SELECT cpu, memory, storage FROM control.user_budgets WHERE owner_sub = $1`, owner).
		Scan(&cpu, &memory, &storage)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, apierrors.NewNotFound(apiv1.GroupVersion.WithResource("userbudgets").GroupResource(), "budget-"+owner)
	}
	if err != nil {
		return nil, fmt.Errorf("reading the budget of %s: %w", owner, err)
	}
	spec := map[string]any{}
	putSpec(spec, "cpu", cpu)
	putSpec(spec, "memory", memory)
	putSpec(spec, "storage", storage)
	return &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": apiv1.GroupVersion.String(),
		"kind":       "UserBudget",
		"metadata":   map[string]any{"name": "budget-" + owner, "namespace": s.namespace},
		"spec":       spec,
	}}, nil
}

func lockSignals(ctx context.Context, tx pgx.Tx, name string) (int64, error) {
	var version int64
	err := tx.QueryRow(ctx,
		"SELECT version FROM control.agent_signals WHERE agent_id = $1 FOR SHARE", name).Scan(&version)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, apierrors.NewNotFound(agentsResource, name)
	}
	if err != nil {
		return 0, fmt.Errorf("locking the signals row of %s: %w", name, err)
	}
	return version, nil
}

func lockStatus(ctx context.Context, tx pgx.Tx, name string) (statusRow, *apiv1.AgentStatus, error) {
	var row statusRow
	err := tx.QueryRow(ctx, `
		SELECT observed_generation, machine_restarts, machine_restart_reason,
		       machine_up_at, machine_down_at, memory_wait_until,
		       runner_oom_kill_id, runner_oom_recovered_id
		  FROM control.agent_status WHERE agent_id = $1 FOR UPDATE`, name).
		Scan(&row.observedGeneration, &row.machineRestarts, &row.machineRestartReason,
			&row.machineUpAt, &row.machineDownAt, &row.memoryWaitUntil,
			&row.runnerOOMKillID, &row.runnerOOMRecoveredID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return row, nil, fmt.Errorf("locking the status row of %s: %w", name, err)
	}
	current := &apiv1.AgentStatus{
		ObservedGeneration:    row.observedGeneration,
		AgentPodRestarts:      row.machineRestarts,
		Conditions:            nil,
		AgentPodRestartReason: "",
	}
	if row.machineRestartReason != nil {
		current.AgentPodRestartReason = *row.machineRestartReason
	}
	rows, err := tx.Query(ctx, `
		SELECT type, status, reason, message, observed_generation, last_transition_at
		  FROM control.agent_conditions WHERE agent_id = $1`, name)
	if err != nil {
		return row, nil, fmt.Errorf("reading the conditions of %s: %w", name, err)
	}
	defer rows.Close()
	for rows.Next() {
		var condition metav1Condition
		if err := rows.Scan(&condition.Type, &condition.Status, &condition.Reason, &condition.Message,
			&condition.ObservedGeneration, &condition.LastTransitionAt); err != nil {
			return row, nil, fmt.Errorf("reading the conditions of %s: %w", name, err)
		}
		current.Conditions = append(current.Conditions, condition.Condition())
	}
	if err := rows.Err(); err != nil {
		return row, nil, fmt.Errorf("reading the conditions of %s: %w", name, err)
	}
	return row, current, nil
}

func ensureStatus(ctx context.Context, tx pgx.Tx, name string) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO control.agent_status (agent_id) VALUES ($1)
		ON CONFLICT (agent_id) DO NOTHING`, name)
	if err != nil {
		return fmt.Errorf("creating the status row of %s: %w", name, err)
	}
	return nil
}

func writeStatus(ctx context.Context, tx pgx.Tx, name string, signalsVersion int64, row statusRow, status apiv1.AgentStatus) error {
	var reason *string
	if status.AgentPodRestartReason != "" {
		reason = &status.AgentPodRestartReason
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO control.agent_status
			(agent_id, observed_generation, observed_signal_version, machine_restarts,
			 machine_restart_reason, machine_up_at, machine_down_at, memory_wait_until,
			 runner_oom_kill_id, runner_oom_recovered_id, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
		ON CONFLICT (agent_id) DO UPDATE SET
			observed_generation = EXCLUDED.observed_generation,
			observed_signal_version = EXCLUDED.observed_signal_version,
			machine_restarts = EXCLUDED.machine_restarts,
			machine_restart_reason = EXCLUDED.machine_restart_reason,
			machine_up_at = EXCLUDED.machine_up_at,
			machine_down_at = EXCLUDED.machine_down_at,
			memory_wait_until = EXCLUDED.memory_wait_until,
			runner_oom_kill_id = EXCLUDED.runner_oom_kill_id,
			runner_oom_recovered_id = EXCLUDED.runner_oom_recovered_id,
			updated_at = now()`,
		name, status.ObservedGeneration, signalsVersion, status.AgentPodRestarts,
		reason, row.machineUpAt, row.machineDownAt, row.memoryWaitUntil,
		row.runnerOOMKillID, row.runnerOOMRecoveredID)
	if err != nil {
		return fmt.Errorf("writing the status of %s: %w", name, err)
	}
	return nil
}

func writeConditions(ctx context.Context, tx pgx.Tx, name string, after []metav1.Condition) error {
	kept := make([]string, 0, len(after))
	for _, condition := range after {
		kept = append(kept, condition.Type)
		if err := upsertCondition(ctx, tx, name, condition); err != nil {
			return err
		}
	}
	var err error
	if len(kept) == 0 {
		_, err = tx.Exec(ctx, "DELETE FROM control.agent_conditions WHERE agent_id = $1", name)
	} else {
		_, err = tx.Exec(ctx,
			"DELETE FROM control.agent_conditions WHERE agent_id = $1 AND type <> ALL($2::text[])", name, kept)
	}
	if err != nil {
		return fmt.Errorf("writing the conditions of %s: %w", name, err)
	}
	return nil
}

func upsertCondition(ctx context.Context, tx pgx.Tx, name string, condition metav1.Condition) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO control.agent_conditions
			(agent_id, type, status, reason, message, observed_generation, last_transition_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (agent_id, type) DO UPDATE SET
			status = EXCLUDED.status,
			reason = EXCLUDED.reason,
			message = EXCLUDED.message,
			observed_generation = EXCLUDED.observed_generation,
			last_transition_at = EXCLUDED.last_transition_at`,
		name, condition.Type, string(condition.Status), condition.Reason, condition.Message,
		condition.ObservedGeneration, condition.LastTransitionTime.UTC())
	if err != nil {
		return fmt.Errorf("writing a condition of %s: %w", name, err)
	}
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: RecordAnchorsEnsured is the controller's half of the switch's barrier: it
// UNIT_BOUNDARY_DESCRIPTION: names the pod that holds the Lease and the moment every Agent's anchor
// UNIT_BOUNDARY_DESCRIPTION: existed. The api-server serves the first Postgres-backed request only once
// UNIT_BOUNDARY_DESCRIPTION: both are recorded, so a deployment's rollout cannot leave an Agent whose
// UNIT_BOUNDARY_DESCRIPTION: children have no owner.
// UNIT_BOUNDARY_DESCRIPTION: AbsorbedAt is the database's half of the switch. A store row with no absorb stamp is a database this cluster has never moved into, and a controller that treated its empty fleet as authoritative would collect every machine on the cluster. The marker's stamp is compared with this one, so a controller cannot be pointed at another install's database.
func (s *Store) AbsorbedAt(ctx context.Context) (time.Time, bool, error) {
	var at *time.Time
	err := s.pool.QueryRow(ctx, "SELECT absorbed_at FROM control.agent_store WHERE id = 1").Scan(&at)
	if errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, false, nil
	}
	if err != nil {
		return time.Time{}, false, fmt.Errorf("reading the store's absorb stamp: %w", err)
	}
	if at == nil {
		return time.Time{}, false, nil
	}
	return *at, true, nil
}

// UNIT_BOUNDARY_DESCRIPTION: AssertAbsorbed refuses a database the marker does not name. An unreadable store is an error, so the caller retries; a readable one with no stamp, or with another stamp, is a refusal.
func (s *Store) AssertAbsorbed(ctx context.Context, expected string) error {
	at, ok, err := s.AbsorbedAt(ctx)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("the database has no absorb stamp: this is not the store the switch filled")
	}
	if expected == "" {
		return errors.New("the store marker carries no absorb stamp")
	}
	if parsed, err := time.Parse(time.RFC3339Nano, expected); err == nil {
		if at.UTC().Truncate(time.Microsecond).Equal(parsed.UTC().Truncate(time.Microsecond)) {
			return nil
		}
	} else if at.UTC().Format(time.RFC3339Nano) == expected {
		return nil
	}
	return fmt.Errorf("the database was absorbed at %s, the marker names %q", at.UTC().Format(time.RFC3339Nano), expected)
}

// UNIT_BOUNDARY_DESCRIPTION: RecordAnchorsEnsured names the pod and the moment: the controller's half of the switch's barrier, written only after every Agent's anchor exists, so the api-server can wait for it before it serves the rows.
func (s *Store) RecordAnchorsEnsured(ctx context.Context, holder string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE control.agent_store
		   SET controller_holder = $1, anchors_ensured_at = now()
		 WHERE id = 1`, holder)
	if err != nil {
		return fmt.Errorf("recording the anchor pass: %w", err)
	}
	return nil
}
