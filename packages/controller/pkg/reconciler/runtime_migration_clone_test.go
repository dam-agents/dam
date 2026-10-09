// TEST_OVERVIEW: a runtime migration copies a home volume that only one node can attach from a CSI clone cut for each attempt, so a copy pod never waits on the node the old pod ran on, and the clones go with the attempt, the migration and the Agent. A copy pod that never starts gives its attempt up after the start grace, rather than holding the migration until the Job's deadline.
package reconciler

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	k8stypes "k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

// UNIT_BOUNDARY_DESCRIPTION: a single-node home volume bound to a PersistentVolume, served by a CSI driver when `csi` is set.
func boundBlockHome(t *testing.T, r *AgentReconciler, csi bool) *corev1.PersistentVolumeClaim {
	t.Helper()
	pvc := blockHome()
	class := "ceph-rbd"
	pvc.Spec.StorageClassName = &class
	pvc.Spec.VolumeName = "pvc-1"
	pvc.Spec.Resources.Requests = corev1.ResourceList{corev1.ResourceStorage: resource.MustParse("10Gi")}
	pvc.Status.Capacity = corev1.ResourceList{corev1.ResourceStorage: resource.MustParse("12Gi")}
	pv := &corev1.PersistentVolume{ObjectMeta: metav1.ObjectMeta{Name: "pvc-1"}}
	if csi {
		pv.Spec.CSI = &corev1.CSIPersistentVolumeSource{Driver: "rbd.csi.ceph.com", VolumeHandle: "h"}
	} else {
		pv.Spec.HostPath = &corev1.HostPathVolumeSource{Path: "/data"}
	}
	_, err := r.client.CoreV1().PersistentVolumes().Create(context.Background(), pv, metav1.CreateOptions{})
	require.NoError(t, err)
	return pvc
}

// UNIT_BOUNDARY_DESCRIPTION: starts the copy of a migrating Agent whose home is the given volume, after `configure` has set the install up.
func startCopyOf(t *testing.T, csi bool, configure func(*AgentReconciler)) (*AgentReconciler, *batchv1.Job) {
	t.Helper()
	ctx := context.Background()
	agent := copyingAgentCR()
	r, node, _ := setupMigrationReconciler(t, agent)
	configure(r)
	createAll(t, r, boundBlockHome(t, r, csi))
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped, Port: 31000})
	require.NoError(t, r.Reconcile(ctx, agent))
	job, err := r.client.BatchV1().Jobs("test-agents").Get(ctx, runtimeMigrationJobName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err)
	return r, job
}

func copyClaim(job *batchv1.Job) string {
	for _, v := range job.Spec.Template.Spec.Volumes {
		if v.Name == "home" && v.PersistentVolumeClaim != nil {
			return v.PersistentVolumeClaim.ClaimName
		}
	}
	return ""
}

func migrationClones(t *testing.T, r *AgentReconciler) []corev1.PersistentVolumeClaim {
	t.Helper()
	list, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").List(context.Background(), metav1.ListOptions{LabelSelector: LabelRuntimeMigrationCloneFor + "=my-agent"})
	require.NoError(t, err)
	return list.Items
}

// TEST_SCENARIO: a single-node CSI home is read through a clone of it: a claim of the same class, mode and size that names the home as its data source, owned by the Agent and labelled so that nothing takes it for the Agent's own volume. The copy reads the clone read-only, and once the copy has landed the clone is deleted.
func TestASingleNodeHomeIsCopiedFromAClone(t *testing.T) {
	ctx := context.Background()
	r, job := startCopyOf(t, true, func(*AgentReconciler) {})

	clones := migrationClones(t, r)
	require.Len(t, clones, 1)
	clone := clones[0]
	assert.Equal(t, "rtmc-my-agent-1", clone.Name)
	assert.Equal(t, clone.Name, copyClaim(job))
	require.NotNil(t, clone.Spec.DataSource)
	assert.Equal(t, corev1.TypedLocalObjectReference{Kind: "PersistentVolumeClaim", Name: "home-agent-my-agent-0"}, *clone.Spec.DataSource)
	assert.Equal(t, "ceph-rbd", *clone.Spec.StorageClassName)
	assert.Equal(t, []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce}, clone.Spec.AccessModes)
	size := clone.Spec.Resources.Requests[corev1.ResourceStorage]
	assert.Equal(t, "12Gi", size.String(), "a clone is never smaller than the volume it is cut from")
	require.Len(t, clone.OwnerReferences, 1)
	assert.Equal(t, "my-agent", clone.OwnerReferences[0].Name)
	assert.NotContains(t, clone.Labels, LabelAgent)
	assert.NotContains(t, clone.Labels, LabelMount)
	assert.NotContains(t, clone.Labels, LabelMigrationFor)
	for _, v := range job.Spec.Template.Spec.Volumes {
		if v.Name == "home" {
			assert.True(t, v.PersistentVolumeClaim.ReadOnly)
		}
	}

	completeCopy(t, r, testSeedAnnotation(t))
	require.NoError(t, r.Reconcile(ctx, reloaded(t, r, copyingAgentCR())))
	assert.Empty(t, migrationClones(t, r), "the clone goes once the copy has landed")
	_, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Get(ctx, "home-agent-my-agent-0", metav1.GetOptions{})
	assert.NoError(t, err, "the home itself stays")
}

