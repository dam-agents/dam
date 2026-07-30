package reconciler

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
	"github.com/kagenti/platform/packages/controller/pkg/config"
)

func migrationConfig() *config.Config {
	return &config.Config{
		Namespace: "test-agents",
		AgentBase: config.AgentBase{
			TerminationGracePeriod: 5,
			ContainerSecurityContext: &corev1.SecurityContext{
				Capabilities: &corev1.Capabilities{Drop: []corev1.Capability{"ALL"}},
				RunAsUser:    ptrInt64(65532),
			},
		},
		AgentTemplateDefaults: config.AgentTemplateDefaults{
			AgentHome:   "/home/agent",
			StorageSize: "10Gi",
		},
		StorageMigration: config.StorageMigration{
			Enabled: true, // the chart default is off; tests drive it on

			JobImage: "mirror.gcr.io/library/debian:stable-slim",
		},
	}
}

func rwxPVC(name, agent, mount string) *corev1.PersistentVolumeClaim {
	return &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: "test-agents",
			Labels:    map[string]string{LabelAgent: agent, LabelMount: mount},
		},
		Spec: corev1.PersistentVolumeClaimSpec{
			AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteMany},
			Resources: corev1.VolumeResourceRequirements{
				Requests: corev1.ResourceList{corev1.ResourceStorage: resource.MustParse("7Gi")},
			},
		},
	}
}

func migrationManager(t *testing.T, agent *apiv1.Agent, objects ...runtime.Object) (*StorageMigrationManager, *fake.Clientset) {
	t.Helper()
	client := fake.NewSimpleClientset(objects...)
	u, err := agentToUnstructured(agent)
	require.NoError(t, err)
	dyn := newFakeDynamic(u)
	m := NewStorageMigrationManager(client, dyn, migrationConfig())
	m.now = func() time.Time { return time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC) }
	return m, client
}

func getAgentAnnotations(t *testing.T, m *StorageMigrationManager, name string) map[string]string {
	t.Helper()
	obj, err := m.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(context.Background(), name, metav1.GetOptions{})
	require.NoError(t, err)
	return obj.GetAnnotations()
}

// A running agent with an RWX workspace is gated down first — the migration
// annotation forces shouldRun false and records the prior run state.
func TestStorageMigration_GatesRunningAgentDown(t *testing.T) {
	agent := agentCR()
	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{
		Name: "my-agent-0", Namespace: "test-agents",
		Labels: map[string]string{LabelAgent: "my-agent", LabelRole: RoleAgent},
	}}
	m, _ := migrationManager(t, agent, rwxPVC("home-agent-my-agent-0", "my-agent", "home-agent"), pod)

	m.Reconcile(context.Background())

	ann := getAgentAnnotations(t, m, "my-agent")
	assert.Equal(t, "migrating", ann[annStorageMigration])
	assert.Equal(t, "true", ann[annStorageMigrationWasRunning])
	assert.False(t, shouldRun(ann, time.Hour, time.Now()),
		"the migration gate must force the pair down")
}

// While the agent pod is still terminating nothing else happens — no target
// volume, no copy Job.
func TestStorageMigration_WaitsForQuiescence(t *testing.T) {
	agent := agentCR()
	agent.Annotations = map[string]string{
		annStorageMigration:           "migrating",
		annStorageMigrationWasRunning: "true",
	}
	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{
		Name: "my-agent-0", Namespace: "test-agents",
		Labels: map[string]string{LabelAgent: "my-agent", LabelRole: RoleAgent},
	}}
	m, client := migrationManager(t, agent, rwxPVC("home-agent-my-agent-0", "my-agent", "home-agent"), pod)

	m.Reconcile(context.Background())

	jobs, err := client.BatchV1().Jobs("test-agents").List(context.Background(), metav1.ListOptions{})
	require.NoError(t, err)
	assert.Empty(t, jobs.Items, "no copy job while the agent pod is up")
	pvcs, err := client.CoreV1().PersistentVolumeClaims("test-agents").List(context.Background(), metav1.ListOptions{})
	require.NoError(t, err)
	assert.Len(t, pvcs.Items, 1, "no target PVC while the agent pod is up")
}

