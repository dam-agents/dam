package reconciler

import (
	corev1 "k8s.io/api/core/v1"

	"github.com/kagenti/platform/packages/controller/pkg/types"
)

const cloneRepoInitContainerName = "clone-repo"

// cloneRepoScript clones REPO_URL into $HOME/work once, before the agent's
// first run. It is idempotent: init containers re-run on every pod (re)start,
// so it skips when the working directory is already populated (the clone
// persists on the $HOME PVC).
//
// A failed clone must NOT leave a half-written tree behind: the idempotency
// check would then treat the partial as "done" and the agent would silently
// start on a broken repo. So we remove $HOME/work on any failure (EXIT trap,
// cleared on success), letting the next pod restart retry from scratch. The
// non-zero exit still stops the pod in init and surfaces in the agent status.
const cloneRepoScript = `set -e
work="$HOME/work"
if [ -n "$(ls -A "$work" 2>/dev/null)" ]; then
	echo "clone-repo: $work already populated, skipping"
	exit 0
fi
echo "clone-repo: cloning $REPO_URL into $work"
trap 'rm -rf "$work"' EXIT
git clone "$REPO_URL" "$work"
trap - EXIT
`

// buildCloneRepoInitContainer returns a harness-agnostic init container that
// seeds the agent's working directory from a public git repo. Returns nil when
// no workspace repo is requested.
//
// It reuses the agent image with its default entrypoint (Args, not Command) so
// the image's CA-trust shim runs and git trusts the gateway's MITM CA on top of
// the public CAs. The caller's env (proxy + CA + HOME) and volumeMounts (the
// $HOME PVC + ca-cert) are reused verbatim — the repo URL is passed via env to
// keep it out of the shell string.
func buildCloneRepoInitContainer(agentSpec *types.AgentSpec, pullPolicy string, env []corev1.EnvVar, volumeMounts []corev1.VolumeMount) *corev1.Container {
	// Only a git source with a repo URL triggers a clone. A non-git source
	// (no Repo) is handled elsewhere, so it leaves this init container off.
	ws := agentSpec.Workspace
	if ws == nil || ws.Source == nil || ws.Source.Repo == "" {
		return nil
	}
	src := ws.Source
	return &corev1.Container{
		Name:            cloneRepoInitContainerName,
		Image:           agentSpec.Image,
		ImagePullPolicy: corev1.PullPolicy(pullPolicy),
		Args:            []string{"sh", "-c", cloneRepoScript},
		Env:             append([]corev1.EnvVar{{Name: "REPO_URL", Value: src.Repo}}, env...),
		VolumeMounts:    volumeMounts,
	}
}