func TestACopyReusesOnlyALiveCloneOwnedByItsAgent(t *testing.T) {
	for _, state := range []string{"live", "deleting", "earlier agent", "unowned"} {
		t.Run(state, func(t *testing.T) {
			ctx := context.Background()
			agent := copyingAgentCR()
			old := &corev1.PersistentVolumeClaim{ObjectMeta: metav1.ObjectMeta{
				Name: "rtmc-my-agent-1", Namespace: "test-agents",
				OwnerReferences: []metav1.OwnerReference{agentOwnerRef(agent)},
			}}
			switch state {
			case "deleting":
				old.DeletionTimestamp = new(metav1.Now())
				old.Finalizers = []string{"kubernetes.io/pvc-protection"}
			case "earlier agent":
				old.OwnerReferences[0].UID = "earlier-agent"
			case "unowned":
				old.OwnerReferences = nil
			}
			r, job := startCopyOf(t, true, func(r *AgentReconciler) {
				createAll(t, r, old)
				r.client.(*fake.Clientset).PrependReactor("create", "persistentvolumeclaims", func(action k8stesting.Action) (bool, runtime.Object, error) {
					claim := action.(k8stesting.CreateAction).GetObject().(*corev1.PersistentVolumeClaim)
					if claim.Name == "" && claim.GenerateName != "" {
						claim.Name = claim.GenerateName + "fresh"
					}
					return false, nil, nil
				})
			})
			pvcs := r.client.CoreV1().PersistentVolumeClaims("test-agents")
			claim, err := pvcs.Get(ctx, copyClaim(job), metav1.GetOptions{})
			require.NoError(t, err)
			assert.True(t, ownedBy(claim, agent))
			assert.Nil(t, claim.DeletionTimestamp)
			if state == "live" {
				assert.Equal(t, old.Name, claim.Name)
			} else {
				assert.NotEqual(t, old.Name, claim.Name)
				require.NotNil(t, claim.Spec.DataSource)
				assert.Equal(t, "home-agent-my-agent-0", claim.Spec.DataSource.Name)
				assert.Equal(t, agent.Name, claim.Labels[LabelRuntimeMigrationCloneFor])
			}
			unchanged, err := pvcs.Get(ctx, old.Name, metav1.GetOptions{})
			require.NoError(t, err)
			assert.Equal(t, old, unchanged)
		})
	}
}

// TEST_SCENARIO: a volume no CSI driver serves cannot be cloned, and an install that turns cloning off reads every volume in place; neither cuts a clone.
func TestAHomeIsReadInPlaceWhenItCannotOrMayNotBeCloned(t *testing.T) {
	for name, tc := range map[string]struct {
		csi       bool
		configure func(*AgentReconciler)
	}{
		"not CSI": {csi: false, configure: func(*AgentReconciler) {}},
		"cloning off": {csi: true, configure: func(r *AgentReconciler) {
			r.config.VM.RuntimeMigration.CloneSource = new(false)
		}},
	} {
		t.Run(name, func(t *testing.T) {
			r, job := startCopyOf(t, tc.csi, tc.configure)
			assert.Equal(t, "home-agent-my-agent-0", copyClaim(job))
			assert.Empty(t, migrationClones(t, r))
		})
	}
}

