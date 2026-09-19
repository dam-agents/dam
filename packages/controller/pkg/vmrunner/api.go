package vmrunner

// UNIT_BOUNDARY_DESCRIPTION: what an image says a machine should run, which a tree of its files does not carry. Read from the image when it is unpacked and kept beside the tree, because smolvm handed a bare rootfs launches nothing and waits for an exec that never comes.
type ImageLaunch struct {
	Entrypoint []string `json:"entrypoint"`
	Cmd        []string `json:"cmd"`
	Env        []string `json:"env"`
	WorkingDir string   `json:"workingDir"`
}

type MachineSpec struct {
	Image      string            `json:"image"`
	CPUs       int               `json:"cpus"`
	MemoryMiB  int               `json:"memoryMiB"`
	StorageGiB int               `json:"storageGiB"`
	Persist    []string          `json:"persist,omitempty"`
	Env        map[string]string `json:"env,omitempty"`
	CACert     string            `json:"caCert,omitempty"`
	AllowCIDRs []string          `json:"allowCidrs,omitempty"`
	Revision   string            `json:"revision,omitempty"`
	Running    bool              `json:"running"`
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
