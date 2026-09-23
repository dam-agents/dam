package vmrunner

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const goodAuth = `{"auths":{"quay.io":{"auth":"Z29vZA=="}}}`

const testDigest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

// UNIT_BOUNDARY_DESCRIPTION: a crane in front of a registry that serves an image only to one credential, or to anyone when that credential is empty. It logs each call with the docker config crane was given, and the directory that config was in, so a test can see which credential reached which call and that the directory was gone afterwards.
func registryCrane(log, needs string) string {
	return "#!/bin/sh\n" +
		"auth=''; [ -n \"$DOCKER_CONFIG\" ] && auth=$(cat \"$DOCKER_CONFIG/config.json\")\n" +
		"echo \"$1 dir=$DOCKER_CONFIG auth=$auth\" >> " + log + "\n" +
		"if [ -n '" + needs + "' ] && [ \"$auth\" != '" + needs + "' ]; then echo 'UNAUTHORIZED: authentication required' >&2; exit 1; fi\n" +
		"case \"$1\" in\n" +
		"  digest) echo '" + testDigest + "'; exit 0 ;;\n" +
		"  config) printf '{\"config\":{\"Entrypoint\":[\"/entry\"],\"Cmd\":[\"serve\"]}}'; exit 0 ;;\n" +
		"esac\n" +
		"d=$(mktemp -d); echo rootfs > \"$d/hello\"; tar -cf - -C \"$d\" .\n"
}

const staleAuth = `{"auths":{"quay.io":{"auth":"c3RhbGU="}}}`

func withAuth(auths ...string) MachineSpec {
	s := spec(true)
	s.PullAuths = auths
	return s
}

func useRegistry(t *testing.T, h *harness, needs string) string {
	t.Helper()
	log := filepath.Join(t.TempDir(), "crane.log")
	crane := filepath.Join(t.TempDir(), "crane")
	require.NoError(t, os.WriteFile(crane, []byte(registryCrane(log, needs)), 0o755))
	h.node.Crane = crane
	return log
}

func readLog(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	require.NoError(t, err)
	return string(b)
}

// TEST_SCENARIO: a private image on the vm backend is fetched by the runner with the credentials the controller sent on the machine spec. crane reads them from a DOCKER_CONFIG directory made for that fetch alone, and the directory is gone once the fetch ends. The credential must never land anywhere that lasts: not in the stored spec, not on smolvm's command line or environment, and not in the guest's share.
func TestAPrivateImageIsFetchedWithTheMachinesCredentialsAndNothingKeepsThem(t *testing.T) {
	h := newHarness(t)
	log := useRegistry(t, h, goodAuth)

	_, err := h.client().Ensure(t.Context(), "agent-a", withAuth(goodAuth))
	require.NoError(t, err)
	st := h.settle(t, "agent-a")
	require.Equal(t, StateRunning, st.State, "the image was fetched with the credential: %+v", st)

	before := h.calls()
	_, err = h.client().Ensure(t.Context(), "agent-a", withAuth(goodAuth))
	require.NoError(t, err)
	assert.Equal(t, before, h.calls(), "the stored spec never holds the credential, so the next reconcile sending it again changes nothing")

	calls := readLog(t, log)
	assert.Contains(t, calls, "config dir=", "the config was read with a docker config")
	assert.Contains(t, calls, "export dir=", "and so were the layers")
	for _, line := range strings.Split(strings.TrimSpace(calls), "\n") {
		dir := strings.TrimPrefix(strings.Fields(line)[1], "dir=")
		if dir == "" {
			continue
		}
		assert.NoDirExists(t, dir, "the credential's directory lives only as long as its fetch")
		assert.False(t, strings.HasPrefix(dir, h.node.ImageDir) || strings.HasPrefix(dir, h.node.StateDir),
			"and it is never on the image cache or the state volume: %s", dir)
	}

	stored, err := os.ReadFile(filepath.Join(h.node.StateDir, "agent-a", "spec.json"))
	require.NoError(t, err)
	assert.NotContains(t, string(stored), "Z29vZA==", "the stored spec never holds the credential")
	assert.NotContains(t, string(stored), "pullAuth")
	assert.NotContains(t, h.calls(), "Z29vZA==", "smolvm is never handed it")
	err = filepath.Walk(filepath.Join(h.node.StateDir, "agent-a", shareDir), func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}
		body, readErr := os.ReadFile(path)
		require.NoError(t, readErr)
		assert.NotContains(t, string(body), "Z29vZA==", "nor is the guest, through its share: %s", path)
		return nil
	})
	require.NoError(t, err)
}