// TEST_SCENARIO: a copy pod held on Multi-Attach waits through the start grace with the reason shown. After it, the attempt is given up — its Job and clone deleted, the reason said with the retry — and the next attempt reads a fresh clone of its own. Once the attempts are spent the migration fails with that reason.
func TestACopyPodThatNeverStartsIsCutOff(t *testing.T) {
	ctx := context.Background()
	r, job := startCopyOf(t, true, func(*AgentReconciler) {})
	agent := copyingAgentCR()
	stuck := func(job *batchv1.Job, age time.Duration) {
		t.Helper()
		job.CreationTimestamp = metav1.NewTime(time.Now().Add(-age))
		_, err := r.client.BatchV1().Jobs("test-agents").Update(ctx, job, metav1.UpdateOptions{})
		require.NoError(t, err)
		pod := &corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{Name: job.Name + "-" + copyClaim(job), Namespace: "test-agents", UID: k8stypes.UID(copyClaim(job)), Labels: map[string]string{batchv1.JobNameLabel: job.Name}},
			Status:     corev1.PodStatus{Phase: corev1.PodPending},
		}
		_, err = r.client.CoreV1().Pods("test-agents").Create(ctx, pod, metav1.CreateOptions{})
		require.NoError(t, err)
		_, err = r.client.CoreV1().Events("test-agents").Create(ctx, &corev1.Event{
			ObjectMeta:     metav1.ObjectMeta{Name: pod.Name + ".a", Namespace: "test-agents"},
			InvolvedObject: corev1.ObjectReference{Kind: "Pod", Name: pod.Name, UID: pod.UID},
			Type:           corev1.EventTypeWarning, Reason: "FailedAttachVolume",
			Message:       "Multi-Attach error for volume \"pvc-1\"",
			LastTimestamp: metav1.Now(),
		}, metav1.CreateOptions{})
		require.NoError(t, err)
	}
	jobs := r.client.BatchV1().Jobs("test-agents")

	stuck(job, runtimeMigrationStartGrace/2)
	require.NoError(t, r.Reconcile(ctx, reloaded(t, r, agent)))
	_, err := jobs.Get(ctx, job.Name, metav1.GetOptions{})
	require.NoError(t, err, "a pod still inside the grace keeps waiting")
	assert.Contains(t, migrationMessage(t, r, agent), "FailedAttachVolume")

	for attempt := 1; attempt <= runtimeMigrationMaxAttempts; attempt++ {
		job, err = jobs.Get(ctx, job.Name, metav1.GetOptions{})
		require.NoError(t, err)
		if attempt > 1 {
			stuck(job, 2*runtimeMigrationStartGrace)
		} else {
			job.CreationTimestamp = metav1.NewTime(time.Now().Add(-2 * runtimeMigrationStartGrace))
			_, err = jobs.Update(ctx, job, metav1.UpdateOptions{})
			require.NoError(t, err)
		}
		require.NoError(t, r.Reconcile(ctx, reloaded(t, r, agent)))
		_, err = jobs.Get(ctx, job.Name, metav1.GetOptions{})
		assert.True(t, k8serrors.IsNotFound(err), "attempt %d's Job is given up", attempt)
		assert.Empty(t, migrationClones(t, r), "attempt %d's clone goes with it", attempt)
		msg := migrationMessage(t, r, agent)
		assert.Contains(t, msg, "the copy pod did not start within 10m0s")
		assert.Contains(t, msg, "FailedAttachVolume")
		if attempt == runtimeMigrationMaxAttempts {
			requirePhase(t, reloaded(t, r, agent), apiv1.ReasonRuntimeMigrationFailed)
			assert.Contains(t, msg, "gave up after 3 attempts")
			break
		}
		assert.Contains(t, msg, "retrying (attempt "+string(rune('0'+attempt))+" of 3)")
		require.NoError(t, r.Reconcile(ctx, reloaded(t, r, agent)))
		job, err = jobs.Get(ctx, job.Name, metav1.GetOptions{})
		require.NoError(t, err, "the next attempt starts")
		assert.Equal(t, "rtmc-my-agent-"+string(rune('1'+attempt)), copyClaim(job), "and reads a clone of its own")
	}
}
