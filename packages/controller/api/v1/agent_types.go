package v1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// AgentSpec is the desired state of an Agent — the sole durable per-agent
// resource after Instance was collapsed into Agent. The api-server is the
// sole writer.
//
// There is no desiredState field: running-vs-hibernated is not stored intent
// but observed status the controller derives from activity. Security context
// is chart-only (config.AgentBase); scheduling is chart-wide except
// RuntimeClassName/NodeSelector, which are per-template for GPU workloads.
// +kubebuilder:validation:XValidation:rule="!has(self.backend) || self.backend.type != 'vm' || !has(self.runtimeClassName)",message="runtimeClassName selects a container runtime and is invalid on the vm backend"
// +kubebuilder:validation:XValidation:rule="!has(self.backend) || self.backend.type != 'vm' || !has(self.secretRef)",message="secretRef (envFrom projection) is not supported on the vm backend"
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

	// HibernationTimeout overrides the chart-wide idle timeout for this Agent: "0s" never hibernates, omitted inherits the default. The UI writes it (presented in minutes); the controller and api-server resolve the effective value.
	// +optional
	HibernationTimeout *metav1.Duration `json:"hibernationTimeout,omitempty"`

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

	// RuntimeClassName overrides the chart-wide runtime class; empty = inherit.
	// Selects among *container* runtimes only — rejected on the vm backend.
	// +optional
	RuntimeClassName string `json:"runtimeClassName,omitempty"`
	// NodeSelector overrides the chart-wide node selector; empty = inherit.
	// Applies to both backends (KubeVirt propagates it to the virt-launcher pod).
	// +optional
	NodeSelector map[string]string `json:"nodeSelector,omitempty"`

	// Backend selects the isolation substrate the agent workload runs on;
	// nil = container. Immutable after create (enforced by the api-server,
	// the sole spec writer). `vm` reconciles a KubeVirt VirtualMachine
	// instead of the agent StatefulSet; the paired gateway is unaffected.
	// +optional
	Backend *Backend `json:"backend,omitempty"`

	// SecretRef names a K8s Secret whose keys are envFrom-projected into the
	// agent container (operator-supplied envs). Container backend only —
	// rejected on the vm backend (nothing projects it into the guest).
	// +optional
	SecretRef string `json:"secretRef,omitempty"`

	// ImagePullSecretRef names a kubernetes.io/dockerconfigjson Secret the
	// kubelet uses to pull the agent image from a private registry. Unlike
	// SecretRef it is never projected into the agent container — only the
	// kubelet consumes it at pod creation, so an ephemeral executor pod can pull
	// with it without ever seeing it. When set it takes precedence over the
	// install-wide default pull secret, which is retained as a fallback.
	// +optional
	ImagePullSecretRef string `json:"imagePullSecretRef,omitempty"`

	// GrantedSecretIDs are the credential Secret IDs granted to this agent's
	// egress — intent written by the api-server. These live in spec rather
	// than a ConfigMap annotation, because they are reconciled by the
	// controller into the credential set mounted on the gateway.
	// +optional
	GrantedSecretIDs []string `json:"grantedSecretIds,omitempty"`
	// GrantedConnectionIDs are the connection IDs granted to this agent.
	// +optional
	GrantedConnectionIDs []string `json:"grantedConnectionIds,omitempty"`

	// L7Hosts are hosts promoted onto the gateway's TLS-terminating (L7)
	// interception chain without a credential, so path/method/port egress
	// rules are enforceable over HTTPS — the L4 catch-all sees only SNI.
	// Written by the api-server when such a rule exists for this agent;
	// per-agent grain so a rule on one agent never reshapes a sibling's
	// gateway. Run executors inherit the parent agent's L7Hosts (the parent owner
	// stays the egress policy authority for foreign turns).
	//
	// The item pattern is a hard boundary: each entry is interpolated into
	// the gateway's Envoy bootstrap (an unescaped `text/template` field)
	// and into cert-manager SANs, so admission rejects anything that isn't
	// a DNS hostname (optionally a `*.` wildcard) — no quotes, whitespace,
	// or YAML metacharacters can reach the rendered config. maxItems caps
	// the leaf SAN list a single agent can demand.
	// +optional
	// +kubebuilder:validation:MaxItems=256
	// +kubebuilder:validation:items:MaxLength=253
	// +kubebuilder:validation:items:Pattern=`^(\*\.)?([a-zA-Z0-9]([-a-zA-Z0-9]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([-a-zA-Z0-9]{0,61}[a-zA-Z0-9])?)*$`
	L7Hosts []string `json:"l7Hosts,omitempty"`

	// TelemetryAttributionID is the agent id stamped as the trusted telemetry
	// attribution (`x-platform-agent-id`) instead of this agent's own id. Set
	// by the api-server for Invocation targets to their root Driver, so a
	// target's spend credits the agent that drove it rather than the
	// short-lived target. When set, the gateway also stamps
	// `x-platform-invocation-id` with this agent's own id, keeping child rows
	// distinguishable after their attribution is merged. Never user-settable —
	// a user-supplied value would forge attribution onto an agent the caller
	// does not drive; it is service-only input, like the pre-minted id.
	// +optional
	TelemetryAttributionID string `json:"telemetryAttributionId,omitempty"`
}

