package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	apiequality "k8s.io/apimachinery/pkg/api/equality"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/client-go/tools/cache"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
)

// UNIT_BOUNDARY_DESCRIPTION: how stale the fleet may be before the controller
// UNIT_BOUNDARY_DESCRIPTION: stops deciding. A feed that is down cannot be told apart from a quiet fleet
// UNIT_BOUNDARY_DESCRIPTION: by silence alone, so the relist is the proof of contact: hibernation, reclaim
// UNIT_BOUNDARY_DESCRIPTION: and GC wait for a pass that answered rather than act on a snapshot that may
// UNIT_BOUNDARY_DESCRIPTION: have moved under them.
const contactTimeout = 2 * time.Minute

const relistInterval = 30 * time.Second

var agentsResource = apiv1.GroupVersion.WithResource("agents").GroupResource()

// UNIT_BOUNDARY_DESCRIPTION: Store is the controller's read and write path onto the control schema: the
// UNIT_BOUNDARY_DESCRIPTION: fleet from the definitions and their rows, the observations it writes back,
// UNIT_BOUNDARY_DESCRIPTION: and the change feed that wakes a reconcile.
type Store struct {
	namespace string
	pool      *pgxpool.Pool
	conn      *pgxpool.Config

	mu       sync.RWMutex
	fleet    map[string]*unstructured.Unstructured
	indexer  cache.Indexer
	synced   bool
	contact  time.Time
	feedDown bool
}

// UNIT_BOUNDARY_DESCRIPTION: Open connects, but decides nothing about the fleet until Relist answers. TLS is the driver's: the URL carries sslmode and, when the install sets a CA, sslrootcert, so libpq's own rules apply — require plus a root certificate verifies, and verify-full checks the host name.
func Open(ctx context.Context, url, namespace string) (*Store, error) {
	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("parsing the database URL: %w", err)
	}
	// UNIT_BOUNDARY_DESCRIPTION: The change feed takes a connection of its own, which must not come from a
	// UNIT_BOUNDARY_DESCRIPTION: transaction pooler: LISTEN lives for the life of a session.
	config.MaxConns = 8
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("connecting to the database: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("connecting to the database: %w", err)
	}
	s := &Store{
		namespace: namespace,
		pool:      pool,
		conn:      config,
		fleet:     map[string]*unstructured.Unstructured{},
		indexer:   cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc}),
	}
	return s, nil
}

func (s *Store) Close() {
	s.pool.Close()
}

// UNIT_BOUNDARY_DESCRIPTION: Lister is the agent cache the reconciler reads: the fleet as it last
// UNIT_BOUNDARY_DESCRIPTION: answered, in the object shape the custom resource had.
func (s *Store) Lister() cache.GenericLister {
	return cache.NewGenericLister(s.indexer, agentsResource)
}

func (s *Store) Synced() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.synced
}

// UNIT_BOUNDARY_DESCRIPTION: Ping is the liveness answer, separate from Healthy: a standby replica has no
// UNIT_BOUNDARY_DESCRIPTION: feed and has listed nothing, but its database answering is what makes it able to
// UNIT_BOUNDARY_DESCRIPTION: serve the moment it acquires the Lease.
func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

// UNIT_BOUNDARY_DESCRIPTION: Healthy is the safety gate the decision passes ask: a feed that is down, or
// UNIT_BOUNDARY_DESCRIPTION: a fleet nothing has re-read lately, is no basis for hibernation, reclaim or
// UNIT_BOUNDARY_DESCRIPTION: collection.
func (s *Store) Healthy() error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if !s.synced {
		return errors.New("the Agent store has not listed yet")
	}
	if s.feedDown {
		return errors.New("the Agent store's change feed is down")
	}
	if age := time.Since(s.contact); age > contactTimeout {
		return fmt.Errorf("the Agent store last answered %s ago", age.Round(time.Second))
	}
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: Get reads one Agent live: the reconcile of a victim and a delete both decide
// UNIT_BOUNDARY_DESCRIPTION: from this rather than from the cache.
func (s *Store) Get(ctx context.Context, name string) (*unstructured.Unstructured, error) {
	rows, err := s.read(ctx, name)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, apierrors.NewNotFound(agentsResource, name)
	}
	return hydrate(s.namespace, rows[0].row, rows[0].children), nil
}

