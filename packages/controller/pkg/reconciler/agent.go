package reconciler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log/slog"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"

	"github.com/kagenti/humr/packages/controller/pkg/config"
	"github.com/kagenti/humr/packages/controller/pkg/onecli"
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

// AgentTokenSecretName returns the K8s Secret name that stores the OneCLI access token for an agent.
func AgentTokenSecretName(agentName string) string {
	return "humr-agent-" + agentName + "-token"
}

// AgentReconciler registers agents in OneCLI and stores their access tokens.
type AgentReconciler struct {
	client  kubernetes.Interface
	config  *config.Config
	factory onecli.Factory
}

func NewAgentReconciler(client kubernetes.Interface, cfg *config.Config, factory onecli.Factory) *AgentReconciler {
	return &AgentReconciler{client: client, config: cfg, factory: factory}
}

// Reconcile registers the agent in OneCLI and stores its access token.
// Secret/MCP assignment is managed from the UI via the OneCLI agent-secrets API.
func (r *AgentReconciler) Reconcile(ctx context.Context, cm *corev1.ConfigMap) error {
	name := cm.Name
	owner := cm.Labels["humr.ai/owner"]
	if owner == "" {
		return fmt.Errorf("agent %q has no humr.ai/owner label", name)
	}

	oc, err := r.factory.ClientForOwner(ctx, owner)
	if err != nil {
		return fmt.Errorf("getting OneCLI client for owner %q: %w", owner, err)
	}

	var agentSpec *types.AgentSpec
	if specYAML, ok := cm.Data["spec.yaml"]; ok {
		agentSpec, err = types.ParseAgentSpec(specYAML)
		if err != nil {
			return fmt.Errorf("parsing agent %q: %w", name, err)
		}
	}

	// Ensure agent is registered in OneCLI (one-time).
	if _, err := r.ensureAgent(ctx, cm, name, agentSpec, oc); err != nil {
		return err
	}

	return nil
}

// ensureAgent registers the agent in OneCLI if not already done.
func (r *AgentReconciler) ensureAgent(ctx context.Context, cm *corev1.ConfigMap, name string, agentSpec *types.AgentSpec, oc onecli.Client) (*onecli.Agent, error) {
	displayName := name
	if agentSpec != nil && agentSpec.Name != "" {
		displayName = agentSpec.Name
	}

	secretName := AgentTokenSecretName(name)
	if _, err := r.client.CoreV1().Secrets(r.config.Namespace).Get(ctx, secretName, metav1.GetOptions{}); err == nil {
		return nil, nil
	} else if !errors.IsNotFound(err) {
		return nil, fmt.Errorf("checking token secret: %w", err)
	}

	secretMode := "selective"
	if agentSpec != nil && agentSpec.SecretMode != "" {
		secretMode = agentSpec.SecretMode
	}

	agent, err := oc.CreateAgent(ctx, displayName, name, secretMode)
	if err != nil {
		return nil, fmt.Errorf("registering agent %q in OneCLI: %w", name, err)
	}
	slog.Info("registered agent in OneCLI", "agent", name, "agentID", agent.ID)

	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      secretName,
			Namespace: r.config.Namespace,
			Labels: map[string]string{
				"humr.ai/type":  "agent-token",
				"humr.ai/agent": name,
			},
			OwnerReferences: []metav1.OwnerReference{
				*metav1.NewControllerRef(cm, corev1.SchemeGroupVersion.WithKind("ConfigMap")),
			},
		},
		Type: corev1.SecretTypeOpaque,
		StringData: map[string]string{
			"access-token": agent.AccessToken,
		},
	}
	if _, err := r.client.CoreV1().Secrets(r.config.Namespace).Create(ctx, secret, metav1.CreateOptions{}); err != nil {
		return nil, fmt.Errorf("creating token secret: %w", err)
	}
	slog.Info("created agent token secret", "agent", name, "secret", secretName)

	hash := sha256.Sum256([]byte(agent.AccessToken))
	if err := WriteAgentStatus(ctx, r.client, r.config.Namespace, name, &AgentStatus{
		AccessTokenHash: hex.EncodeToString(hash[:]),
	}); err != nil {
		return nil, fmt.Errorf("writing agent status: %w", err)
	}

	return agent, nil
}

// Delete removes the OneCLI agent for the given owner.
func (r *AgentReconciler) Delete(ctx context.Context, name string, owner string) {
	if owner == "" {
		slog.Warn("cannot delete OneCLI agent: no owner", "agent", name)
		return
	}
	oc, err := r.factory.ClientForOwner(ctx, owner)
	if err != nil {
		slog.Error("cannot get OneCLI client for delete", "agent", name, "owner", owner, "error", err)
		return
	}
	oc.DeleteAgent(ctx, name)
}
