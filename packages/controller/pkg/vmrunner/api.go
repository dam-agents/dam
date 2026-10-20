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
	// UNIT_BOUNDARY_DESCRIPTION: what admission may commit to this machine, at
	// UNIT_BOUNDARY_DESCRIPTION: most, in MiB, as the controller reads it off
	// UNIT_BOUNDARY_DESCRIPTION: the owner's runner pod: the memory the node
	// UNIT_BOUNDARY_DESCRIPTION: reserved for that pod, which is below the limit
	// UNIT_BOUNDARY_DESCRIPTION: the pod was given while an in-place resize
	// UNIT_BOUNDARY_DESCRIPTION: waits for room. A runner admits no machine past
	// UNIT_BOUNDARY_DESCRIPTION: it, so machines never grow past what the
	// UNIT_BOUNDARY_DESCRIPTION: scheduler sees and no busy node evicts an
	// UNIT_BOUNDARY_DESCRIPTION: owner's runner for memory the node never lent
	// UNIT_BOUNDARY_DESCRIPTION: them. Zero admits against the runner's limit.
	AdmitMiB int `json:"admitMiB,omitempty"`
	// UNIT_BOUNDARY_DESCRIPTION: the state read from this machine when the
	// UNIT_BOUNDARY_DESCRIPTION: controller waived the cap because the machine
	// UNIT_BOUNDARY_DESCRIPTION: already holds memory. Sent only with a zero
	// UNIT_BOUNDARY_DESCRIPTION: cap: the runner refuses a waiver whose machine
	// UNIT_BOUNDARY_DESCRIPTION: turns out to be a cold start by the time this
	// UNIT_BOUNDARY_DESCRIPTION: ensure reaches it, and the controller decides
	// UNIT_BOUNDARY_DESCRIPTION: again on what the runner reports.
	ObservedState string `json:"observedState,omitempty"`
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
	UsedMiB int `json:"usedMiB,omitempty"`
	// UNIT_BOUNDARY_DESCRIPTION: whether the running machine is still within
	// UNIT_BOUNDARY_DESCRIPTION: its warm-up after its boot, when it counts at
	// UNIT_BOUNDARY_DESCRIPTION: least at the warm-up floor however little it
	// UNIT_BOUNDARY_DESCRIPTION: was measured at: its harness is still growing.
	Warming bool `json:"warming,omitempty"`
	// UNIT_BOUNDARY_DESCRIPTION: the disk the machine's last start asked for,
	// UNIT_BOUNDARY_DESCRIPTION: in GiB. Only a runner that grows a disk at
	// UNIT_BOUNDARY_DESCRIPTION: the next start rather than restarting for it
	// UNIT_BOUNDARY_DESCRIPTION: reports it, so zero on a running machine is
	// UNIT_BOUNDARY_DESCRIPTION: an older runner a larger disk would reboot.
	DiskGiB int    `json:"diskGiB,omitempty"`
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
	ReasonNotReady      = "MachineNotReady"
	ReasonOutOfCapacity = "MachineOutOfCapacity"
	// UNIT_BOUNDARY_DESCRIPTION: a start the runner had room for but the node has not yet granted the runner pod: the controller asks the node for that memory with an in-place resize, so the agent is retried at once and no idle agent is hibernated for it.
	ReasonAwaitingAllocation = "MachineAwaitingAllocation"
	ReasonImageUnavailable   = "MachineImageUnavailable"
	ReasonBootFailed         = "MachineBootFailed"
	ReasonSeedMissing        = "MachineSeedMissing"
	ReasonStorageFull        = "MachineStorageFull"
	ReasonHomeFull           = "MachineHomeFull"
	// UNIT_BOUNDARY_DESCRIPTION: a machine refused because its runner cannot reach the node's image cache service at all: the node's fault, not the image's. The api-server holds an image update on it rather than moving the Agent back, so an image that starts fine elsewhere is not convicted for one node's mount.
	ReasonImageCacheUnreachable = "MachineImageCacheUnreachable"
	// UNIT_BOUNDARY_DESCRIPTION: a first boot that copies a disk before the guest answers — a conversion to btrfs or a migration seed's restore. The runner holds such a boot for up to six hours, so it is a boot in progress, never a start failure.
	ReasonCopyingDisk = "MachineCopyingDisk"
	// UNIT_BOUNDARY_DESCRIPTION: a machine whose VMM the kernel killed for memory, which the runner reports from the VMM's exit signal until the guest answers again. Every machine of an owner shares the runner's cgroup, so what grows past it costs one machine a restart, not the owner every machine.
	ReasonOOMKilled = "MachineOOMKilled"
	// UNIT_BOUNDARY_DESCRIPTION: a machine whose VMM a seccomp filter killed: the guest made a call the runner's filter forbids, and reads as a machine that restarted once rather than one that flaps. The runner reports it from the VMM's exit signal until the guest answers again.
	ReasonSeccompKilled = "MachineSeccompKilled"
)

