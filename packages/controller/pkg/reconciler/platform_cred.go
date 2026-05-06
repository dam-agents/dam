package reconciler

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// Per-instance platform credential. The agent pod has no admitted route to
// the api-server's harness port without going through the paired gateway
// pod (ADR-038); the gateway pod's Envoy attaches this credential as an
// `Authorization` header on platform-bound requests. The harness process,
// running in the agent pod, never sees the token.
//
// Lifecycle (issue #108):
//   - Reconciler ensures a Secret named `<pair>-platform-cred` containing the
//     raw token in the SDS YAML format Envoy reads.
//   - Reconciler stamps SHA256(token) on the instance/fork ConfigMap status
//     so the api-server validates without reading Secret bytes.
//   - K8s GC removes the Secret when the owning ConfigMap is deleted (owner
//     reference set on create).
//
// No rotation in this iteration — instance lifetimes are short relative to
// any reasonable rotation cadence (issue #108 §Out of scope).

const (
	// platformCredSecretSuffix is appended to the pair key to produce the
	// per-instance / per-fork credential Secret name.
	platformCredSecretSuffix = "-platform-cred"
	// platformCredTokenKey is the K8s Secret data key holding the raw token.
	// Read by the controller on every reconcile to keep the status hash in
	// sync; never read by the api-server.
	platformCredTokenKey = "token"
	// platformCredSDSKey is the SDS DiscoveryResponse YAML the gateway's
	// Envoy reads via path_config_source. Mirrors the per-credential SDS
	// scheme already in place for upstream credentials.
	platformCredSDSKey = "sds.yaml"
	// platformCredSDSName is the SDS resource name produced inside sds.yaml.
	// Referenced from the Envoy bootstrap's credential_injector filter.
	platformCredSDSName = "platform_credential"
	// platformCredHeaderValuePrefix is prepended to the raw token in the SDS
	// payload — Envoy injects the resulting full string verbatim under the
	// configured header. Keeps wire shape `Authorization: PlatformInstance <token>`
	// recognisable in tcpdumps and api-server logs.
	platformCredHeaderValuePrefix = "PlatformInstance "
)

// PlatformCredSecretName is the per-pair Secret holding the raw platform
// credential. Mounted only into the gateway pod.
func PlatformCredSecretName(pairKey string) string {
	return pairKey + platformCredSecretSuffix
}

// PlatformCredVolumeName is the pod-level volume name backing the platform
// credential Secret on the gateway pod.
func PlatformCredVolumeName() string {
	return "platform-cred"
}

// PlatformCredMountPath is where the gateway pod mounts the platform
// credential Secret. Envoy's credential_injector filter reads
// `<mount>/sds.yaml` via path_config_source.
func PlatformCredMountPath() string {
	return envoyCredentialsRoot + "/" + PlatformCredVolumeName()
}

