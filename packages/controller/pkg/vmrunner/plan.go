package vmrunner

import "path/filepath"

// UNIT_BOUNDARY_DESCRIPTION: the whole contract between a runner and the inside of its machines. The runner writes the share and the plan; platform-init reads them as the machine's entrypoint. Both are in this repository and ship in one image, so the paths are constants here rather than fields anybody configures — what varies per machine is only which guest paths persist.
const (
	SharePath  = "/platform"
	InitPath   = SharePath + "/init"
	PlanPath   = SharePath + "/plan.json"
	ShareCADir = SharePath + "/ca"

	// UNIT_BOUNDARY_DESCRIPTION: where the image expects the platform's MITM CA. The share carries it and platform-init binds it here, so an image's own trust setup is the same sequence on both backends.
	GuestCADir = "/etc/platform/ca"

	// UNIT_BOUNDARY_DESCRIPTION: DiskDevicePath is where smolvm attaches the storage disk, which is a property of the VMM and not a path anything should write to. platform-init moves it to DiskPath, so the disk is reachable by exactly one name, and that name is not "workspace" — which in this platform means the directory inside an agent's HOME.
	DiskDevicePath = "/workspace"
	DiskPath       = "/mnt/platform"

	// UNIT_BOUNDARY_DESCRIPTION: the disk's two namespaces. Agent-declared paths are mirrored under AgentDir and the platform's own per-machine state lives under SystemDir, so an Agent that persists `/log` gets a directory of its own instead of overwriting the boot log — which the flat layout before it could not prevent, because the disk root held both.
	AgentDir  = "agent"
	SystemDir = "system"
)

type Plan struct {
	Persist []string `json:"persist,omitempty"`
}

func AgentStore(root, path string) string {
	return filepath.Join(root, AgentDir, path)
}

func SystemStore(root, name string) string {
	return filepath.Join(root, SystemDir, name)
}
