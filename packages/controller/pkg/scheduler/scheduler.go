package scheduler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"sync"
	"time"

	"github.com/robfig/cron/v3"
	"github.com/teambition/rrule-go"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/scheme"
	restclient "k8s.io/client-go/rest"
	"k8s.io/client-go/tools/remotecommand"
	"gopkg.in/yaml.v3"

	"github.com/kagenti/platform/packages/controller/pkg/config"
	"github.com/kagenti/platform/packages/controller/pkg/lifecycle"
	"github.com/kagenti/platform/packages/controller/pkg/reconciler"
	"github.com/kagenti/platform/packages/controller/pkg/types"
)

type Scheduler struct {
	client    kubernetes.Interface
	config    *config.Config
	cron      *cron.Cron
	schedules map[string]cron.EntryID
	rruleJobs map[string]context.CancelFunc
	// specYAMLs is the last spec.yaml we acted on per schedule. We compare
	// against it in SyncSchedule so informer resyncs (every 30s by default)
	// and status-only writes don't tear down and recreate the goroutine —
	// which would otherwise starve any schedule whose period exceeds the
	// resync period (e.g. FREQ=MINUTELY gets cancelled every 30s and
	// never reaches its 60s fire).
	specYAMLs map[string]string
	mu        sync.Mutex         // guards schedules + rruleJobs + specYAMLs
	restCfg   *restclient.Config // nil in tests
	lifecycle *lifecycle.Lifecycle
}

func New(client kubernetes.Interface, cfg *config.Config) *Scheduler {
	return &Scheduler{
		client:    client,
		config:    cfg,
		cron:      cron.New(),
		schedules: make(map[string]cron.EntryID),
		rruleJobs: make(map[string]context.CancelFunc),
		specYAMLs: make(map[string]string),
		lifecycle: lifecycle.New(client, cfg.Namespace),
	}
}

func (s *Scheduler) WithRESTConfig(cfg *restclient.Config) *Scheduler {
	s.restCfg = cfg
	return s
}

func (s *Scheduler) Start() { s.cron.Start() }

func (s *Scheduler) Stop() {
	s.cron.Stop()
	s.mu.Lock()
	for _, cancel := range s.rruleJobs {
		cancel()
	}
	s.rruleJobs = make(map[string]context.CancelFunc)
	s.specYAMLs = make(map[string]string)
	s.mu.Unlock()
}

func (s *Scheduler) SyncSchedule(cm *corev1.ConfigMap) error {
	name := cm.Name
	agentName := cm.Labels["agent-platform.ai/agent"]

	specYAML, ok := cm.Data["spec.yaml"]
	if !ok {
		return fmt.Errorf("schedule %s: no spec.yaml", name)
	}

	// Skip work when the spec is byte-identical to the last one we acted on
	// AND the job is already registered. Informer UpdateFunc fires for any
	// ConfigMap change (including our own status.yaml writes) and for every
	// periodic resync; without this guard, each would cancel and recreate
	// the goroutine.
	s.mu.Lock()
	prevSpec, prevSeen := s.specYAMLs[name]
	_, hasRRule := s.rruleJobs[name]
	_, hasCron := s.schedules[name]
	s.mu.Unlock()
	if prevSeen && prevSpec == specYAML && (hasRRule || hasCron) {
		return nil
	}

	spec, err := types.ParseScheduleSpec(specYAML)
	if err != nil {
		return fmt.Errorf("schedule %s: %w", name, err)
	}

	// Unregister from both paths; we re-register into exactly one below.
	s.RemoveSchedule(name)

	if !spec.Enabled {
		// Remember the (disabled) spec so the next no-op resync short-circuits.
		s.mu.Lock()
		s.specYAMLs[name] = specYAML
		s.mu.Unlock()
		return nil
	}

	var registerErr error
	switch effectiveScheduleType(spec) {
	case types.ScheduleTypeRRule:
		registerErr = s.registerRRuleSchedule(agentName, name, spec)
	default:
		registerErr = s.registerCronSchedule(agentName, name, spec)
	}
	if registerErr != nil {
		return registerErr
	}
	s.mu.Lock()
	s.specYAMLs[name] = specYAML
	s.mu.Unlock()
	return nil
}

// effectiveScheduleType falls back to "cron" for legacy specs that lack a Type field.
func effectiveScheduleType(spec *types.ScheduleSpec) string {
	if spec.Type != "" {
		return spec.Type
	}
	if spec.RRule != "" {
		return types.ScheduleTypeRRule
	}
	return types.ScheduleTypeCron
}

