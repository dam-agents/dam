package pullauth

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	corev1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	corev1client "k8s.io/client-go/kubernetes/typed/core/v1"
)

// UNIT_BOUNDARY_DESCRIPTION: the registry credentials an image is fetched with, built from pull Secrets in the order the container backend lists them on a pod — the Agent's own imagePullSecretRef first, then the install-wide defaults. A pod lists several Secrets and the kubelet tries each one. A crane fetch reads one docker config, so the Secrets are merged into one document, and a registry named by an earlier Secret keeps that Secret's credential. That is the same override-not-replace rule: the Agent's credential wins for its own registry, and the defaults still cover every other registry. A Secret that is missing, or holds no docker config it can parse, is skipped with a warning and never fails the reconcile, because the kubelet skips it too and the fetch can still work without it. Only an API error is returned, so the reconcile retries rather than fetching with less than it should. The result is empty when no Secret names a registry. The document holds the credentials themselves, so it never goes into a log or an error message; only Secret names do.
func Resolve(ctx context.Context, secrets corev1client.SecretInterface, names []string) (string, error) {
	var docs []map[string]json.RawMessage
	seen := map[string]bool{}
	for _, name := range names {
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		sec, err := secrets.Get(ctx, name, metav1.GetOptions{})
		if k8serrors.IsNotFound(err) {
			slog.Warn("image pull secret not found, fetching without it", "secret", name)
			continue
		}
		if err != nil {
			return "", fmt.Errorf("reading image pull secret %s: %w", name, err)
		}
		auths, ok := authsOf(sec)
		if !ok {
			slog.Warn("image pull secret holds no docker config, fetching without it", "secret", name)
			continue
		}
		docs = append(docs, auths)
	}
	return merge(docs)
}

func authsOf(sec *corev1.Secret) (map[string]json.RawMessage, bool) {
	if raw, ok := sec.Data[corev1.DockerConfigJsonKey]; ok {
		var doc struct {
			Auths map[string]json.RawMessage `json:"auths"`
		}
		if json.Unmarshal(raw, &doc) != nil {
			return nil, false
		}
		return doc.Auths, true
	}
	if raw, ok := sec.Data[corev1.DockerConfigKey]; ok {
		var auths map[string]json.RawMessage
		if json.Unmarshal(raw, &auths) != nil {
			return nil, false
		}
		return auths, true
	}
	return nil, false
}

func merge(docs []map[string]json.RawMessage) (string, error) {
	merged := map[string]json.RawMessage{}
	for _, auths := range docs {
		for registry, entry := range auths {
			if _, taken := merged[registry]; !taken {
				merged[registry] = entry
			}
		}
	}
	if len(merged) == 0 {
		return "", nil
	}
	out, err := json.Marshal(map[string]any{"auths": merged})
	if err != nil {
		return "", err
	}
	return string(out), nil
}