// UNIT_BOUNDARY_DESCRIPTION: List reads the fleet live, filtered by the same labels a custom-resource list
// UNIT_BOUNDARY_DESCRIPTION: took.
func (s *Store) List(ctx context.Context, selector labels.Selector) ([]unstructured.Unstructured, error) {
	rows, err := s.read(ctx, "")
	if err != nil {
		return nil, err
	}
	out := make([]unstructured.Unstructured, 0, len(rows))
	for _, row := range rows {
		agent := hydrate(s.namespace, row.row, row.children)
		if !selector.Matches(labels.Set(agent.GetLabels())) {
			continue
		}
		out = append(out, *agent)
	}
	return out, nil
}

// UNIT_BOUNDARY_DESCRIPTION: SpecWritable says whether the controller may still fill an Agent's own spec.
// UNIT_BOUNDARY_DESCRIPTION: It may not once the rows hold it: the api-server, or the absorb, resolved the
// UNIT_BOUNDARY_DESCRIPTION: defaults already, and the controller's definition grant is read-only.
func (s *Store) SpecWritable() bool { return false }

type loadedAgent struct {
	row      agentRow
	children agentChildren
}

const definitionQuery = `
SELECT a.id, a.incarnation::text, a.owner_sub, a.template_id, a.environment_of, a.name,
       a.image, a.harness, a.image_pull_secret_ref, a.secret_ref, a.hibernation_timeout_ns,
       a.nested_virtualization, a.require_connection_address, a.telemetry_attribution_id,
       a.cpu_limit, a.memory_limit, a.disk_size, a.memory_fallback_bytes, a.disk_floor_bytes,
       a.sweepable, a.lifetime_ms, a.generation, a.created_at,
       COALESCE(s.version, 0), s.last_activity_at, s.last_activity_token::text,
       COALESCE(s.session_pinned, false), COALESCE(s.invocation_pinned, false),
       s.stop_requested_at, s.disabled_at, COALESCE(s.roll_rev, ''),
       s.reclaimed_at, s.reclaimed_activity_token::text,
       COALESCE(st.observed_generation, 0), COALESCE(st.machine_restarts, 0),
       st.machine_restart_reason, st.machine_up_at, st.machine_down_at, st.memory_wait_until,
       st.runner_oom_kill_id, st.runner_oom_recovered_id
FROM control.agents a
LEFT JOIN control.agent_signals s ON s.agent_id = a.id
LEFT JOIN control.agent_status st ON st.agent_id = a.id`

// UNIT_BOUNDARY_DESCRIPTION: read loads the definitions with the rows the controller observes them by.
// UNIT_BOUNDARY_DESCRIPTION: An Agent is always written with its signals row, but a reader that cannot
// UNIT_BOUNDARY_DESCRIPTION: see the second yet must not report the first as absent.
func (s *Store) read(ctx context.Context, name string) ([]loadedAgent, error) {
	// UNIT_BOUNDARY_DESCRIPTION: one read is one snapshot. A definition written between the four statements would otherwise be read as half its old spec and half its new children, and a relist built from that is a fleet that never existed.
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, fmt.Errorf("reading Agents: %w", err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	query, args := definitionQuery, []any(nil)
	if name != "" {
		query += " WHERE a.id = $1"
		args = append(args, name)
	}
	query += " ORDER BY a.id"
	rows, err := tx.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("reading Agents: %w", err)
	}
	var loaded []loadedAgent
	for rows.Next() {
		var row agentRow
		if err := rows.Scan(
			&row.ID, &row.Incarnation, &row.OwnerSub, &row.TemplateID, &row.EnvironmentOf, &row.Name,
			&row.Image, &row.Harness, &row.ImagePullSecretRef, &row.SecretRef, &row.HibernationTimeoutNs,
			&row.NestedVirtualization, &row.RequireConnectionAddr, &row.TelemetryAttribution,
			&row.CPULimit, &row.MemoryLimit, &row.DiskSize, &row.MemoryFallbackBytes, &row.DiskFloorBytes,
			&row.Sweepable, &row.LifetimeMs, &row.Generation, &row.CreatedAt,
			&row.SignalVersion, &row.LastActivityAt, &row.LastActivityToken, &row.SessionPinned,
			&row.InvocationPinned, &row.StopRequestedAt, &row.DisabledAt, &row.RollRev,
			&row.ReclaimedAt, &row.ReclaimedActivityTok,
			&row.ObservedGeneration, &row.MachineRestarts, &row.MachineRestartReason,
			&row.MachineUpAt, &row.MachineDownAt, &row.MemoryWaitUntil,
			&row.RunnerOOMKillID, &row.RunnerOOMRecoveredID,
		); err != nil {
			rows.Close()
			return nil, fmt.Errorf("reading Agents: %w", err)
		}
		loaded = append(loaded, loadedAgent{row: row})
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, fmt.Errorf("reading Agents: %w", err)
	}
	rows.Close()
	if len(loaded) == 0 {
		return loaded, nil
	}
	ids := make([]string, len(loaded))
	for i := range loaded {
		ids[i] = loaded[i].row.ID
	}
	if err := s.fill(ctx, tx, loaded, ids); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("reading Agents: %w", err)
	}
	return loaded, nil
}

