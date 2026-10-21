// TEST_OVERVIEW: the runner mounts the image cache the chart provides and dials the socket the service binds, and every cache it keeps is bounded.
package reconciler

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/dam-agents/dam/packages/controller/pkg/config"
)

// TEST_SCENARIO: images/ is the node cache the install's runners on a node share, never a directory of the runner's claim, so it gets a mount of its own, read-only, from the host directory the install names. The other two always live on the claim and are mounted by subPath, so the claim's root is never exposed.
func TestRunnerMountsTheImageCacheAsItsOwnSource(t *testing.T) {
	mounts := func(configure func(*config.VMRunnerSpec)) (map[string]corev1.VolumeMount, map[string]corev1.Volume) {
		r, _, _ := setupVMReconciler(t, vmAgentCR())
		configure(&r.config.VM.Runner)
		require.NoError(t, r.applyRunnerDeployment(context.Background(), testOwner, r.runnerOwnerRef(context.Background()), true))
		dep, err := r.client.AppsV1().Deployments("test-agents").Get(
			context.Background(), r.runnerName(testOwner), metav1.GetOptions{})
		require.NoError(t, err)
		byPath := map[string]corev1.VolumeMount{}
		for _, m := range dep.Spec.Template.Spec.Containers[0].VolumeMounts {
			byPath[m.MountPath] = m
		}
		byName := map[string]corev1.Volume{}
		for _, v := range dep.Spec.Template.Spec.Volumes {
			byName[v.Name] = v
		}
		return byPath, byName
	}

	node, volumes := mounts(func(spec *config.VMRunnerSpec) { spec.ImageCacheHostPath = "/var/lib/platform-images" })
	assert.Equal(t, "disks", node[vmRunnerDisksPath].SubPath)
	assert.Equal(t, "machines", node[vmRunnerMachinesPath].SubPath)
	assert.Empty(t, node[vmRunnerImagesPath].SubPath)
	assert.Equal(t, "image-cache", node[vmRunnerImagesPath].Name, "the node directory is its own mount rather than nesting in the claim")
	require.NotNil(t, volumes["image-cache"].HostPath, "the node cache is a host directory, not a claim of its own")
	assert.Equal(t, "/var/lib/platform-images", volumes["image-cache"].HostPath.Path)
	assert.True(t, node[vmRunnerImagesPath].ReadOnly, "the node's image cache service is the only writer of the node directory")
}

// TEST_SCENARIO: the runner reaches the node's image cache service through a socket the chart's DaemonSet binds inside the same directory. The controller and the chart each name that path, so the controller's constant must be the one the chart passes, or every runner refuses every image as unavailable.
func TestTheRunnerDialsTheSocketTheImageCacheServiceBinds(t *testing.T) {
	template, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "helm", "templates", "controller", "vm-image-cache.yaml"))
	require.NoError(t, err)
	assert.Contains(t, string(template), "- --socket="+vmImageCacheSocket+"\n")
	assert.Contains(t, string(template), "mountPath: "+vmRunnerImagesPath+"\n")

	args := func(configure func(*config.VMRunnerSpec)) []string {
		r, _, _ := setupVMReconciler(t, vmAgentCR())
		configure(&r.config.VM.Runner)
		require.NoError(t, r.applyRunnerDeployment(context.Background(), testOwner, r.runnerOwnerRef(context.Background()), true))
		dep, err := r.client.AppsV1().Deployments("test-agents").Get(
			context.Background(), r.runnerName(testOwner), metav1.GetOptions{})
		require.NoError(t, err)
		return dep.Spec.Template.Spec.Containers[0].Args
	}
	assert.Contains(t, args(func(*config.VMRunnerSpec) {}), "--image-cache-socket="+vmImageCacheSocket)
}

// TEST_SCENARIO: the node cache carries a budget, because a node directory is shared with the rest of the host and cannot be given a share of its filesystem. A budget the controller cannot read fails the reconcile rather than being replaced by a guess, which would be a cache growing until the node runs out.
func TestEveryCacheIsBounded(t *testing.T) {
	args := func(t *testing.T, configure func(*config.VMRunnerSpec)) (string, error) {
		r, _, _ := setupVMReconciler(t, vmAgentCR())
		configure(&r.config.VM.Runner)
		if err := r.applyRunnerDeployment(context.Background(), testOwner, r.runnerOwnerRef(context.Background()), true); err != nil {
			return "", err
		}
		dep, err := r.client.AppsV1().Deployments("test-agents").Get(
			context.Background(), r.runnerName(testOwner), metav1.GetOptions{})
		require.NoError(t, err)
		return strings.Join(dep.Spec.Template.Spec.Containers[0].Args, " "), nil
	}

	shared, err := args(t, func(spec *config.VMRunnerSpec) { spec.ImageCacheBudget = "20Gi" })
	require.NoError(t, err)
	assert.Contains(t, shared, fmt.Sprintf("--image-budget-bytes=%d", 20*(1<<30)))

	for _, bad := range []string{"", "plenty", "0"} {
		_, err := args(t, func(spec *config.VMRunnerSpec) { spec.ImageCacheBudget = bad })
		require.Error(t, err, "budget %q", bad)
		assert.Contains(t, err.Error(), "image cache budget")
	}
}