func (s *Scheduler) registerCronSchedule(agentName, name string, spec *types.ScheduleSpec) error {
	entryID, err := s.cron.AddFunc(spec.Cron, func() {
		ctx := context.Background()
		fireErr := s.fire(ctx, agentName, name, spec)

		// Always write schedule status, even on failure
		now := time.Now().UTC().Format(time.RFC3339)
		nextRun := ""
		s.mu.Lock()
		eid, exists := s.schedules[name]
		s.mu.Unlock()
		if exists {
			entry := s.cron.Entry(eid)
			if !entry.Next.IsZero() {
				nextRun = entry.Next.UTC().Format(time.RFC3339)
			}
		}
		result := "success"
		if fireErr != nil {
			result = fireErr.Error()
			slog.Error("schedule fire failed", "schedule", name, "agent", agentName, "error", fireErr)
		}
		if err := reconciler.WriteScheduleStatus(ctx, s.client, s.config.Namespace, name, types.NewScheduleStatus(now, nextRun, result)); err != nil {
			slog.Error("writing schedule status", "schedule", name, "error", err)
		}
	})
	if err != nil {
		return fmt.Errorf("schedule %s: invalid cron %q: %w", name, spec.Cron, err)
	}
	s.mu.Lock()
	s.schedules[name] = entryID
	s.mu.Unlock()
	// Publish the initial nextRun so the UI shows it before the first fire.
	if next := s.cron.Entry(entryID).Next; !next.IsZero() {
		if err := s.writeNextRunIfChanged(context.Background(), name, next); err != nil {
			slog.Error("writing initial schedule status", "schedule", name, "error", err)
		}
	}
	slog.Info("cron registered", "schedule", name, "cron", spec.Cron)
	return nil
}

func (s *Scheduler) registerRRuleSchedule(agentName, name string, spec *types.ScheduleSpec) error {
	loc, err := types.LoadTimezone(spec.Timezone)
	if err != nil {
		return fmt.Errorf("schedule %s: %w", name, err)
	}
	rule, err := types.ParseRRuleInLocation(spec.RRule, spec.Timezone)
	if err != nil {
		return fmt.Errorf("schedule %s: %w", name, err)
	}
	// Anchor DTSTART to "now" in the schedule's timezone. RRULE strings
	// produced by the UI don't carry an explicit DTSTART — the recurrence
	// is defined purely by its cadence (FREQ/BYDAY/BYHOUR/…), so any anchor
	// in the past is equivalent; we use "now" so DST rules resolve in the
	// current era.
	rule.DTStart(time.Now().In(loc))

	ctx, cancel := context.WithCancel(context.Background())
	s.mu.Lock()
	s.rruleJobs[name] = cancel
	s.mu.Unlock()

	// Publish the initial nextRun so the UI shows it before the first fire.
	// Uses a detached context because we want the status write to outlive
	// the job's cancellable context on re-sync.
	if next := nextVisibleOccurrence(rule, spec.QuietHours, loc, time.Now().In(loc)); !next.IsZero() {
		if err := s.writeNextRunIfChanged(context.Background(), name, next); err != nil {
			slog.Error("writing initial schedule status", "schedule", name, "error", err)
		}
	}

	go s.runRRuleJob(ctx, agentName, name, spec, rule, loc)
	slog.Info("rrule registered", "schedule", name, "rrule", spec.RRule, "timezone", spec.Timezone)
	return nil
}

// runRRuleJob is the per-schedule goroutine for rrule-type schedules.
// It sleeps directly to the next occurrence that is NOT inside any enabled
// QuietHours window — suppressed occurrences are never woken for. Status is
// written only when the schedule actually fires, so `lastResult` carries
// either "success" or an error message.
func (s *Scheduler) runRRuleJob(
	ctx context.Context,
	agentName, scheduleName string,
	spec *types.ScheduleSpec,
	rule *rrule.RRule,
	loc *time.Location,
) {
	for {
		now := time.Now().In(loc)
		next := nextVisibleOccurrence(rule, spec.QuietHours, loc, now)
		if next.IsZero() {
			slog.Info("rrule exhausted or fully quiet; stopping job", "schedule", scheduleName)
			return
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Until(next)):
		}

		// Compute the *next* visible occurrence for status.nextRun. We search
		// from the fire time forward; if the rule is exhausted, nextRunStr
		// stays empty and the UI shows "no next run."
		nextAfter := nextVisibleOccurrence(rule, spec.QuietHours, loc, time.Now().In(loc))
		nextRunStr := ""
		if !nextAfter.IsZero() {
			nextRunStr = nextAfter.UTC().Format(time.RFC3339)
		}

		fireErr := s.fire(ctx, agentName, scheduleName, spec)
		result := "success"
		if fireErr != nil {
			result = fireErr.Error()
			slog.Error("schedule fire failed", "schedule", scheduleName, "agent", agentName, "error", fireErr)
		}
		if err := reconciler.WriteScheduleStatus(
			ctx, s.client, s.config.Namespace, scheduleName,
			types.NewScheduleStatus(next.UTC().Format(time.RFC3339), nextRunStr, result),
		); err != nil {
			slog.Error("writing schedule status", "schedule", scheduleName, "error", err)
		}
	}
}

