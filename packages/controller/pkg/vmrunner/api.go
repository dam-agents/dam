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
	// UNIT_BOUNDARY_DESCRIPTION: for a runner outside the cluster, the port on
	// UNIT_BOUNDARY_DESCRIPTION: that host's loopback where the machine's
	// UNIT_BOUNDARY_DESCRIPTION: paired gateway is forwarded. It replaces
	// UNIT_BOUNDARY_DESCRIPTION: AllowCIDRs: the guest reaches that one port at
	// UNIT_BOUNDARY_DESCRIPTION: its own gateway address and nothing else.
	GatewayHostPort int `json:"gatewayHostPort,omitempty"`
	// UNIT_BOUNDARY_DESCRIPTION: the resolver the VMM relays every guest DNS
	// UNIT_BOUNDARY_DESCRIPTION: query to, whatever address the guest sent it
	// UNIT_BOUNDARY_DESCRIPTION: to: the paired gateway's own, which answers
	// UNIT_BOUNDARY_DESCRIPTION: every name with the gateway's address and
	// UNIT_BOUNDARY_DESCRIPTION: forwards nothing. Empty relays guest DNS
	// UNIT_BOUNDARY_DESCRIPTION: nowhere, as for a runner outside the cluster.
	GuestResolver string `json:"guestResolver,omitempty"`
	Revision      string `json:"revision,omitempty"`
	Running       bool   `json:"running"`
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
	// UNIT_BOUNDARY_DESCRIPTION: set while a runtime migration copies an
	// UNIT_BOUNDARY_DESCRIPTION: Agent's home onto this machine. It is what
	// UNIT_BOUNDARY_DESCRIPTION: lets a seed capability seed the machine at
	// UNIT_BOUNDARY_DESCRIPTION: all; the runner never reshapes a machine for it.
	Migration *MachineMigration `json:"migration,omitempty"`
	// UNIT_BOUNDARY_DESCRIPTION: the seed this machine's home must be
	// UNIT_BOUNDARY_DESCRIPTION: restored from, as the runner answered the
	// UNIT_BOUNDARY_DESCRIPTION: migration's upload. It is sent only while a
	// UNIT_BOUNDARY_DESCRIPTION: runtime migration boots the machine. The
	// UNIT_BOUNDARY_DESCRIPTION: runner then starts the machine only while it
	// UNIT_BOUNDARY_DESCRIPTION: holds exactly that seed, and platform-init
	// UNIT_BOUNDARY_DESCRIPTION: restores the home from it or fails the boot,
	// UNIT_BOUNDARY_DESCRIPTION: never falling back to the image's home.
	ExpectSeed *SeedResult `json:"expectSeed,omitempty"`
	// UNIT_BOUNDARY_DESCRIPTION: asks for this machine alone to get the
	// UNIT_BOUNDARY_DESCRIPTION: node's virtualization extensions. The runner
	// UNIT_BOUNDARY_DESCRIPTION: grants it only when its install lets it nest
	// UNIT_BOUNDARY_DESCRIPTION: and its node's KVM allows it, and restarts
	// UNIT_BOUNDARY_DESCRIPTION: the machine when it changes, since a guest
	// UNIT_BOUNDARY_DESCRIPTION: reads its CPU's features only at boot.
	NestedVirtualization bool `json:"nestedVirtualization,omitempty"`
}

// UNIT_BOUNDARY_DESCRIPTION: a seed as the runner answers its upload: the
// UNIT_BOUNDARY_DESCRIPTION: bytes it stored and their SHA-256 in lowercase
// UNIT_BOUNDARY_DESCRIPTION: hex. vm-seed writes the answer it verified as
// UNIT_BOUNDARY_DESCRIPTION: the copy Job's termination message, which is how
// UNIT_BOUNDARY_DESCRIPTION: the controller learns the seed to expect.
type SeedResult struct {
	Bytes  uint64 `json:"bytes"`
	SHA256 string `json:"sha256"`
}

// UNIT_BOUNDARY_DESCRIPTION: a runtime migration in progress on a machine. It carries nothing yet; its presence is the mark.
type MachineMigration struct{}

type MachineStatus struct {
	State     string `json:"state"`
	Reason    string `json:"reason,omitempty"`
	Restarts  int32  `json:"restarts,omitempty"`
	Port      int    `json:"port,omitempty"`
	Ready     bool   `json:"ready"`
	CPUs      int    `json:"cpus,omitempty"`
	MemoryMiB int    `json:"memoryMiB,omitempty"`
	// UNIT_BOUNDARY_DESCRIPTION: the host memory the running machine's VMM
	// UNIT_BOUNDARY_DESCRIPTION: holds, as the runner last measured it. Zero
	// UNIT_BOUNDARY_DESCRIPTION: until measured, which counts as MemoryMiB.
	UsedMiB int    `json:"usedMiB,omitempty"`
	Message string `json:"message,omitempty"`
	// UNIT_BOUNDARY_DESCRIPTION: changes whenever anything else in this
	// UNIT_BOUNDARY_DESCRIPTION: status changes. WaitStatus hands it back as
	// UNIT_BOUNDARY_DESCRIPTION: `since`, and the runner answers once it has
	// UNIT_BOUNDARY_DESCRIPTION: moved on.
	Version uint64 `json:"version,omitempty"`
	// UNIT_BOUNDARY_DESCRIPTION: the SHA-256 of the seed the machine's home
	// UNIT_BOUNDARY_DESCRIPTION: was restored from, known once a guest booted
	// UNIT_BOUNDARY_DESCRIPTION: with that seed expected has answered. Empty
	// UNIT_BOUNDARY_DESCRIPTION: for a home from the image. A runtime
	// UNIT_BOUNDARY_DESCRIPTION: migration ends only when this is the seed it
	// UNIT_BOUNDARY_DESCRIPTION: expects.
	HomeSeededFrom string `json:"homeSeededFrom,omitempty"`
	// UNIT_BOUNDARY_DESCRIPTION: whether the machine as recorded boots with
	// UNIT_BOUNDARY_DESCRIPTION: the node's virtualization extensions: asked
	// UNIT_BOUNDARY_DESCRIPTION: for, and granted by the runner.
	Nested bool `json:"nested,omitempty"`
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
	ReasonSeedMissing      = "MachineSeedMissing"
)

// UNIT_BOUNDARY_DESCRIPTION: which runner release a runner pod runs, as its loader last wrote it: the one running, the one the controller asked for, and, when the two differ, why the loader holds on to the one running.
type RunnerRelease struct {
	Running string `json:"running"`
	Target  string `json:"target,omitempty"`
	Held    string `json:"held,omitempty"`
	Message string `json:"message,omitempty"`
}

// UNIT_BOUNDARY_DESCRIPTION: why a loader holds on to the release it runs. Unstaged passes once the node's stager copies the release; the other two never pass in that pod, so only a new pod takes the release.
const (
	HeldUnstaged = "unstaged"
	HeldRuntime  = "runtime"
	HeldFailed   = "failed"
)

// UNIT_BOUNDARY_DESCRIPTION: vm-seed's exit code for a copy that a fresh attempt cannot change — a home past a walk limit, or larger than the machine's disk.
const SeedExitPermanent = 3