// TEST_SCENARIO: a node cache is shared by every owner's runner on the node. If owner A's credentials fetched a private image into it, owner B could boot that image just by naming the same reference, without any credential for it. So an entry that no anonymous read could have fetched is marked private. A machine reuses a private entry only after its own credentials read the image's manifest, and a machine with no credentials or the wrong ones is refused as an unavailable image.
func TestAPrivateCacheEntryIsReusedOnlyByAMachineThatCanReadTheImage(t *testing.T) {
	h := newHarness(t)
	log := useRegistry(t, h, goodAuth)

	_, err := h.client().Ensure(t.Context(), "agent-a", withAuth(goodAuth))
	require.NoError(t, err)
	require.Equal(t, StateRunning, h.settle(t, "agent-a").State)
	assert.FileExists(t, filepath.Join(h.node.digestPath(testDigest), privateFile),
		"an anonymous read of this image fails, so the entry is marked private")

	_, err = h.client().Ensure(t.Context(), "agent-b", withAuth(`{"auths":{"quay.io":{"auth":"d3Jvbmc="}}}`))
	require.NoError(t, err)
	st := h.settle(t, "agent-b")
	assert.Equal(t, ReasonImageUnavailable, st.Reason, "the wrong credential does not unlock the cached copy: %+v", st)
	assert.Contains(t, st.Message, "private registry")
	assert.NotContains(t, st.Message, "d3Jvbmc=", "and the refusal never quotes the credential")
	assert.Equal(t, 1, strings.Count(readLog(t, log), "export "), "the refused machine fetched nothing")
}

// TEST_SCENARIO: the check on a private entry must not cost the cache its point. A second machine whose credentials can read the image boots from the tree already unpacked, after one manifest read and no second fetch of the layers.
func TestAMachineThatCanReadAPrivateImageBootsFromTheCachedTree(t *testing.T) {
	h := newHarness(t)
	log := useRegistry(t, h, goodAuth)

	for _, id := range []string{"agent-a", "agent-b"} {
		_, err := h.client().Ensure(t.Context(), id, withAuth(goodAuth))
		require.NoError(t, err)
		require.Equal(t, StateRunning, h.settle(t, id).State)
	}

	calls := readLog(t, log)
	assert.Equal(t, 1, strings.Count(calls, "export "), "the layers were fetched once: %s", calls)
	checked := false
	for _, line := range strings.Split(calls, "\n") {
		checked = checked || (strings.HasPrefix(line, "digest ") && strings.HasSuffix(line, "auth="+goodAuth))
	}
	assert.True(t, checked, "and the second machine's own credential was checked against the registry: %s", calls)
}

// TEST_SCENARIO: most images are public, and a credential sent along with one must not make its cache entry private. That would put a registry check in front of every later boot of a harness image, for every owner. After a fetch with credentials, one anonymous read decides it, and a public entry stays reusable by a machine with no credentials at all, with no further check.
func TestAPublicImageFetchedWithCredentialsStaysPublic(t *testing.T) {
	h := newHarness(t)
	log := useRegistry(t, h, "")

	_, err := h.client().Ensure(t.Context(), "agent-a", withAuth(goodAuth))
	require.NoError(t, err)
	require.Equal(t, StateRunning, h.settle(t, "agent-a").State)
	assert.NoFileExists(t, filepath.Join(h.node.digestPath(testDigest), privateFile))

	_, err = h.client().Ensure(t.Context(), "agent-b", spec(true))
	require.NoError(t, err)
	require.Equal(t, StateRunning, h.settle(t, "agent-b").State, "anyone may boot a public entry")
	assert.Equal(t, 1, strings.Count(readLog(t, log), "auth={}\n"), "only the one anonymous read, made at fetch time, and no check for the machine without credentials")
}

// TEST_SCENARIO: the preloader fetches the harness images an install ships, and one of them may be private. It fetches with the install's default pull Secrets, read again on every pass, so a private harness image is preloaded rather than paid for by the first user who needs it.
func TestThePreloaderFetchesWithTheInstallsPullSecrets(t *testing.T) {
	dir := t.TempDir()
	log := filepath.Join(dir, "crane.log")
	crane := filepath.Join(dir, "crane")
	require.NoError(t, os.WriteFile(crane, []byte(registryCrane(log, goodAuth)), 0o755))
	p := &Preloader{
		ImageDir: filepath.Join(dir, "images"), Images: []string{"quay.io/x/vm:1"}, ID: "cache", Budget: 1 << 30, Crane: crane,
		PullAuths: func() []string { return []string{goodAuth} },
	}

	p.Sweep()

	entry := p.cache().digestPath(testDigest)
	launch, err := readLaunch(entry)
	require.NoError(t, err)
	assert.NotNil(t, launch, "the private harness image is in the cache, under the digest its tag resolved to with the install's credential")
	assert.FileExists(t, filepath.Join(entry, privateFile),
		"and marked private, so a runner reuses it only with credentials of its own")
}

