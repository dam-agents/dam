package reconciler

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"log/slog"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"

	"github.com/kagenti/humr/packages/controller/pkg/config"
	"github.com/kagenti/humr/packages/controller/pkg/types"
)

// AgentGetter abstracts how agents are looked up — informer lister in prod, map in tests.
type AgentGetter interface {
	Get(name string) (*corev1.ConfigMap, error)
}

type AgentResolver struct {
	getter AgentGetter
}

func NewAgentResolver(getter AgentGetter) *AgentResolver {
	return &AgentResolver{getter: getter}
}

// Resolve returns the agent's ConfigMap (for owner-reference metadata) and
// its parsed spec.
func (r *AgentResolver) Resolve(name string) (*corev1.ConfigMap, *types.AgentSpec, error) {
	cm, err := r.getter.Get(name)
	if err != nil {
		return nil, nil, fmt.Errorf("agent %q not found: %w", name, err)
	}
	specYAML, ok := cm.Data["spec.yaml"]
	if !ok {
		return nil, nil, fmt.Errorf("agent %q has no spec.yaml", name)
	}
	spec, err := types.ParseAgentSpec(specYAML)
	if err != nil {
		return nil, nil, err
	}
	return cm, spec, nil
}

// AgentTokenSecretName returns the K8s Secret name that stores the agent-runtime
// auth token (Bearer for api-server → agent-runtime tRPC).
func AgentTokenSecretName(agentName string) string {
	return "humr-agent-" + agentName + "-token"
}

// AgentReconciler ensures the agent-runtime token Secret exists for each agent.
// The Secret is owned by the agent's ConfigMap so it is GC'd on agent removal.
type AgentReconciler struct {
	client kubernetes.Interface
	config *config.Config
}

func NewAgentReconciler(client kubernetes.Interface, cfg *config.Config) *AgentReconciler {
	return &AgentReconciler{client: client, config: cfg}
}

// Reconcile ensures the agent-runtime token Secret exists.
func (r *AgentReconciler) Reconcile(ctx context.Context, cm *corev1.ConfigMap) error {
	return ensureAgentRuntimeTokenSecret(ctx, r.client, r.config.Namespace, cm, cm.Name)
}

// Delete is a no-op — the token Secret is GC'd via owner reference when the
// agent ConfigMap is deleted.
func (r *AgentReconciler) Delete(_ context.Context, _ string, _ string) {}

// ensureAgentRuntimeTokenSecret creates the per-agent token Secret on first
// sight and leaves it alone afterwards. The token authenticates api-server →
// agent-runtime tRPC calls; rotating it requires deleting the Secret.
func ensureAgentRuntimeTokenSecret(ctx context.Context, client kubernetes.Interface, namespace string, ownerCM *corev1.ConfigMap, agentName string) error {
	secretName := AgentTokenSecretName(agentName)
	if _, err := client.CoreV1().Secrets(namespace).Get(ctx, secretName, metav1.GetOptions{}); err == nil {
		return nil
	} else if !errors.IsNotFound(err) {
		return fmt.Errorf("checking token secret: %w", err)
	}

	token, err := randomToken()
	if err != nil {
		return fmt.Errorf("generating token: %w", err)
	}

	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      secretName,
			Namespace: namespace,
			Labels: map[string]string{
				"humr.ai/type":  "agent-token",
				"humr.ai/agent": agentName,
			},
			OwnerReferences: []metav1.OwnerReference{
				*metav1.NewControllerRef(ownerCM, corev1.SchemeGroupVersion.WithKind("ConfigMap")),
			},
		},
		Type: corev1.SecretTypeOpaque,
		StringData: map[string]string{
			"access-token": token,
		},
	}
	if _, err := client.CoreV1().Secrets(namespace).Create(ctx, secret, metav1.CreateOptions{}); err != nil {
		if errors.IsAlreadyExists(err) {
			return nil
		}
		return fmt.Errorf("creating token secret: %w", err)
	}
	slog.Info("created agent-runtime token secret", "agent", agentName, "secret", secretName)
	return nil
}

func randomToken() (string, error) {
	var buf [32]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf[:]), nil
}