// writeNextRunIfChanged publishes `nextRun` to the schedule's status.yaml,
// preserving any existing lastRun/lastResult. It is a no-op when the stored
// nextRun already matches — a guard against a reconciliation loop: every
// status.yaml write triggers the informer, which re-enqueues the schedule
// and calls SyncSchedule again; without the no-op we'd write status forever.
func (s *Scheduler) writeNextRunIfChanged(ctx context.Context, name string, nextRun time.Time) error {
	cm, err := s.client.CoreV1().ConfigMaps(s.config.Namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return err
	}
	var current types.ScheduleStatus
	if raw := cm.Data["status.yaml"]; raw != "" {
		if err := yaml.Unmarshal([]byte(raw), &current); err != nil {
			return err
		}
	}
	nextRunStr := ""
	if !nextRun.IsZero() {
		nextRunStr = nextRun.UTC().Format(time.RFC3339)
	}
	if current.NextRun == nextRunStr {
		return nil
	}
	return reconciler.WriteScheduleStatus(
		ctx, s.client, s.config.Namespace, name,
		types.NewScheduleStatus(current.LastRun, nextRunStr, current.LastResult),
	)
}

func (s *Scheduler) RemoveSchedule(name string) {
	s.mu.Lock()
	if entryID, exists := s.schedules[name]; exists {
		s.cron.Remove(entryID)
		delete(s.schedules, name)
	}
	if cancel, exists := s.rruleJobs[name]; exists {
		cancel()
		delete(s.rruleJobs, name)
	}
	delete(s.specYAMLs, name)
	s.mu.Unlock()
}

func (s *Scheduler) fire(ctx context.Context, agentName, scheduleName string, spec *types.ScheduleSpec) error {
	if err := s.lifecycle.EnsureReady(ctx, agentName); err != nil {
		return fmt.Errorf("ensuring %s ready: %w", agentName, err)
	}

	// Build and deliver trigger
	trigger := map[string]any{
		"type":      spec.Type,
		"task":      spec.Task,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
		"schedule":  scheduleName,
	}
	if len(spec.MCPServers) > 0 {
		trigger["mcpServers"] = spec.MCPServers
	}
	if spec.SessionMode != "" {
		trigger["sessionMode"] = spec.SessionMode
	}
	triggerJSON, _ := json.Marshal(trigger)
	filename := fmt.Sprintf("/home/agent/.triggers/%d.json", time.Now().UnixMilli())
	tmpFilename := filename + ".tmp"

	podName := agentName + "-0"
	cmd := []string{"sh", "-c", fmt.Sprintf("mkdir -p /home/agent/.triggers && cat > %s << 'TRIGGER_EOF'\n%s\nTRIGGER_EOF\nmv %s %s", tmpFilename, string(triggerJSON), tmpFilename, filename)}

	if s.restCfg != nil {
		req := s.client.CoreV1().RESTClient().Post().
			Resource("pods").
			Name(podName).
			Namespace(s.config.Namespace).
			SubResource("exec").
			VersionedParams(&corev1.PodExecOptions{
				Container: "agent",
				Command:   cmd,
				Stdout:    true,
				Stderr:    true,
			}, scheme.ParameterCodec)

		exec, err := remotecommand.NewSPDYExecutor(s.restCfg, "POST", req.URL())
		if err != nil {
			return fmt.Errorf("exec into %s: %w", podName, err)
		}
		if err := exec.StreamWithContext(ctx, remotecommand.StreamOptions{
			Stdout: io.Discard,
			Stderr: io.Discard,
		}); err != nil {
			return fmt.Errorf("exec stream to %s: %w", podName, err)
		}
	}
	slog.Info("trigger delivered", "pod", podName, "file", filename)
	return nil
}
