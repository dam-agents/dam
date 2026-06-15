package v1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// AgentSpec is the desired state of an Agent — the sole durable per-agent
// resource after ADR-046 collapsed Instance into Agent. The api-server is the
// sole writer.
//
// There is no desiredState field: running-vs-hibernated is not stored intent
// but observed status the controller derives from activity (ADR-058). Security
// context and scheduling are chart-only (config.AgentBase) and cannot be set
// here by design.
type AgentSpec struct {
	// Image is the agent container image.
	Image string `json:"image"`

	// Name is an optional human-readable name.
	// +optional
	Name string `json:"name,omitempty"`
	// Description is an optional human-readable description.
	// +optional
	Description string `json:"description,omitempty"`
	// Init is an optional one-shot init script run before the agent starts.
	// +optional
	Init string `json:"init,omitempty"`
	// Mounts declares the agent's volumes; a persisted mount becomes a PVC.
	// +optional
	Mounts []Mount `json:"mounts,omitempty"`
	// Env are plain environment variables projected into the agent container.
	// +optional
	Env []EnvVar `json:"env,omitempty"`
	// Resources are the agent container's resource requests and limits.
	// +optional
	Resources ResourceSpec `json:"resources,omitempty"`

	// ImagePullPolicy overrides the chart-wide default; empty = inherit.
	// +optional
	ImagePullPolicy string `json:"imagePullPolicy,omitempty"`
	// StorageSize overrides the chart-wide default PVC size; empty = inherit.
	// +optional
	StorageSize string `json:"storageSize,omitempty"`
	// AgentHome is the resolved HOME inside the agent container. Any $HOME
	// literals in Mounts are already resolved against it at write
	// time, so the controller never sees $HOME.
	// +optional
	AgentHome string `json:"agentHome,omitempty"`

	// SecretRef names a K8s Secret whose keys are envFrom-projected into the
	// agent container (operator-supplied envs).
	// +optional
	SecretRef string `json:"secretRef,omitempty"`

	// ImagePullSecretRef names a kubernetes.io/dockerconfigjson Secret the
	// kubelet uses to pull the agent image from a private registry. Unlike
	// SecretRef it is never projected into the agent container — only the
	// kubelet consumes it at pod creation, so a foreign-replier fork can pull
	// with it without ever seeing it. When set it takes precedence over the
	// install-wide default pull secret, which is retained as a fallback.
	// +optional
	ImagePullSecretRef string `json:"imagePullSecretRef,omitempty"`

	// GrantedSecretIDs are the credential Secret IDs granted to this agent's
	// egress — intent written by the api-server. ADR-058 moved these from a
	// ConfigMap annotation into spec, because they are reconciled by the
	// controller into the credential set mounted on the gateway.
	// +optional
	GrantedSecretIDs []string `json:"grantedSecretIds,omitempty"`
	// GrantedConnectionIDs are the connection IDs granted to this agent.
	// +optional
	GrantedConnectionIDs []string `json:"grantedConnectionIds,omitempty"`
}

// Condition types on an Agent's status. Conditions are the source of truth for
// operational state; the api-server routes on ConditionReady. There is no phase
// field — the conditions are the only status the api-server reads (ADR-059).
const (
	// ConditionReady is the agent's overall readiness — the intersection of
	// the agent and gateway pod readiness. The api-server treats this as the
	// authoritative "can I route to this agent?" signal (supersedes the
	// agent-pod-only live check of ADR-032).
	ConditionReady = "Ready"
	// ConditionAgentPodReady mirrors the agent pod's observed Ready condition.
	ConditionAgentPodReady = "AgentPodReady"
	// ConditionGatewayPodReady mirrors the paired gateway pod's observed Ready
	// condition. The agent cannot make credentialed egress without it, so it is
	// a required input to ConditionReady.
	ConditionGatewayPodReady = "GatewayPodReady"
	// ConditionReconciled reports whether the controller accepted and rendered
	// the spec; its message carries the last reconcile error, if any.
	ConditionReconciled = "Reconciled"
)

// ReasonHibernated is stamped on the readiness conditions when the idle checker
// scales an agent to zero. It lets a consumer tell a hibernated agent (idle,
// scaled down) from one still starting — both report Ready=False (ADR-059).
const ReasonHibernated = "Hibernated"

// AgentStatus is the observed state of an Agent. The controller is the sole
// writer, via the status subresource.
type AgentStatus struct {
	// Conditions are the source of truth for the agent's operational state.
	// See the Condition* constants for the well-known types.
	// +optional
	// +listType=map
	// +listMapKey=type
	Conditions []metav1.Condition `json:"conditions,omitempty"`
	// ObservedGeneration is the spec generation last reconciled.
	// +optional
	ObservedGeneration int64 `json:"observedGeneration,omitempty"`
}

// Mount declares a volume mounted into the agent container.
type Mount struct {
	// Path is the absolute mount path inside the container.
	Path string `json:"path"`
	// Persist marks the mount as backed by a retained PVC rather than an
	// emptyDir that dies with the pod.
	Persist bool `json:"persist"`
	// Size is an optional K8s resource Quantity (e.g. "2Gi") for a persisted
	// mount's PVC. Empty falls back to StorageSize, then the chart default.
	// Ignored when Persist is false.
	// +optional
	Size string `json:"size,omitempty"`
}

// EnvVar is a plain name/value environment variable.
type EnvVar struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// ResourceSpec carries container resource requests and limits as K8s Quantity
// strings keyed by resource name (e.g. "cpu", "memory").
type ResourceSpec struct {
	// +optional
	Requests map[string]string `json:"requests,omitempty"`
	// +optional
	Limits map[string]string `json:"limits,omitempty"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:scope=Namespaced,shortName=agt
// +kubebuilder:metadata:annotations=helm.sh/resource-policy=keep
// +kubebuilder:metadata:annotations=agent-platform.ai/crd-schema-generation=1
// +kubebuilder:printcolumn:name="Ready",type=string,JSONPath=`.status.conditions[?(@.type=="Ready")].status`
// +kubebuilder:printcolumn:name="Reason",type=string,JSONPath=`.status.conditions[?(@.type=="Ready")].reason`
// +kubebuilder:printcolumn:name="Image",type=string,JSONPath=`.spec.image`,priority=1
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`

// Agent is the durable, owned, runnable resource — definition, runtime state,
// and lifecycle in one custom resource (ADR-046, ADR-058).
type Agent struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   AgentSpec   `json:"spec,omitempty"`
	Status AgentStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true

// AgentList is a list of Agents.
type AgentList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []Agent `json:"items"`
}