// A gated, quiesced agent gets a target RWO volume (sized like the source,
// invisible to the workspace resolvers) and a copy Job mounting the pair.
func TestStorageMigration_CreatesTargetAndCopyJob(t *testing.T) {
	agent := agentCR()
	agent.Annotations = map[string]string{
		annStorageMigration:           "migrating",
		annStorageMigrationWasRunning: "false",
	}
	m, client := migrationManager(t, agent, rwxPVC("home-agent-my-agent-0", "my-agent", "home-agent"))

	m.Reconcile(context.Background())

	target, err := client.CoreV1().PersistentVolumeClaims("test-agents").Get(context.Background(), "mig-home-agent-my-agent-0", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce}, target.Spec.AccessModes)
	req := target.Spec.Resources.Requests[corev1.ResourceStorage]
	assert.Equal(t, "7Gi", req.String(), "target sized like the source")
	assert.Equal(t, "my-agent", target.Labels[LabelMigrationFor])
	assert.Equal(t, migrationPoolValue, target.Labels[LabelPool])
	assert.Equal(t, "home-agent", target.Labels[LabelMount])
	assert.Empty(t, target.Labels[LabelAgent], "a half-copied target must not carry the agent label")

	require.Len(t, target.OwnerReferences, 1)
	assert.Equal(t, "my-agent", target.OwnerReferences[0].Name,
		"target is GC'd with the Agent if it is deleted mid-migration")

	job, err := client.BatchV1().Jobs("test-agents").Get(context.Background(), "mig-my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	require.Len(t, job.OwnerReferences, 1)
	assert.Equal(t, "my-agent", job.OwnerReferences[0].Name)
	require.NotNil(t, job.Spec.ActiveDeadlineSeconds)
	assert.Greater(t, *job.Spec.ActiveDeadlineSeconds, int64(0),
		"a non-terminal Job (unschedulable pod, stuck pull) must eventually fail rather than gate the agent forever")
	// The copy runs as the agent uid, never root: a single-owner workspace is
	// fully readable to its own uid even on root-squashing shared
	// filesystems, where squashed root would EACCES on 0600/0700 entries.
	psc := job.Spec.Template.Spec.SecurityContext
	require.NotNil(t, psc)
	require.NotNil(t, psc.RunAsUser)
	assert.Equal(t, int64(65532), *psc.RunAsUser)
	// Group 0 matches the agent images' uid:0 convention, so what the copy
	// creates carries the identity the agent itself runs with.
	require.NotNil(t, psc.RunAsGroup)
	assert.Equal(t, int64(0), *psc.RunAsGroup)
	require.NotNil(t, psc.FSGroup)
	assert.Equal(t, int64(65532), *psc.FSGroup, "fsGroup makes the fresh target volume writable to the agent uid")
	// Nothing in the migration may need privilege: OpenShift's restricted SCC
	// strips CAP_CHOWN/CAP_DAC_OVERRIDE and Kata's virtiofs refuses guest
	// chown, so a root step (even just to chown a target root) is a
	// portability trap. The copy is unprivileged end to end.
	assert.Empty(t, job.Spec.Template.Spec.InitContainers,
		"no privileged init container — the agent uid owns the workspace and may chmod it")
	copyScript := job.Spec.Template.Spec.Containers[0].Command[2]
	// Assert on the commands, not the prose that explains why they are absent.
	var cmds strings.Builder
	for _, line := range strings.Split(copyScript, "\n") {
		if t := strings.TrimSpace(line); !strings.HasPrefix(t, "#") {
			cmds.WriteString(t + "\n")
		}
	}
	runnable := cmds.String()
	// No chown may be INVOKED (an echo naming it in a remedy hint is fine):
	// chown is unavailable under a restricted SCC and on Kata virtiofs.
	assert.NotRegexp(t, `(?m)^chown |-exec chown|; chown `, runnable,
		"the copy must never invoke chown")
	// The verification must gate on metadata (mode + owner), not content
	// alone — the source is never deleted when permissions failed to carry
	// over.
	assert.Contains(t, runnable, `%y|%m|%U|%p|%l`)
	// tar with --no-overwrite-dir, not cp -a src/. dst/: cp would apply the
	// source root's ownership/timestamps to the target root, which no
	// unprivileged process can do.
	assert.Contains(t, runnable, "--no-overwrite-dir")
	assert.NotContains(t, runnable, "cp -a")
	// A fresh ext4 CSI target ships a root-owned lost+found the source has
	// not got: it must be excluded from the wipe and from verification, or
	// every real block-backed migration fails on a phantom difference.
	assert.Contains(t, runnable, "! -name lost+found")
	assert.Contains(t, runnable, "! -path ./lost+found")
	require.Len(t, job.Spec.Template.Spec.Volumes, 2)
	src := job.Spec.Template.Spec.Volumes[0]
	assert.Equal(t, "home-agent-my-agent-0", src.PersistentVolumeClaim.ClaimName)
	assert.True(t, src.PersistentVolumeClaim.ReadOnly, "source mounts read-only")
	dst := job.Spec.Template.Spec.Volumes[1]
	assert.Equal(t, "mig-home-agent-my-agent-0", dst.PersistentVolumeClaim.ClaimName)
	assert.False(t, dst.PersistentVolumeClaim.ReadOnly)
	assert.NotContains(t, job.Spec.Template.Labels, LabelAgent,
		"the copy pod must be invisible to the pod-IP resolver and idle checker")
}