func (s *Store) fill(ctx context.Context, tx pgx.Tx, loaded []loadedAgent, ids []string) error {
	byID := make(map[string]int, len(loaded))
	for i := range loaded {
		byID[loaded[i].row.ID] = i
	}
	conditions, err := tx.Query(ctx,
		`SELECT agent_id, type, status, reason, message, observed_generation, last_transition_at
		 FROM control.agent_conditions WHERE agent_id = ANY($1) ORDER BY agent_id, type`, ids)
	if err != nil {
		return fmt.Errorf("reading Agent conditions: %w", err)
	}
	for conditions.Next() {
		var agentID string
		var condition metav1Condition
		if err := conditions.Scan(&agentID, &condition.Type, &condition.Status, &condition.Reason,
			&condition.Message, &condition.ObservedGeneration, &condition.LastTransitionAt); err != nil {
			conditions.Close()
			return fmt.Errorf("reading Agent conditions: %w", err)
		}
		if i, ok := byID[agentID]; ok {
			loaded[i].children.conditions = append(loaded[i].children.conditions, condition.Condition())
		}
	}
	if err := conditions.Err(); err != nil {
		conditions.Close()
		return fmt.Errorf("reading Agent conditions: %w", err)
	}
	conditions.Close()

	hosts, err := tx.Query(ctx,
		`SELECT agent_id, host FROM control.agent_l7_hosts WHERE agent_id = ANY($1) ORDER BY agent_id, host`, ids)
	if err != nil {
		return fmt.Errorf("reading Agent L7 hosts: %w", err)
	}
	for hosts.Next() {
		var agentID, host string
		if err := hosts.Scan(&agentID, &host); err != nil {
			hosts.Close()
			return fmt.Errorf("reading Agent L7 hosts: %w", err)
		}
		if i, ok := byID[agentID]; ok {
			loaded[i].children.hosts = append(loaded[i].children.hosts, host)
		}
	}
	if err := hosts.Err(); err != nil {
		hosts.Close()
		return fmt.Errorf("reading Agent L7 hosts: %w", err)
	}
	hosts.Close()

	grants, err := tx.Query(ctx,
		`SELECT agent_id, connection_id FROM control.agent_connection_grants WHERE agent_id = ANY($1) ORDER BY agent_id, connection_id`, ids)
	if err != nil {
		return fmt.Errorf("reading Agent connection grants: %w", err)
	}
	for grants.Next() {
		var agentID, connectionID string
		if err := grants.Scan(&agentID, &connectionID); err != nil {
			grants.Close()
			return fmt.Errorf("reading Agent connection grants: %w", err)
		}
		if i, ok := byID[agentID]; ok {
			loaded[i].children.grants = append(loaded[i].children.grants, connectionID)
		}
	}
	if err := grants.Err(); err != nil {
		grants.Close()
		return fmt.Errorf("reading Agent connection grants: %w", err)
	}
	grants.Close()
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: metav1Condition is the scan target for a condition row, converted to the
// UNIT_BOUNDARY_DESCRIPTION: metav1 type only once the whole row is read.
type metav1Condition struct {
	Type               string
	Status             string
	Reason             string
	Message            string
	ObservedGeneration int64
	LastTransitionAt   time.Time
}

func (c metav1Condition) Condition() metav1.Condition {
	return metav1.Condition{
		Type:               c.Type,
		Status:             metav1.ConditionStatus(c.Status),
		Reason:             c.Reason,
		Message:            c.Message,
		ObservedGeneration: c.ObservedGeneration,
		LastTransitionTime: metav1.NewTime(c.LastTransitionAt),
	}
}

// UNIT_BOUNDARY_DESCRIPTION: Notify is one wake-up from the change feed: the Agent that moved, whether the
// UNIT_BOUNDARY_DESCRIPTION: row is gone, and whether this is a change a person is waiting on.
type Notify struct {
	Name   string
	Table  string
	Delete bool
	Urgent bool
}

func parseNotify(payload []byte) (Notify, bool) {
	var raw struct {
		Table string `json:"t"`
		Op    string `json:"op"`
		ID    string `json:"id"`
		Hot   bool   `json:"hot"`
	}
	if err := json.Unmarshal(payload, &raw); err != nil || raw.Table == "" {
		return Notify{}, false
	}
	// UNIT_BOUNDARY_DESCRIPTION: Only a DELETE on the definition is a deleted Agent. A child row is deleted
	// UNIT_BOUNDARY_DESCRIPTION: in normal operation — every host on a spec write, every recovered condition,
	// UNIT_BOUNDARY_DESCRIPTION: a kit row — and reading one as the Agent's deletion takes a live Agent out of
	// UNIT_BOUNDARY_DESCRIPTION: the cache and hands it to the delete worker for nothing. A child delete only
	// UNIT_BOUNDARY_DESCRIPTION: says the Agent moved, and the refetch decides whether it is gone.
	notify := Notify{Name: raw.ID, Table: raw.Table, Delete: raw.Op == "D" && raw.Table == "agents"}
	// UNIT_BOUNDARY_DESCRIPTION: A status, condition or kit write is the controller's own echo or a column it
	// UNIT_BOUNDARY_DESCRIPTION: never reads, and a budget write names no Agent: all take the background lane.
	// UNIT_BOUNDARY_DESCRIPTION: Everything else is a change someone is waiting on, a wake very much included.
	notify.Urgent = raw.Table != "agent_status" && raw.Table != "agent_conditions" &&
		raw.Table != "agent_kit_state" && raw.Table != "user_budgets"
	return notify, true
}

// UNIT_BOUNDARY_DESCRIPTION: Run owns the change feed and the relist. It lists first, then listens, then
// UNIT_BOUNDARY_DESCRIPTION: drains what arrived during the list: a LISTEN issued after a LIST would lose
// UNIT_BOUNDARY_DESCRIPTION: every write that landed in between.
func (s *Store) Run(ctx context.Context, notify func(Notify)) {
	backoff := time.Second
	for ctx.Err() == nil {
		started := time.Now()
		err := s.feed(ctx, notify)
		if ctx.Err() != nil {
			return
		}
		s.mu.Lock()
		s.feedDown = true
		s.mu.Unlock()
		if time.Since(started) > 30*time.Second {
			backoff = time.Second
		}
		slog.Warn("Agent store change feed lost; reconnecting", "error", err, "in", backoff)
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
}

func (s *Store) feed(ctx context.Context, notify func(Notify)) error {
	conn, err := pgx.ConnectConfig(ctx, s.conn.ConnConfig)
	if err != nil {
		return fmt.Errorf("connecting the change feed: %w", err)
	}
	defer conn.Close(context.Background())
	if _, err := conn.Exec(ctx, "LISTEN agent_changes"); err != nil {
		return fmt.Errorf("listening on the change feed: %w", err)
	}
	// UNIT_BOUNDARY_DESCRIPTION: Anything that committed between the last read and this LISTEN is caught
	// UNIT_BOUNDARY_DESCRIPTION: by the relist, not by a cursor: a notification carries no ordering.
	changed, deleted, err := s.relist(ctx)
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.feedDown = false
	s.contact = time.Now()
	s.mu.Unlock()
	// UNIT_BOUNDARY_DESCRIPTION: a reconnect is a fresh fleet. Every Agent is reconciled again, not only the ones that moved, because the reconciles it missed may have failed.
	for _, name := range sorted(append(changed, s.Names()...)) {
		notify(Notify{Name: name, Table: "agents", Urgent: false})
	}
	for _, name := range deleted {
		notify(Notify{Name: name, Table: "agents", Delete: true})
	}

	ticker := time.NewTicker(relistInterval)
	defer ticker.Stop()
	waitCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	pending := make(chan []byte, 256)
	var dropped atomic.Bool
	go func() {
		defer close(pending)
		for waitCtx.Err() == nil {
			message, err := conn.WaitForNotification(waitCtx)
			if err != nil {
				if waitCtx.Err() != nil {
					return
				}
				return
			}
			select {
			case pending <- []byte(message.Payload):
			default:
				// UNIT_BOUNDARY_DESCRIPTION: A full buffer drops the wake-up, so the pass that drains it
				// UNIT_BOUNDARY_DESCRIPTION: relists instead of trusting what arrived.
				dropped.Store(true)
			}
		}
	}()

	for {
		select {
		case <-ctx.Done():
			return nil
		case payload, ok := <-pending:
			if !ok {
				return errors.New("the change feed's connection closed")
			}
			if dropped.CompareAndSwap(true, false) {
				changed, deleted, err := s.relist(ctx)
				if err != nil {
					return err
				}
				for _, name := range changed {
					notify(Notify{Name: name, Table: "agents", Urgent: false})
				}
				for _, name := range deleted {
					notify(Notify{Name: name, Table: "agents", Delete: true})
				}
				continue
			}
			event, ok := parseNotify(payload)
			if !ok {
				continue
			}
			s.mu.Lock()
			s.contact = time.Now()
			s.mu.Unlock()
			if event.Table == "user_budgets" {
				notify(event)
				continue
			}
			if event.Name == "" {
				continue
			}
			if event.Delete {
				s.forget(event.Name)
				notify(event)
				continue
			}
			if err := s.refresh(ctx, event.Name); err != nil {
				if apierrors.IsNotFound(err) {
					s.forget(event.Name)
					event.Delete = true
					notify(event)
					continue
				}
				// UNIT_BOUNDARY_DESCRIPTION: a notification that could not be read is a wake nobody will get
				// UNIT_BOUNDARY_DESCRIPTION: until the next relist. Dropping the connection makes the relist
				// UNIT_BOUNDARY_DESCRIPTION: happen now, and it enqueues the whole fleet.
				return fmt.Errorf("re-reading the Agent %s: %w", event.Name, err)
			}
			notify(event)
		case <-ticker.C:
			changed, deleted, err := s.relist(ctx)
			if err != nil {
				return err
			}
			s.mu.Lock()
			s.contact = time.Now()
			s.mu.Unlock()
			for _, name := range changed {
				notify(Notify{Name: name, Table: "agents", Urgent: false})
			}
			for _, name := range deleted {
				notify(Notify{Name: name, Table: "agents", Delete: true})
			}
		}
	}
}

// UNIT_BOUNDARY_DESCRIPTION: refresh reads one Agent and puts it in the cache, so a wake is answered from
// UNIT_BOUNDARY_DESCRIPTION: what it named rather than from the next relist.
func (s *Store) refresh(ctx context.Context, name string) error {
	agent, err := s.Get(ctx, name)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.setLocked(agent)
	return nil
}

func (s *Store) forget(name string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.fleet[name]; !ok {
		return
	}
	delete(s.fleet, name)
	_ = s.indexer.Delete(&unstructured.Unstructured{Object: map[string]any{
		"metadata": map[string]any{"name": name, "namespace": s.namespace},
	}})
}

func (s *Store) setLocked(agent *unstructured.Unstructured) {
	s.fleet[agent.GetName()] = agent
	_ = s.indexer.Update(agent)
}

// UNIT_BOUNDARY_DESCRIPTION: relist reads the whole fleet and reports what moved since the last pass.
// UNIT_BOUNDARY_DESCRIPTION: Comparing the objects rather than a sequence is what catches an observation
// UNIT_BOUNDARY_DESCRIPTION: the api-server never versions.
func (s *Store) relist(ctx context.Context) (changed, deleted []string, err error) {
	rows, err := s.read(ctx, "")
	if err != nil {
		return nil, nil, err
	}
	seen := make(map[string]bool, len(rows))
	fresh := make(map[string]*unstructured.Unstructured, len(rows))
	for _, row := range rows {
		agent := hydrate(s.namespace, row.row, row.children)
		name := agent.GetName()
		seen[name] = true
		fresh[name] = agent
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for name, agent := range fresh {
		old, ok := s.fleet[name]
		if ok && string(old.GetUID()) != string(agent.GetUID()) {
			// UNIT_BOUNDARY_DESCRIPTION: an Agent re-created under the same name is a different Agent, and
			// UNIT_BOUNDARY_DESCRIPTION: the children of the old one must go. A relist that saw the delete and
			// UNIT_BOUNDARY_DESCRIPTION: the create in the gap reports both, so the new incarnation is not
			// UNIT_BOUNDARY_DESCRIPTION: taken for the old one.
			deleted = append(deleted, name)
			changed = append(changed, name)
			s.setLocked(agent)
			continue
		}
		if !ok || !equalAgent(old, agent) {
			changed = append(changed, name)
			s.setLocked(agent)
		}
	}
	for name := range s.fleet {
		if !seen[name] {
			deleted = append(deleted, name)
			delete(s.fleet, name)
			_ = s.indexer.Delete(&unstructured.Unstructured{Object: map[string]any{
				"metadata": map[string]any{"name": name, "namespace": s.namespace},
			}})
		}
	}
	s.synced = true
	s.contact = time.Now()
	return sorted(changed), sorted(deleted), nil
}

func equalAgent(a, b *unstructured.Unstructured) bool {
	return apiequality.Semantic.DeepEqual(a.Object, b.Object)
}

// UNIT_BOUNDARY_DESCRIPTION: Names is the fleet as the cache holds it, for the drift pass.
func (s *Store) Names() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	names := make([]string, 0, len(s.fleet))
	for name := range s.fleet {
		names = append(names, name)
	}
	return sorted(names)
}
