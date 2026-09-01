package reconciler

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"time"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	storagev1 "k8s.io/api/storage/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	k8stypes "k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
	"github.com/kagenti/platform/packages/controller/pkg/config"
)

const (
	LabelMigrationFor        = "agent-platform.ai/migration-for"
	LabelMigrationSuperseded = "agent-platform.ai/superseded"
	migrationPoolValue       = "storage-migration"

	defaultMigrationInterval     = 30 * time.Second
	defaultMigrationConcurrency  = 10
	migrationJobRetryAfter       = 10 * time.Minute
	migrationJobDeadline         = 4 * time.Hour
	migrationFallbackUID         = int64(65532)
	migrationFallbackGID         = int64(65532)
	migrationServiceAccount      = "platform-migration"
	migrationChecksumParallelism = 8
)

type StorageMigrationManager struct {
	client          kubernetes.Interface
	dynamic         dynamic.Interface
	config          *config.Config
	now             func() time.Time
	skippedVM       map[string]bool
	warnedSameClass map[string]bool
	loggedReason    map[string]bool
	warnedResolve   bool
}

func NewStorageMigrationManager(client kubernetes.Interface, dyn dynamic.Interface, cfg *config.Config) *StorageMigrationManager {
	return &StorageMigrationManager{
		client:          client,
		dynamic:         dyn,
		config:          cfg,
		now:             time.Now,
		skippedVM:       map[string]bool{},
		warnedSameClass: map[string]bool{},
		loggedReason:    map[string]bool{},
	}
}

func (m *StorageMigrationManager) interval() time.Duration {
	if d := m.config.StorageMigration.Interval.AsDuration(); d > 0 {
		return d
	}
	return defaultMigrationInterval
}

func (m *StorageMigrationManager) concurrency() int {
	if c := m.config.StorageMigration.Concurrency; c > 0 {
		return c
	}
	return defaultMigrationConcurrency
}

func (m *StorageMigrationManager) RunLoop(ctx context.Context) {
	if !m.config.StorageMigration.Enabled {
		m.ReleaseGated(ctx)
		return
	}
	slog.Info("storage migration: manager started",
		"concurrency", m.concurrency(), "interval", m.interval().String())
	t := time.NewTicker(m.interval())
	defer t.Stop()
	for {
		m.Reconcile(ctx)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func (m *StorageMigrationManager) ReleaseGated(ctx context.Context) {
	agents, err := m.dynamic.Resource(AgentsGVR).Namespace(m.config.Namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		slog.Warn("storage migration: listing agents to release gates failed", "error", err)
		return
	}
	targetClass, _ := m.resolveTargetClass(ctx)
	allowSame := m.config.StorageMigration.AllowSameStorageClass
	gated := make([]*apiv1.Agent, 0, len(agents.Items))
	known := map[string]*apiv1.Agent{}
	for i := range agents.Items {
		agent, err := FromCacheObject[apiv1.Agent](&agents.Items[i])
		if err != nil {
			continue
		}
		known[agent.Name] = agent
		if agent.Annotations[annStorageMigration] != "" {
			gated = append(gated, agent)
		}
	}
	rwx := map[string]bool{}
	if pvcs, err := m.client.CoreV1().PersistentVolumeClaims(m.config.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: LabelAgent,
	}); err == nil {
		for i := range pvcs.Items {
			p := pvcs.Items[i]
			if _, needed := migrationReason(&p, agentTargetClass(known[p.Labels[LabelAgent]], targetClass), allowSame); needed {
				rwx[p.Labels[LabelAgent]] = true
			}
		}
	} else {
		slog.Warn("storage migration: listing PVCs to release gates failed", "error", err)
		return
	}

	for _, agent := range gated {
		if rwx[agent.Name] {
			prop := metav1.DeletePropagationBackground
			if err := m.client.BatchV1().Jobs(m.config.Namespace).Delete(ctx, migrationJobName(agent.Name),
				metav1.DeleteOptions{PropagationPolicy: &prop}); err != nil && !errors.IsNotFound(err) {
				slog.Warn("storage migration: deleting abandoned copy job failed", "agent", agent.Name, "error", err)
			}
			targets, err := m.client.CoreV1().PersistentVolumeClaims(m.config.Namespace).List(ctx,
				metav1.ListOptions{LabelSelector: LabelMigrationFor + "=" + agent.Name})
			if err != nil {
				slog.Warn("storage migration: listing abandoned targets failed", "agent", agent.Name, "error", err)
			} else {
				for _, t := range targets.Items {
					if err := m.client.CoreV1().PersistentVolumeClaims(m.config.Namespace).
						Delete(ctx, t.Name, metav1.DeleteOptions{}); err != nil && !errors.IsNotFound(err) {
						slog.Warn("storage migration: deleting abandoned target failed", "agent", agent.Name, "pvc", t.Name, "error", err)
					}
				}
			}
			slog.Info("storage migration: released gated agent, migration abandoned", "agent", agent.Name)
		}
		if err := m.finishFlip(ctx, agent); err != nil {
			slog.Warn("storage migration: releasing gate failed", "agent", agent.Name, "error", err)
		}
	}
}

func (m *StorageMigrationManager) ensureServiceAccount(ctx context.Context) error {
	_, err := m.client.CoreV1().ServiceAccounts(m.config.Namespace).Get(ctx, migrationServiceAccount, metav1.GetOptions{})
	if err == nil {
		return nil
	}
	if !errors.IsNotFound(err) {
		return fmt.Errorf("checking migration service account: %w", err)
	}
	sa := &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name:      migrationServiceAccount,
			Namespace: m.config.Namespace,
			Labels:    map[string]string{"agent-platform.ai/managed-by": "platform-controller"},
		},
		AutomountServiceAccountToken: ptrBool(false),
	}
	if _, err := m.client.CoreV1().ServiceAccounts(m.config.Namespace).Create(ctx, sa, metav1.CreateOptions{}); err != nil && !errors.IsAlreadyExists(err) {
		return fmt.Errorf("creating migration service account: %w", err)
	}
	slog.Info("storage migration: service account ensured", "name", migrationServiceAccount)
	return nil
}

