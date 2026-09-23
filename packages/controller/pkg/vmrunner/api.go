package vmrunner

// UNIT_BOUNDARY_DESCRIPTION: the controller's half of the machine API, which it speaks to a vm runner over HTTP. The runner is Rust, so the two meet as JSON and never as types. What both sides must write and read is held in the JSON documents under packages/vm-runner/contract, which this package's tests and the runner's tests both round-trip, so a renamed field or a different omitempty fails a test on the side that changed.
type MachineSpec struct {
	Image      string            `json:"image"`
	CPUs       int               `json:"cpus"`
	MemoryMiB  int               `json:"memoryMiB"`
	StorageGiB int               `json:"storageGiB"`
	Env        map[string]string `json:"env,omitempty"`
	CACert     string            `json:"caCert,omitempty"`
	AllowCIDRs []string          `json:"allowCidrs,omitempty"`
	Revision   string            `json:"revision,omitempty"`
	Running    bool              `json:"running"`
	// UNIT_BOUNDARY_DESCRIPTION: the docker configs the runner fetches this
	// UNIT_BOUNDARY_DESCRIPTION: machine's image with, one per pull Secret a
	// UNIT_BOUNDARY_DESCRIPTION: pod would list and in that order. The runner
	// UNIT_BOUNDARY_DESCRIPTION: tries them in turn as the kubelet does, so a
	// UNIT_BOUNDARY_DESCRIPTION: stale first credential still falls back to the
	// UNIT_BOUNDARY_DESCRIPTION: next. They are credentials in transit and
	// UNIT_BOUNDARY_DESCRIPTION: nothing more: the runner hands them to crane
	// UNIT_BOUNDARY_DESCRIPTION: alone, clears them before the spec is stored
	// UNIT_BOUNDARY_DESCRIPTION: or passed to smolvm, and never logs them, so
	// UNIT_BOUNDARY_DESCRIPTION: they never reach spec.json or the guest.
	PullAuths []string `json:"pullAuths,omitempty"`
}

type MachineStatus struct {
	State     string `json:"state"`
	Reason    string `json:"reason,omitempty"`
	Restarts  int32  `json:"restarts,omitempty"`
	Port      int    `json:"port,omitempty"`
	Ready     bool   `json:"ready"`
	CPUs      int    `json:"cpus,omitempty"`
	MemoryMiB int    `json:"memoryMiB,omitempty"`
	Message   string `json:"message,omitempty"`
	// UNIT_BOUNDARY_DESCRIPTION: how long ago this runner last asked the
	// UNIT_BOUNDARY_DESCRIPTION: machine to start, in milliseconds; zero when
	// UNIT_BOUNDARY_DESCRIPTION: it has not asked since it came up. A machine
	// UNIT_BOUNDARY_DESCRIPTION: asked recently is about to become ready or
	// UNIT_BOUNDARY_DESCRIPTION: fail, and is worth watching closely until one
	// UNIT_BOUNDARY_DESCRIPTION: or the other.
	StartingMs int64 `json:"startingMs,omitempty"`
}

const (
	StateAbsent     = "absent"
	StateUnknown    = "unknown"
	StateCreating   = "creating"
	StateStarting   = "starting"
	StateRestarting = "restarting"
	StateRunning    = "running"
	StateStopping   = "stopping"
	StateStopped    = "stopped"
)

const (
	ReasonNotReady         = "MachineNotReady"
	ReasonOutOfCapacity    = "MachineOutOfCapacity"
	ReasonImageUnavailable = "MachineImageUnavailable"
	ReasonBootFailed       = "MachineBootFailed"
	ReasonEgressChanged    = "MachineEgressChanged"
)