// UNIT_BOUNDARY_DESCRIPTION: which runner release a runner pod runs, as its loader last wrote it: the one running, the one the controller asked for, and, when the two differ, why the loader holds on to the one running.
type RunnerRelease struct {
	Running string `json:"running"`
	Target  string `json:"target,omitempty"`
	Held    string `json:"held,omitempty"`
	Message string `json:"message,omitempty"`
}

// UNIT_BOUNDARY_DESCRIPTION: the release the controller names for the pod's loader to run: the runner image reference the stager staged it under.
type RunnerReleaseName struct {
	Release string `json:"release"`
}

// UNIT_BOUNDARY_DESCRIPTION: how close the runner's own memory is to its limit: the working set the kernel kills a machine of it by, read off its cgroup, and whether it is past the pressure threshold. Version moves when pressure starts or ends and again while it lasts.
type RunnerPressure struct {
	Version       uint64 `json:"version,omitempty"`
	Pressured     bool   `json:"pressured"`
	LimitMiB      int    `json:"limitMiB,omitempty"`
	WorkingSetMiB int    `json:"workingSetMiB,omitempty"`
}

// UNIT_BOUNDARY_DESCRIPTION: the runner's usage read, as far as the controller reads it: the owner's claim and the memory admission counts against the limit, and every machine it holds. `MachineFigures` says whether each machine carries the memory figures a status reports, which the memory pass counts with instead of a status read each; a runner older than them leaves the mark out, and the pass then reads each machine's status as before, because a zero read as a machine's size and warm-up would count a warming machine at its measured use alone.
type RunnerUsage struct {
	Storage struct {
		UsedBytes   int64 `json:"usedBytes"`
		UsableBytes int64 `json:"usableBytes"`
	} `json:"storage"`
	Memory struct {
		LimitMiB     int64 `json:"limitMiB"`
		CommittedMiB int64 `json:"committedMiB"`
	} `json:"memory"`
	Machines       []MachineUsage `json:"machines"`
	MachineFigures bool           `json:"machineFigures"`
}

// UNIT_BOUNDARY_DESCRIPTION: one machine as the usage read lists it. The memory figures are filled only when the read carries the mark above, so a caller reads them only under it.
type MachineUsage struct {
	ID        string `json:"id"`
	State     string `json:"state"`
	CPUs      int    `json:"cpus"`
	MemoryMiB int    `json:"memoryMiB,omitempty"`
	UsedMiB   int    `json:"usedMiB,omitempty"`
	Warming   bool   `json:"warming"`
	DiskGiB   int    `json:"diskGiB,omitempty"`
}

// UNIT_BOUNDARY_DESCRIPTION: whether a runner can reach the node's image cache service right now, as its own connect reports it: the socket inside the runner's read-only mount of the node directory, and, when nothing serves it, the error a machine of that runner would be refused with. An empty error is a cache the runner reached.
type RunnerImageCache struct {
	Socket string `json:"socket"`
	Error  string `json:"error,omitempty"`
}

// UNIT_BOUNDARY_DESCRIPTION: why a loader holds on to the release it runs. Unstaged passes once the node's stager copies the release; the other three never pass in that pod, so only a new pod takes the release. Runtime means the release's runner does not load in this pod; the name is older than that meaning. Reboot means the release declares that the machines booted before it must reboot onto it, which only its own pod does.
const (
	HeldUnstaged = "unstaged"
	HeldRuntime  = "runtime"
	HeldReboot   = "reboot"
	HeldFailed   = "failed"
)

// UNIT_BOUNDARY_DESCRIPTION: vm-seed's exit code for a copy that a fresh attempt cannot change — a home past a walk limit, or larger than the machine's disk.
const SeedExitPermanent = 3