func (m *StorageMigrationManager) Reconcile(ctx context.Context) {
	pvcs, err := m.client.CoreV1().PersistentVolumeClaims(m.config.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: LabelAgent,
	})
	if err != nil {
		slog.Warn("storage migration: listing PVCs failed", "error", err)
		return
	}

	targetClass, explicitClass := m.resolveTargetClass(ctx)
	allowSame := m.config.StorageMigration.AllowSameStorageClass

	agents, err := m.dynamic.Resource(AgentsGVR).Namespace(m.config.Namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		slog.Warn("storage migration: listing agents failed", "error", err)
		return
	}
	inFlight := map[string]bool{}
	known := map[string]*apiv1.Agent{}
	for i := range agents.Items {
		agent, err := FromCacheObject[apiv1.Agent](&agents.Items[i])
		if err != nil {
			continue
		}
		known[agent.Name] = agent
		if agent.Annotations[annStorageMigration] != "" {
			inFlight[agent.Name] = true
		}
	}

	rwxByAgent := map[string][]corev1.PersistentVolumeClaim{}
	for i := range pvcs.Items {
		p := pvcs.Items[i]
		agent := p.Labels[LabelAgent]
		target := agentTargetClass(known[agent], targetClass)
		reason, needed := migrationReason(&p, target, allowSame)
		if !needed {
			if isRWX(p.Spec.AccessModes) && !m.warnedSameClass[agent] {
				m.warnedSameClass[agent] = true
				slog.Warn("storage migration: refusing to migrate onto the volume's own storage class — the access mode would change but the backend would not",
					"agent", agent, "pvc", p.Name, "class", target,
					"remedy", "set controller.storageMigration.targetStorageClass to the class agents should end on (empty = cluster default), or allowSameStorageClass=true if this is intended")
			}
			continue
		}
		if !m.loggedReason[agent] {
			m.loggedReason[agent] = true
			slog.Info("storage migration: workspace needs migrating", "agent", agent, "pvc", p.Name,
				"reason", reason, "target", map[bool]string{true: target, false: target + " (cluster default)"}[explicitClass || target != targetClass])
		}
		rwxByAgent[agent] = append(rwxByAgent[agent], p)
	}

	work := map[string]bool{}
	for name := range rwxByAgent {
		work[name] = true
	}
	for name := range inFlight {
		work[name] = true
	}

	names := make([]string, 0, len(work))
	for name := range work {
		names = append(names, name)
	}
	sort.Strings(names)

	if len(names) > 0 {
		if err := m.ensureServiceAccount(ctx); err != nil {
			slog.Warn("storage migration: skipping pass, service account unavailable", "error", err)
			return
		}
	}

	slots := m.concurrency() - len(inFlight)
	for _, name := range names {
		agent, ok := known[name]
		if !ok {
			continue
		}
		if agent.Spec.IsVM() {
			if !m.skippedVM[name] {
				slog.Warn("storage migration: skipping vm-backend agent — recreate it to move off shared storage", "agent", name)
				m.skippedVM[name] = true
			}
			continue
		}
		if !inFlight[name] {
			if slots <= 0 {
				continue
			}
			slots--
		}
		if err := m.migrateAgent(ctx, agent, rwxByAgent[name], agentTargetClass(agent, targetClass)); err != nil {
			slog.Warn("storage migration: agent migration step failed", "agent", name, "error", err)
		}
	}
}