// Backend is a discriminated union selecting the agent's isolation substrate
// (K8s convention: `type` plus a sub-block named after the variant).
// +kubebuilder:validation:XValidation:rule="self.type == 'vm' || !has(self.vm)",message="vm block requires type: vm"
type Backend struct {
	// +kubebuilder:validation:Enum=container;vm
	Type string `json:"type"`
	// VM carries vm-backend props; present only when type == "vm".
	// +optional
	VM *VMBackend `json:"vm,omitempty"`
}

// VMBackend is deliberately empty for now — scratch sizing and placement are
// chart-level policy (config.VM); it exists so future vm-only props have a home.
type VMBackend struct{}

// IsVM reports whether the spec selects the vm backend.
func (s *AgentSpec) IsVM() bool {
	return s.Backend != nil && s.Backend.Type == "vm"
}

// Condition types on an Agent's status. Conditions are the source of truth for
// operational state; the api-server routes on ConditionReady. There is no phase
// field — the conditions are the only status the api-server reads.
const (
	// ConditionReady is the agent's overall readiness — the intersection of
	// the agent and gateway pod readiness. The api-server treats this as the
	// authoritative "can I route to this agent?" signal (supersedes the
	// earlier agent-pod-only live check).
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
// scaled down) from one still starting — both report Ready=False.
const ReasonHibernated = "Hibernated"

// ReasonOverBudget is stamped on Ready when the agent wants to run but its
// start would push the owner's summed Sizes (`spec.resources.limits`) past
// their Ceiling (#1900). The pods stay at zero; the message carries the
// reserved/ceiling figures. Reverts to Hibernated once the activity window
// lapses.
const ReasonOverBudget = "OverBudget"

// ReasonStuckOnSupersededRevision marks a pod running a revision the
// StatefulSet has moved past, so it will never become ready — typically a
// template still referencing a deleted credential Secret (#2817). Terminal for
// that pod, unlike PodNotReady; the controller evicts it.
const ReasonStuckOnSupersededRevision = "StuckOnSupersededRevision"

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
// +kubebuilder:metadata:annotations=agent-platform.ai/crd-schema-generation=7
// +kubebuilder:printcolumn:name="Ready",type=string,JSONPath=`.status.conditions[?(@.type=="Ready")].status`
// +kubebuilder:printcolumn:name="Reason",type=string,JSONPath=`.status.conditions[?(@.type=="Ready")].reason`
// +kubebuilder:printcolumn:name="Image",type=string,JSONPath=`.spec.image`,priority=1
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`

// Agent is the durable, owned, runnable resource — definition, runtime state,
// and lifecycle in one custom resource.
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