// HashPlatformCred returns the hex-encoded SHA256 of the raw token. Stamped
// on the owning ConfigMap's status; the api-server compares this against
// SHA256 of the incoming Authorization header (after stripping the
// `PlatformInstance ` prefix) to validate.
func HashPlatformCred(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// EnsurePlatformCredSecret returns the existing Secret's token if one is
// already present, otherwise mints a fresh 32-byte random token and creates
// the Secret. Owner-referenced to `ownerCM` so K8s GC removes the Secret
// when the owning ConfigMap is deleted.
//
// The Secret carries two keys:
//   - `token`: the raw token (the controller reads this on subsequent
//     reconciles so it can re-stamp the status hash without minting a new
//     credential).
//   - `sds.yaml`: an Envoy SDS DiscoveryResponse holding the header value
//     `PlatformInstance <token>` for the credential_injector filter to read.
func EnsurePlatformCredSecret(
	ctx context.Context,
	client kubernetes.Interface,
	namespace, pairKey string,
	ownerCM *corev1.ConfigMap,
) (string, error) {
	secretName := PlatformCredSecretName(pairKey)

	existing, err := client.CoreV1().Secrets(namespace).Get(ctx, secretName, metav1.GetOptions{})
	if err == nil {
		token := string(existing.Data[platformCredTokenKey])
		if token != "" {
			return token, nil
		}
		// Secret exists but is malformed (missing token key) — recreate it.
		// Safer than carrying on with a half-empty Secret because Envoy's
		// SDS would fail to load and the gateway pod would loop on startup.
		if err := client.CoreV1().Secrets(namespace).Delete(ctx, secretName, metav1.DeleteOptions{}); err != nil && !errors.IsNotFound(err) {
			return "", fmt.Errorf("deleting malformed platform-cred secret %q: %w", secretName, err)
		}
	} else if !errors.IsNotFound(err) {
		return "", fmt.Errorf("reading platform-cred secret %q: %w", secretName, err)
	}

	token, err := mintPlatformCredToken()
	if err != nil {
		return "", err
	}

	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      secretName,
			Namespace: namespace,
			Labels: map[string]string{
				LabelPair:                  pairKey,
				"agent-platform.ai/managed-by": "controller",
				"agent-platform.ai/secret-type": "platform-cred",
			},
			OwnerReferences: []metav1.OwnerReference{
				*metav1.NewControllerRef(ownerCM, corev1.SchemeGroupVersion.WithKind("ConfigMap")),
			},
		},
		Type: corev1.SecretTypeOpaque,
		Data: map[string][]byte{
			platformCredTokenKey: []byte(token),
			platformCredSDSKey:   []byte(renderPlatformCredSDS(token)),
		},
	}
	if _, err := client.CoreV1().Secrets(namespace).Create(ctx, secret, metav1.CreateOptions{}); err != nil {
		// Tolerate the racing-reconciler case: another replica got there
		// first. Re-read and return whatever token landed.
		if errors.IsAlreadyExists(err) {
			cur, gerr := client.CoreV1().Secrets(namespace).Get(ctx, secretName, metav1.GetOptions{})
			if gerr != nil {
				return "", fmt.Errorf("reading concurrently-created platform-cred secret %q: %w", secretName, gerr)
			}
			tok := string(cur.Data[platformCredTokenKey])
			if tok == "" {
				return "", fmt.Errorf("platform-cred secret %q exists but has no token data", secretName)
			}
			return tok, nil
		}
		return "", fmt.Errorf("creating platform-cred secret %q: %w", secretName, err)
	}
	return token, nil
}

func mintPlatformCredToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("minting platform-cred token: %w", err)
	}
	// URL-safe so tcpdumps and logs stay greppable; 32 bytes → 43 chars.
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// renderPlatformCredSDS emits the SDS DiscoveryResponse YAML the gateway's
// Envoy reads via path_config_source. The credential_injector filter
// references this by `name: platform_credential` and copies the inline
// string into the configured request header verbatim (no upstream prefix
// template; envoyproxy/envoy#37001).
//
// Mirror of the rendering shape `sdsYamlContent` produces in the
// api-server's `secrets/infrastructure/k8s-secrets-port.ts` for upstream
// credentials — only the SDS resource name differs so the bootstrap can
// reference both.
func renderPlatformCredSDS(token string) string {
	// JSON encode so any byte in the token (e.g. quotes, backslashes) is
	// safe to embed inside the YAML scalar. JSON is valid YAML.
	jsonValue := jsonString(platformCredHeaderValuePrefix + token)
	return fmt.Sprintf(`resources:
- "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.Secret
  name: %s
  generic_secret:
    secret:
      inline_string: %s
`, platformCredSDSName, jsonValue)
}

// jsonString returns a minimal JSON-encoded string literal — same effect as
// `encoding/json.Marshal` on a string but without the import + error path.
// Only escapes `"` and `\` plus control characters, matching the api-server
// helper's behavior closely enough that diffs are obvious.
func jsonString(s string) string {
	out := []byte{'"'}
	for _, r := range s {
		switch r {
		case '"':
			out = append(out, '\\', '"')
		case '\\':
			out = append(out, '\\', '\\')
		case '\n':
			out = append(out, '\\', 'n')
		case '\r':
			out = append(out, '\\', 'r')
		case '\t':
			out = append(out, '\\', 't')
		default:
			if r < 0x20 {
				out = append(out, []byte(fmt.Sprintf("\\u%04x", r))...)
			} else {
				out = append(out, []byte(string(r))...)
			}
		}
	}
	return string(append(out, '"'))
}