func (m *StorageMigrationManager) resolveTargetClass(ctx context.Context) (name string, explicit bool) {
	if c := m.config.StorageMigration.TargetStorageClass; c != "" {
		return c, true
	}
	classes, err := m.client.StorageV1().StorageClasses().List(ctx, metav1.ListOptions{})
	if err != nil {
		m.warnResolveOnce("storage migration: cannot resolve the cluster default storage class; migrating on access mode only", err)
		return "", false
	}
	var picked *storagev1.StorageClass
	for i := range classes.Items {
		sc := &classes.Items[i]
		if sc.Annotations["storageclass.kubernetes.io/is-default-class"] != "true" {
			continue
		}
		if picked == nil || sc.CreationTimestamp.After(picked.CreationTimestamp.Time) {
			picked = sc
		}
	}
	if picked != nil {
		return picked.Name, false
	}
	m.warnResolveOnce("storage migration: no default storage class found; migrating on access mode only", nil)
	return "", false
}

func (m *StorageMigrationManager) warnResolveOnce(msg string, err error) {
	if m.warnedResolve {
		return
	}
	m.warnedResolve = true
	if err != nil {
		slog.Warn(msg, "error", err)
		return
	}
	slog.Warn(msg)
}

func agentTargetClass(agent *apiv1.Agent, globalTarget string) string {
	if agent != nil && agent.Spec.StorageClass != "" {
		return agent.Spec.StorageClass
	}
	return globalTarget
}

func migrationReason(pvc *corev1.PersistentVolumeClaim, targetClass string, allowSame bool) (string, bool) {
	srcClass := ""
	if pvc.Spec.StorageClassName != nil {
		srcClass = *pvc.Spec.StorageClassName
	}
	sameClass := targetClass != "" && srcClass == targetClass
	if isRWX(pvc.Spec.AccessModes) {
		if sameClass && !allowSame {
			return "", false
		}
		return "shared-writable access mode", true
	}
	if targetClass != "" && srcClass != "" && srcClass != targetClass {
		return "storage class " + srcClass + " is not the migration target " + targetClass, true
	}
	return "", false
}

func (m *StorageMigrationManager) targetReusable(existing *corev1.PersistentVolumeClaim, targetClass string) bool {
	if targetClass != "" && ptrClassString(existing.Spec.StorageClassName) != targetClass {
		return false
	}
	if floor := m.config.StorageMigration.MinTargetSize; floor != "" {
		if q, err := resource.ParseQuantity(floor); err == nil {
			if size := existing.Spec.Resources.Requests[corev1.ResourceStorage]; size.Cmp(q) < 0 {
				return false
			}
		}
	}
	return true
}

func ptrClassString(sc *string) string {
	if sc == nil {
		return ""
	}
	return *sc
}

func isRWX(modes []corev1.PersistentVolumeAccessMode) bool {
	for _, m := range modes {
		if m == corev1.ReadWriteMany {
			return true
		}
	}
	return false
}

func migrationTargetName(oldPVC string) string {
	name := oldPVC
	for strings.HasPrefix(name, "mig-") {
		name = strings.TrimPrefix(name, "mig-")
	}
	if name == oldPVC {
		name = "mig-" + name
	}
	if len(name) > 63 {
		name = name[:63]
	}
	return strings.TrimSuffix(name, "-")
}

func migrationJobName(agentName string) string {
	name := "mig-" + agentName
	if len(name) > 63 {
		name = name[:63]
	}
	return strings.TrimSuffix(name, "-")
}