// A succeeded copy Job flips the agent: the target becomes the labeled
// workspace volume, the source is deleted, the StatefulSet is gone so the
// reconciler re-renders against the claim, and the gate lifts with a fresh
// activity stamp for the previously-running agent.
func TestStorageMigration_FlipOnJobSuccess(t *testing.T) {
	agent := agentCR()
	agent.Annotations = map[string]string{
		annStorageMigration:           "migrating",
		annStorageMigrationWasRunning: "true",
	}
	target := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name: "mig-home-agent-my-agent-0", Namespace: "test-agents",
			Labels: map[string]string{
				LabelPool: migrationPoolValue, LabelMount: "home-agent",
				LabelMigrationFor: "my-agent",
			},
		},
		Spec: corev1.PersistentVolumeClaimSpec{
			AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce},
		},
	}
	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{Name: "mig-my-agent", Namespace: "test-agents"},
		Status: batchv1.JobStatus{Conditions: []batchv1.JobCondition{
			{Type: batchv1.JobComplete, Status: corev1.ConditionTrue},
		}},
	}
	sts := renderedAgentSTS("my-agent")
	m, client := migrationManager(t, agent,
		rwxPVC("home-agent-my-agent-0", "my-agent", "home-agent"), target, job, sts)

	m.Reconcile(context.Background())

	flipped, err := client.CoreV1().PersistentVolumeClaims("test-agents").Get(context.Background(), "mig-home-agent-my-agent-0", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "my-agent", flipped.Labels[LabelAgent], "target claimed at flip")
	assert.NotContains(t, flipped.Labels, LabelMigrationFor)

	_, err = client.CoreV1().PersistentVolumeClaims("test-agents").Get(context.Background(), "home-agent-my-agent-0", metav1.GetOptions{})
	assert.True(t, err != nil, "source volume deleted at flip (checksum-verified copy)")

	_, err = client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "my-agent", metav1.GetOptions{})
	assert.True(t, err != nil, "stale StatefulSet deleted so the claim re-renders")

	_, err = client.BatchV1().Jobs("test-agents").Get(context.Background(), "mig-my-agent", metav1.GetOptions{})
	assert.True(t, err != nil, "finished copy job deleted")

	ann := getAgentAnnotations(t, m, "my-agent")
	assert.Empty(t, ann[annStorageMigration], "gate lifted")
	assert.Empty(t, ann[annStorageMigrationWasRunning])
	assert.NotEmpty(t, ann[annLastActivity], "previously-running agent gets a wake stamp")
}

