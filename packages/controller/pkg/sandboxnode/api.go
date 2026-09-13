package sandboxnode

type MachineSpec struct {
	Image      string            `json:"image"`
	CPUs       int               `json:"cpus"`
	MemoryMiB  int               `json:"memoryMiB"`
	StorageGiB int               `json:"storageGiB"`
	Env        map[string]string `json:"env,omitempty"`
	CACert     string            `json:"caCert,omitempty"`
	AllowCIDRs []string          `json:"allowCidrs,omitempty"`
	Running    bool              `json:"running"`
}

type MachineStatus struct {
	State   string `json:"state"`
	Port    int    `json:"port,omitempty"`
	Ready   bool   `json:"ready"`
	Message string `json:"message,omitempty"`
}

const (
	StateAbsent   = "absent"
	StateCreating = "creating"
	StateStarting = "starting"
	StateRunning  = "running"
	StateStopping = "stopping"
	StateStopped  = "stopped"
)