func (m *StorageMigrationManager) migrateAgent(ctx context.Context, agent *apiv1.Agent, rwxPVCs []corev1.PersistentVolumeClaim, targetClass string) error {
	name := agent.Name

	if agent.Annotations[annStorageMigration] == "" {
		wasRunning, err := m.agentPodPresent(ctx, name)
		if err != nil {
			return err
		}
		slog.Info("storage migration: gating agent for migration", "agent", name, "wasRunning", wasRunning)
		return m.patchAgentAnnotations(ctx, name, map[string]*string{
			annStorageMigration:           ptrString("migrating"),
			annStorageMigrationWasRunning: ptrString(fmt.Sprintf("%t", wasRunning)),
		})
	}

	if present, err := m.agentPodPresent(ctx, name); err != nil {
		return err
	} else if present {
		return nil
	}

	if len(rwxPVCs) > 0 {
		ownerRef := agentOwnerRef(agent)
		pairs := make([]migrationPair, 0, len(rwxPVCs))
		for _, old := range rwxPVCs {
			mount := old.Labels[LabelMount]
			if mount == "" {
				mount = strings.TrimSuffix(old.Name, "-"+name+"-0")
			}
			target, err := m.ensureTargetPVC(ctx, agent, mount, &old, ownerRef, targetClass)
			if err != nil {
				return err
			}
			pairs = append(pairs, migrationPair{old: old.Name, target: target, mount: mount})
		}

		job, err := m.client.BatchV1().Jobs(m.config.Namespace).Get(ctx, migrationJobName(name), metav1.GetOptions{})
		if errors.IsNotFound(err) {
			desired := buildMigrationJob(name, pairs, m.config, ownerRef)
			if _, err := m.client.BatchV1().Jobs(m.config.Namespace).Create(ctx, desired, metav1.CreateOptions{}); err != nil {
				return fmt.Errorf("creating copy job: %w", err)
			}
			slog.Info("storage migration: copy job started", "agent", name, "volumes", len(pairs))
			return nil
		}
		if err != nil {
			return err
		}

		switch {
		case jobSucceeded(job):
			return m.flip(ctx, agent, pairs, job.Name)
		case jobFailed(job):
			if m.now().Sub(job.CreationTimestamp.Time) < migrationJobRetryAfter {
				return fmt.Errorf("copy job %s failed; retrying after %s", job.Name, migrationJobRetryAfter)
			}
			slog.Warn("storage migration: deleting failed copy job for retry", "agent", name, "job", job.Name)
			prop := metav1.DeletePropagationBackground
			return m.client.BatchV1().Jobs(m.config.Namespace).Delete(ctx, job.Name, metav1.DeleteOptions{PropagationPolicy: &prop})
		default:
			slog.Info("storage migration: copy in progress", "agent", name,
				"job", job.Name, "age", m.now().Sub(job.CreationTimestamp.Time).Round(time.Second).String())
			return nil
		}
	}

	return m.finishFlip(ctx, agent)
}

type migrationPair struct {
	old    string
	target string
	mount  string
}

func (m *StorageMigrationManager) ensureTargetPVC(ctx context.Context, agent *apiv1.Agent, mount string, old *corev1.PersistentVolumeClaim, ownerRef metav1.OwnerReference, targetClass string) (string, error) {
	agentName := agent.Name
	targetName := migrationTargetName(old.Name)
	existing, err := m.client.CoreV1().PersistentVolumeClaims(m.config.Namespace).Get(ctx, targetName, metav1.GetOptions{})
	if err == nil {
		if existing.DeletionTimestamp != nil {
			return "", fmt.Errorf("stale migration target %s is still terminating; retrying next tick", targetName)
		}
		if m.targetReusable(existing, targetClass) {
			return targetName, nil
		}
		if existing.Labels[LabelAgent] != "" {
			return "", fmt.Errorf("target %s does not match the configured destination but is already claimed; refusing to replace it", targetName)
		}
		slog.Warn("storage migration: discarding stale target provisioned for a different destination",
			"agent", agentName, "pvc", targetName,
			"have", ptrClassString(existing.Spec.StorageClassName), "want", targetClass)
		prop := metav1.DeletePropagationBackground
		if err := m.client.BatchV1().Jobs(m.config.Namespace).Delete(ctx, migrationJobName(agentName),
			metav1.DeleteOptions{PropagationPolicy: &prop}); err != nil && !errors.IsNotFound(err) {
			return "", err
		}
		if err := m.client.CoreV1().PersistentVolumeClaims(m.config.Namespace).Delete(ctx, targetName, metav1.DeleteOptions{}); err != nil && !errors.IsNotFound(err) {
			return "", err
		}
		return "", fmt.Errorf("discarded stale migration target %s; recreating next tick", targetName)
	}
	if !errors.IsNotFound(err) {
		return "", err
	}

	size := old.Spec.Resources.Requests[corev1.ResourceStorage]
	if size.IsZero() {
		size = resource.MustParse(m.config.AgentTemplateDefaults.StorageSize)
	}
	if floor := m.config.StorageMigration.MinTargetSize; floor != "" {
		if q, err := resource.ParseQuantity(floor); err != nil {
			slog.Warn("storage migration: minTargetSize is not a valid quantity; ignoring", "value", floor, "error", err)
		} else if size.Cmp(q) < 0 {
			slog.Info("storage migration: raising target size to the configured floor",
				"agent", agentName, "requested", size.String(), "floor", q.String())
			size = q
		}
	}
	spec := corev1.PersistentVolumeClaimSpec{
		AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce},
		Resources: corev1.VolumeResourceRequirements{
			Requests: corev1.ResourceList{corev1.ResourceStorage: size},
		},
	}
	sc := agent.Spec.StorageClass
	if sc == "" {
		sc = m.config.StorageMigration.TargetStorageClass
	}
	if sc != "" {
		spec.StorageClassName = &sc
	}
	pvc := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:            targetName,
			Namespace:       m.config.Namespace,
			OwnerReferences: []metav1.OwnerReference{ownerRef},
			Labels: map[string]string{
				LabelPool:         migrationPoolValue,
				LabelMount:        mount,
				LabelMigrationFor: agentName,
			},
		},
		Spec: spec,
	}
	if _, err := m.client.CoreV1().PersistentVolumeClaims(m.config.Namespace).Create(ctx, pvc, metav1.CreateOptions{}); err != nil && !errors.IsAlreadyExists(err) {
		return "", fmt.Errorf("creating target PVC: %w", err)
	}
	slog.Info("storage migration: target volume created", "agent", agentName, "pvc", targetName, "size", size.String())
	return targetName, nil
}