// TEST_SCENARIO: the kubelet tries a pod's pull Secrets in turn, so an Agent whose own credential for a registry has gone stale still pulls with the install default for that registry. The vm backend must do the same. The fetch falls back from the stale first credential to the good one, and a second machine sent the same list may reuse the private entry because one of its credentials still reads the image.
func TestAStaleFirstCredentialFallsBackToTheNextLikeTheKubelet(t *testing.T) {
	h := newHarness(t)
	log := useRegistry(t, h, goodAuth)

	for _, id := range []string{"agent-a", "agent-b"} {
		_, err := h.client().Ensure(t.Context(), id, withAuth(staleAuth, goodAuth))
		require.NoError(t, err)
		require.Equal(t, StateRunning, h.settle(t, id).State, "%s pulls with the credential listed second", id)
	}

	calls := readLog(t, log)
	assert.Contains(t, calls, "config dir=", "the stale credential was tried")
	assert.Equal(t, 1, strings.Count(calls, "export "), "the layers were fetched once, with the credential that worked: %s", calls)
	for _, line := range strings.Split(calls, "\n") {
		if strings.HasPrefix(line, "export ") {
			assert.True(t, strings.HasSuffix(line, "auth="+goodAuth), "the layers are fetched with the credential the config read accepted: %s", line)
		}
	}
}

// TEST_SCENARIO: the private mark is written from one anonymous probe at fetch time. A timeout or a rate limit there marks a public image private, and a complete entry is never fetched again, so the mark would put a live registry in front of every later boot of that image. A machine with no credentials that then reads the manifest anonymously proves the image is public. It boots, and it clears the mark, so later boots skip the check.
func TestAnAnonymousReadClearsAPrivateMarkAFlakyProbeLeft(t *testing.T) {
	h := newHarness(t)
	log := useRegistry(t, h, "")
	entry := h.node.digestPath(testDigest)

	_, err := h.client().Ensure(t.Context(), "agent-a", spec(true))
	require.NoError(t, err)
	require.Equal(t, StateRunning, h.settle(t, "agent-a").State)
	require.NoError(t, os.WriteFile(filepath.Join(entry, privateFile), nil, 0o644), "as a failed probe would have left it")

	_, err = h.client().Ensure(t.Context(), "agent-b", spec(true))
	require.NoError(t, err)
	require.Equal(t, StateRunning, h.settle(t, "agent-b").State, "an anonymous read of the manifest lets a machine with no credentials boot")
	assert.NoFileExists(t, filepath.Join(entry, privateFile), "and the mark it proved wrong is gone")
	assert.Equal(t, 1, strings.Count(readLog(t, log), "auth={}\n"), "one anonymous manifest read, made by the check")
}

// TEST_SCENARIO: an install with default pull Secrets sends every machine a credential, so no machine ever reuses a cached entry with none. If only a machine without credentials could clear a private mark that a flaky probe left on a public image, that mark would never clear on such an install, and every boot of the image would need a live registry. The anonymous read therefore comes first for every machine, and a machine with credentials that finds the image public clears the mark too.
func TestAMachineWithCredentialsAlsoClearsAPrivateMarkAFlakyProbeLeft(t *testing.T) {
	h := newHarness(t)
	useRegistry(t, h, "")
	entry := h.node.digestPath(testDigest)

	_, err := h.client().Ensure(t.Context(), "agent-a", withAuth(goodAuth))
	require.NoError(t, err)
	require.Equal(t, StateRunning, h.settle(t, "agent-a").State)
	require.NoError(t, os.WriteFile(filepath.Join(entry, privateFile), nil, 0o644), "as a failed probe would have left it")

	_, err = h.client().Ensure(t.Context(), "agent-b", withAuth(goodAuth))
	require.NoError(t, err)
	require.Equal(t, StateRunning, h.settle(t, "agent-b").State)
	assert.NoFileExists(t, filepath.Join(entry, privateFile), "a machine that sent credentials still proved the image public, and cleared the mark")
}