// An agent that was hibernated when migration started is NOT woken at flip.
func TestStorageMigration_HibernatedAgentStaysDown(t *testing.T) {
	agent := agentCR()
	agent.Annotations = map[string]string{
		annStorageMigration:           "migrating",
		annStorageMigrationWasRunning: "false",
	}
	target := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name: "mig-home-agent-my-agent-0", Namespace: "test-agents",
			Labels: map[string]string{
				LabelPool: migrationPoolValue, LabelMount: "home-agent",
				LabelMigrationFor: "my-agent",
			},
		},
	}
	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{Name: "mig-my-agent", Namespace: "test-agents"},
		Status: batchv1.JobStatus{Conditions: []batchv1.JobCondition{
			{Type: batchv1.JobComplete, Status: corev1.ConditionTrue},
		}},
	}
	m, _ := migrationManager(t, agent, rwxPVC("home-agent-my-agent-0", "my-agent", "home-agent"), target, job)

	m.Reconcile(context.Background())

	ann := getAgentAnnotations(t, m, "my-agent")
	assert.Empty(t, ann[annStorageMigration])
	assert.Empty(t, ann[annLastActivity], "hibernated agent gets no wake stamp")
}

// A crash after the flip's label moves but before the gate lifted resumes
// through the no-RWX-left branch: superseded sources are swept and the gate
// cleared.
func TestStorageMigration_ResumesInterruptedFlip(t *testing.T) {
	agent := agentCR()
	agent.Annotations = map[string]string{
		annStorageMigration:           "migrating",
		annStorageMigrationWasRunning: "false",
	}
	// The target is already claimed; the source is stripped + superseded.
	claimedTarget := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name: "mig-home-agent-my-agent-0", Namespace: "test-agents",
			Labels: map[string]string{
				LabelPool: migrationPoolValue, LabelMount: "home-agent", LabelAgent: "my-agent",
			},
			Annotations: map[string]string{},
		},
		Spec: corev1.PersistentVolumeClaimSpec{
			AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce},
		},
	}
	superseded := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name: "home-agent-my-agent-0", Namespace: "test-agents",
			Labels: map[string]string{LabelMigrationSuperseded: "my-agent"},
		},
		Spec: corev1.PersistentVolumeClaimSpec{
			AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteMany},
		},
	}
	m, client := migrationManager(t, agent, claimedTarget, superseded)

	m.Reconcile(context.Background())

	_, err := client.CoreV1().PersistentVolumeClaims("test-agents").Get(context.Background(), "home-agent-my-agent-0", metav1.GetOptions{})
	assert.True(t, err != nil, "superseded source swept on resume")
	ann := getAgentAnnotations(t, m, "my-agent")
	assert.Empty(t, ann[annStorageMigration], "gate lifted on resume")
}

// RWO agents are untouched: no annotation, no jobs, no volumes.
func TestStorageMigration_IgnoresRWOAgents(t *testing.T) {
	agent := agentCR()
	rwo := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name: "home-agent-my-agent-0", Namespace: "test-agents",
			Labels: map[string]string{LabelAgent: "my-agent", LabelMount: "home-agent"},
		},
		Spec: corev1.PersistentVolumeClaimSpec{
			AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce},
		},
	}
	m, client := migrationManager(t, agent, rwo)

	m.Reconcile(context.Background())

	ann := getAgentAnnotations(t, m, "my-agent")
	assert.Empty(t, ann[annStorageMigration])
	jobs, err := client.BatchV1().Jobs("test-agents").List(context.Background(), metav1.ListOptions{})
	require.NoError(t, err)
	assert.Empty(t, jobs.Items)
}