func (m *StorageMigrationManager) flip(ctx context.Context, agent *apiv1.Agent, pairs []migrationPair, jobName string) error {
	name := agent.Name
	pvcClient := m.client.CoreV1().PersistentVolumeClaims(m.config.Namespace)

	for _, pair := range pairs {
		if err := patchPVCLabels(ctx, m.client, m.config.Namespace, pair.target, map[string]*string{
			LabelAgent:        ptrString(name),
			LabelMigrationFor: nil,
		}); err != nil {
			return fmt.Errorf("labeling target %s: %w", pair.target, err)
		}
		if err := patchPVCLabels(ctx, m.client, m.config.Namespace, pair.old, map[string]*string{
			LabelAgent:               nil,
			LabelMount:               nil,
			LabelMigrationSuperseded: ptrString(name),
		}); err != nil {
			return fmt.Errorf("stripping source %s: %w", pair.old, err)
		}
	}

	if err := m.client.AppsV1().StatefulSets(m.config.Namespace).Delete(ctx, name, metav1.DeleteOptions{}); err != nil && !errors.IsNotFound(err) {
		return fmt.Errorf("deleting statefulset: %w", err)
	}

	list, err := pvcClient.List(ctx, metav1.ListOptions{LabelSelector: LabelMigrationSuperseded + "=" + name})
	if err != nil {
		return err
	}
	for _, p := range list.Items {
		if err := pvcClient.Delete(ctx, p.Name, metav1.DeleteOptions{}); err != nil && !errors.IsNotFound(err) {
			return fmt.Errorf("deleting superseded %s: %w", p.Name, err)
		}
		slog.Info("storage migration: superseded volume deleted", "agent", name, "pvc", p.Name)
	}

	prop := metav1.DeletePropagationBackground
	if err := m.client.BatchV1().Jobs(m.config.Namespace).Delete(ctx, jobName, metav1.DeleteOptions{PropagationPolicy: &prop}); err != nil && !errors.IsNotFound(err) {
		return fmt.Errorf("deleting copy job: %w", err)
	}

	return m.finishFlip(ctx, agent)
}

func (m *StorageMigrationManager) finishFlip(ctx context.Context, agent *apiv1.Agent) error {
	name := agent.Name
	pvcClient := m.client.CoreV1().PersistentVolumeClaims(m.config.Namespace)
	list, err := pvcClient.List(ctx, metav1.ListOptions{LabelSelector: LabelMigrationSuperseded + "=" + name})
	if err != nil {
		return err
	}
	for _, p := range list.Items {
		if err := pvcClient.Delete(ctx, p.Name, metav1.DeleteOptions{}); err != nil && !errors.IsNotFound(err) {
			return err
		}
	}

	patch := map[string]*string{
		annStorageMigration:           nil,
		annStorageMigrationWasRunning: nil,
	}
	if agent.Annotations[annStorageMigrationWasRunning] == "true" {
		patch[annLastActivity] = ptrString(m.now().UTC().Format(time.RFC3339))
	}
	if err := m.patchAgentAnnotations(ctx, name, patch); err != nil {
		return err
	}
	slog.Info("storage migration: agent migrated to ReadWriteOnce storage", "agent", name,
		"wasRunning", agent.Annotations[annStorageMigrationWasRunning] == "true")
	return nil
}

func (m *StorageMigrationManager) agentPodPresent(ctx context.Context, agentName string) (bool, error) {
	pods, err := m.client.CoreV1().Pods(m.config.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: LabelAgent + "=" + agentName + "," + LabelRole + "=" + RoleAgent,
	})
	if err != nil {
		return false, err
	}
	return len(pods.Items) > 0, nil
}

