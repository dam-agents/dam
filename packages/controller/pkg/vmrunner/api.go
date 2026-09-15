package vmrunner

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
}

type MachineStatus struct {
	State      string `json:"state"`
	Port       int    `json:"port,omitempty"`
	Ready      bool   `json:"ready"`
	CPUs       int    `json:"cpus,omitempty"`
	MemoryMiB  int    `json:"memoryMiB,omitempty"`
	StorageGiB int    `json:"storageGiB,omitempty"`
	Message    string `json:"message,omitempty"`
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