// The concurrency cap admits new migrations only up to the limit; in-flight
// ones always progress.
func TestStorageMigration_ConcurrencyCap(t *testing.T) {
	agents := []*apiv1.Agent{}
	var objs []runtime.Object
	for _, name := range []string{"agent-a", "agent-b", "agent-c"} {
		a := agentCR()
		a.Name = name
		agents = append(agents, a)
		objs = append(objs, rwxPVC("home-agent-"+name+"-0", name, "home-agent"))
	}
	client := fake.NewSimpleClientset(objs...)
	var dynObjs []runtime.Object
	for _, a := range agents {
		u, err := agentToUnstructured(a)
		require.NoError(t, err)
		dynObjs = append(dynObjs, u)
	}
	cfg := migrationConfig()
	cfg.StorageMigration.Concurrency = 2
	m := NewStorageMigrationManager(client, newFakeDynamic(dynObjs...), cfg)
	m.now = func() time.Time { return time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC) }

	m.Reconcile(context.Background())

	gated := 0
	for _, name := range []string{"agent-a", "agent-b", "agent-c"} {
		obj, err := m.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(context.Background(), name, metav1.GetOptions{})
		require.NoError(t, err)
		if obj.GetAnnotations()[annStorageMigration] != "" {
			gated++
		}
	}
	assert.Equal(t, 2, gated, "only Concurrency agents admitted per pass")
}

// A vm-backend agent is skipped (the flip cannot re-point its by-name PVC
// references) — no gate, no job.
func TestStorageMigration_SkipsVMBackend(t *testing.T) {
	agent := agentCR()
	agent.Spec.Backend = &apiv1.Backend{Type: "vm"}
	m, client := migrationManager(t, agent, rwxPVC("home-agent-my-agent-0", "my-agent", "home-agent"))

	m.Reconcile(context.Background())

	ann := getAgentAnnotations(t, m, "my-agent")
	assert.Empty(t, ann[annStorageMigration])
	jobs, err := client.BatchV1().Jobs("test-agents").List(context.Background(), metav1.ListOptions{})
	require.NoError(t, err)
	assert.Empty(t, jobs.Items)
}

// renderedAgentSTS is a minimal StatefulSet standing in for the reconciler's
// rendered object (only its existence matters to the flip).
func renderedAgentSTS(name string) *appsv1.StatefulSet {
	return &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: "test-agents"},
	}
}

func ptrInt64(v int64) *int64 { return &v }

// Turning the migration off must not strand the agents it had already gated:
// the gate is a negative override only this manager clears, so a disabled
// manager releases them, bins the half-copied targets, and leaves each agent
// on the volume it never left.
func TestStorageMigration_DisabledReleasesGatedAgents(t *testing.T) {
	agent := agentCR()
	agent.Annotations = map[string]string{
		annStorageMigration:           "migrating",
		annStorageMigrationWasRunning: "true",
	}
	target := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name: "mig-home-agent-my-agent-0", Namespace: "test-agents",
			Labels: map[string]string{
				LabelPool: migrationPoolValue, LabelMount: "home-agent",
				LabelMigrationFor: "my-agent",
			},
		},
	}
	job := &batchv1.Job{ObjectMeta: metav1.ObjectMeta{
		Name: "mig-my-agent", Namespace: "test-agents",
		Labels: map[string]string{LabelMigrationFor: "my-agent"},
	}}
	source := rwxPVC("home-agent-my-agent-0", "my-agent", "home-agent")
	m, client := migrationManager(t, agent, source, target, job)
	m.config.StorageMigration.Enabled = false

	m.RunLoop(context.Background())

	ann := getAgentAnnotations(t, m, "my-agent")
	assert.Empty(t, ann[annStorageMigration], "the gate must be lifted so the agent can run again")
	assert.NotEmpty(t, ann[annLastActivity], "an agent that was running is woken back up")

	_, err := client.CoreV1().PersistentVolumeClaims("test-agents").Get(context.Background(), "home-agent-my-agent-0", metav1.GetOptions{})
	require.NoError(t, err, "the source volume is untouched — nothing was copied, nothing is deleted")
	_, err = client.CoreV1().PersistentVolumeClaims("test-agents").Get(context.Background(), "mig-home-agent-my-agent-0", metav1.GetOptions{})
	assert.Error(t, err, "the half-copied target is binned")
	_, err = client.BatchV1().Jobs("test-agents").Get(context.Background(), "mig-my-agent", metav1.GetOptions{})
	assert.Error(t, err, "the abandoned copy job is binned")
}