func (m *StorageMigrationManager) patchAgentAnnotations(ctx context.Context, name string, ann map[string]*string) error {
	entries := make([]string, 0, len(ann))
	for k, v := range ann {
		if v == nil {
			entries = append(entries, fmt.Sprintf("%q:null", k))
		} else {
			entries = append(entries, fmt.Sprintf("%q:%q", k, *v))
		}
	}
	sort.Strings(entries)
	patch := fmt.Sprintf(`{"metadata":{"annotations":{%s}}}`, strings.Join(entries, ","))
	_, err := m.dynamic.Resource(AgentsGVR).Namespace(m.config.Namespace).
		Patch(ctx, name, k8stypes.MergePatchType, []byte(patch), metav1.PatchOptions{})
	return err
}

func patchPVCLabels(ctx context.Context, client kubernetes.Interface, namespace, name string, labels map[string]*string) error {
	entries := make([]string, 0, len(labels))
	for k, v := range labels {
		if v == nil {
			entries = append(entries, fmt.Sprintf("%q:null", k))
		} else {
			entries = append(entries, fmt.Sprintf("%q:%q", k, *v))
		}
	}
	sort.Strings(entries)
	patch := fmt.Sprintf(`{"metadata":{"labels":{%s}}}`, strings.Join(entries, ","))
	_, err := client.CoreV1().PersistentVolumeClaims(namespace).
		Patch(ctx, name, k8stypes.MergePatchType, []byte(patch), metav1.PatchOptions{})
	if errors.IsNotFound(err) {
		return nil
	}
	return err
}

func ptrString(s string) *string { return &s }

func jobSucceeded(job *batchv1.Job) bool {
	for _, c := range job.Status.Conditions {
		if c.Type == batchv1.JobComplete && c.Status == corev1.ConditionTrue {
			return true
		}
	}
	return false
}

func jobFailed(job *batchv1.Job) bool {
	for _, c := range job.Status.Conditions {
		if c.Type == batchv1.JobFailed && c.Status == corev1.ConditionTrue {
			return true
		}
	}
	return false
}

func buildMigrationJob(agentName string, pairs []migrationPair, cfg *config.Config, ownerRef metav1.OwnerReference) *batchv1.Job {
	var volumes []corev1.Volume
	var mounts []corev1.VolumeMount
	var script strings.Builder
	uid, gid := migrationFallbackUID, migrationFallbackGID
	if sc := cfg.AgentBase.ContainerSecurityContext; sc != nil {
		if sc.RunAsUser != nil {
			uid = *sc.RunAsUser
		}
		if sc.RunAsGroup != nil {
			gid = *sc.RunAsGroup
		}
	}
	fmt.Fprintf(&script, "set -euo pipefail\nAGENT_UID=%d\nAGENT_GID=%d\nPAR=%d\n",
		uid, gid, migrationChecksumParallelism)
	script.WriteString(`
T0=$(date +%s)
phase() { echo "phase: $1 (+$(( $(date +%s) - T0 ))s)"; }

# SPLIT IDENTITY, one rule: whoever touches the SOURCE is the agent,
# whoever touches the TARGET is root. The source may live on a
# root-squashing share, where uid 0 is remapped to nobody server-side and
# is the weakest identity on the mount (root got EACCES on the agent's own
# 0600 files in production); the agent uid reads everything it owns. The
# target is a local block filesystem, where root's ownership of the fresh
# volume root, exact ownership restore, and wiping a prior attempt's
# read-only residue all just work. No fsGroup is involved anywhere, so the
# volume root carries no setgid bit and the kernel inherits nothing:
# modes land exactly as tar records them.
AS_AGENT="setpriv --reuid=${AGENT_UID} --regid=${AGENT_GID} --clear-groups"

# Both identities share one private scratch dir (root-created, sticky,
# world-writable): the agent-side workers and the root-side collectors
# never collide with anything pre-existing, and Linux protected_regular
# never refuses a redirect over a file the other identity created.
W=$(mktemp -d)
chgrp "${AGENT_GID}" "$W"
chmod 0770 "$W"

# Source-side pipelines run under $AS_AGENT via this helper script (a
# fresh process cannot inherit shell functions).
cat > "$W"/srcside.sh <<'EOS'
set -euo pipefail
src="$1"; what="$2"; PAR="$3"; W="$4"
case "$what" in
walk)
  # One deep walk of the source; every source-side check derives from it.
  # -prune, not ! -path: exclusion by path still DESCENDS, and a 0700
  # root-owned lost+found aborts the walk with permission denied. The r/x
  # prefix records readability by THIS uid — the identity that will read
  # the data.
  cd "$src" && find . -mindepth 1 \( -path ./lost+found -prune \) -o \
     \( \( -readable -printf "r|%y|%m|%U|%p|%l\n" \) -o -printf "x|%y|%m|%U|%p|%l\n" \) ;;
sums)
  # Content checksums, read in parallel: small-file verification is
  # latency-bound, so workers overlap round-trips. Each worker batch
  # appends to its own file — a shared stdout tears lines once a batch
  # exceeds one atomic pipe write. md5 is integrity checking of our own
  # quiesced copy, not defense against crafted collisions.
  cd "$src" && rm -f "$W"/sums.src.*
  find . \( -path ./lost+found -prune \) -o -type f -print0 \
    | xargs -0 -r -P"$PAR" -n64 sh -c 'md5sum "$@" >> "'"$W"'/sums.src.$$"' _
  cat "$W"/sums.src.* 2>/dev/null || true ;;
esac
EOS

copy_verify() {
  src="$1"; dst="$2"
  echo "migrate: $src -> $dst"

  $AS_AGENT bash "$W"/srcside.sh "$src" walk "$PAR" "$W" > "$W"/src.walk
  entries=$(wc -l < "$W"/src.walk)
  phase "walked source: $entries entries"

  # The walk is line-based with | separators: a path containing either
  # character cannot be represented and would corrupt every check derived
  # from the walk. Refuse it by name — rename on the source is the remedy.
  # Field count is exact: flag|type|mode|uid|path|link.
  malformed="$(awk -F'|' 'NF!=6 && n<20 {print; n++}' "$W"/src.walk)"
  if [ -n "$malformed" ]; then
    echo "migration blocked: source paths contain | or newline, which the inventory cannot represent (rename them; list may be truncated):"
    echo "$malformed"
    exit 1
  fi

  # An entry the READER cannot open is unmovable: on a squashing share no
  # identity in this pod can read it — not the agent, and root least of
  # all. This subsumes the old foreign-owner gate: a READABLE root-owned
  # stray now copies faithfully (the writer preserves ownership exactly),
  # and an unreadable one is caught here with its path. Dangling symlinks
  # are exempt: -readable follows links, and the copy recreates them fine.
  unreadable="$(awk -F'|' '$1=="x" && $2!="l" && n<20 {print $5; n++}' "$W"/src.walk)"
  if [ -n "$unreadable" ]; then
    echo "migration blocked: entries the agent uid cannot read on the source (chmod u+rX them; list may be truncated):"
    echo "$unreadable"
    exit 1
  fi

  # Verification baseline at FULL fidelity — the uid column is compared,
  # not excused, because the root writer preserves ownership exactly.
  cut -d'|' -f2- "$W"/src.walk | LC_ALL=C sort > "$W"/src.meta
  # Source checksums before the copy: the source is quiesced, so before
  # and after are indistinguishable, and this keeps every source read
  # under the squash-safe identity.
  $AS_AGENT bash "$W"/srcside.sh "$src" sums "$PAR" "$W" | LC_ALL=C sort > "$W"/src.sum
  phase "hashed source"

  # Wipe as root: a prior attempt's read-only directories are plain rm.
  # lost+found stays — a fresh ext4 volume's own artifact, excluded from
  # verification on both sides.
  find "$dst" -mindepth 1 -maxdepth 1 ! -name lost+found -exec rm -rf {} +
  # Neutralize the ROOT itself on every attempt: a previous attempt's
  # success-shaping (or the kubelet, on installs that ever ran fsGroup on
  # the Job) may have left it setgid, and extracting under a setgid root
  # lets the kernel stamp the bit into every 0700-style directory tar
  # creates -- turning one transient failure into a permanently failing
  # retry loop. chmod 00755, five digits: GNU chmod PRESERVES dir setgid
  # for numeric modes under five digits ("755" and "0755" both keep it).
  # Agent ownership here is also what lets the agent-identity write test
  # below pass before the success-shaping runs.
  chown "${AGENT_UID}:${AGENT_GID}" "$dst"
  chmod 00755 "$dst"
  phase "wiped target"

  if [ "$entries" -gt 0 ]; then
    # Reader as the agent (squash-safe), writer as root: exact modes
    # including setuid, exact OWNERSHIP (--same-owner --numeric-owner —
    # readable foreign-uid strays land as themselves), hard links (a
    # hard-link-heavy pnpm store must not inflate past the volume size),
    # and sparseness. The "." member restores the volume root's own mode,
    # owner, and times — a root writer may apply all of it.
    # --exclude=./lost+found: the archive walks everything including a
    # source ext4 root-owned 0700 lost+found, which the agent-identity
    # reader cannot open -- and the inventory walk prunes it, so the
    # unreadable gate never names it either. Anchored (leading ./), so a
    # nested lost+found the workspace owns still copies, matching the
    # walks. The "." member itself stays in the archive.
    $AS_AGENT tar -C "$src" --sparse --exclude=./lost+found -cf - . | tar -C "$dst" -xpf - --same-owner --numeric-owner
    sync
  else
    echo "source is empty; nothing to copy"
  fi
  phase "copied"

  # The AGENT must be able to use the volume it wakes up on.
  $AS_AGENT touch "$dst/.migration-writable"
  rm -f "$dst/.migration-writable"

  # Two-pass verification; the old volume is deleted at flip on the
  # strength of these comparisons, so both fail closed on any difference.
  (cd "$dst" && find . -mindepth 1 \( -path ./lost+found -prune \) -o -printf "%y|%m|%U|%p|%l\n") \
    | LC_ALL=C sort > "$W"/dst.meta
  cmp "$W"/src.meta "$W"/dst.meta
  phase "verified metadata"

  rm -f "$W"/sums.dst.*
  (cd "$dst" && find . \( -path ./lost+found -prune \) -o -type f -print0 \
     | xargs -0 -r -P"$PAR" -n64 sh -c 'md5sum "$@" >> "'"$W"'/sums.dst.$$"' _)
  { cat "$W"/sums.dst.* 2>/dev/null || true; } | LC_ALL=C sort > "$W"/dst.sum
  cmp "$W"/src.sum "$W"/dst.sum
  phase "verified content"

  # Success-shaping, strictly LAST: only a fully verified copy gets the
  # root signature the agent pods fsGroup + OnRootMismatch expect (agent
  # group, setgid, group-rwx), so the first post-migration mount skips
  # the kubelet recursive ownership pass. A failed attempt never reaches
  # this line, and the wipe above re-neutralizes the root anyway --
  # extraction always happens under a setgid-free root.
  chmod 2770 "$dst"
  echo "verified (content + metadata): $src -> $dst"
}
`)
	for i, pair := range pairs {
		srcVol := fmt.Sprintf("src-%d", i)
		dstVol := fmt.Sprintf("dst-%d", i)
		volumes = append(volumes,
			corev1.Volume{
				Name: srcVol,
				VolumeSource: corev1.VolumeSource{
					PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: pair.old, ReadOnly: true},
				},
			},
			corev1.Volume{
				Name: dstVol,
				VolumeSource: corev1.VolumeSource{
					PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: pair.target},
				},
			},
		)
		mounts = append(mounts,
			corev1.VolumeMount{Name: srcVol, MountPath: fmt.Sprintf("/mnt/src-%d", i), ReadOnly: true},
			corev1.VolumeMount{Name: dstVol, MountPath: fmt.Sprintf("/mnt/dst-%d", i)},
		)
		fmt.Fprintf(&script, "copy_verify /mnt/src-%d /mnt/dst-%d\n", i, i)
	}

	backoff := int32(2)
	ttl := int32(600)
	deadline := int64(migrationJobDeadline.Seconds())
	rootUID := int64(0)
	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:            migrationJobName(agentName),
			Namespace:       cfg.Namespace,
			OwnerReferences: []metav1.OwnerReference{ownerRef},
			Labels: map[string]string{
				LabelMigrationFor:              agentName,
				"agent-platform.ai/managed-by": "platform-controller",
			},
		},
		Spec: batchv1.JobSpec{
			BackoffLimit:            &backoff,
			TTLSecondsAfterFinished: &ttl,
			ActiveDeadlineSeconds:   &deadline,
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						LabelMigrationFor:              agentName,
						"agent-platform.ai/managed-by": "platform-controller",
						"istio.io/dataplane-mode":      "none",
					},
				},
				Spec: corev1.PodSpec{
					RestartPolicy:                corev1.RestartPolicyNever,
					ServiceAccountName:           migrationServiceAccount,
					AutomountServiceAccountToken: ptrBool(false),
					SecurityContext: &corev1.PodSecurityContext{
						RunAsUser: &rootUID,
					},
					Containers: []corev1.Container{{
						Name:         "copy",
						Image:        cfg.StorageMigration.JobImage,
						Command:      []string{"bash", "-c", script.String()},
						VolumeMounts: mounts,
						Resources: corev1.ResourceRequirements{
							Requests: corev1.ResourceList{
								corev1.ResourceCPU:    resource.MustParse("100m"),
								corev1.ResourceMemory: resource.MustParse("128Mi"),
							},
							Limits: corev1.ResourceList{
								corev1.ResourceCPU:    resource.MustParse("1"),
								corev1.ResourceMemory: resource.MustParse("512Mi"),
							},
						},
					}},
					Volumes: volumes,
				},
			},
		},
	}
	applyAgentBaseScheduling(&job.Spec.Template.Spec, cfg.AgentBase)
	job.Spec.Template.Spec.RuntimeClassName = nil
	return job
}
