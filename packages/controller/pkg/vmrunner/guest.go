package vmrunner

import "path/filepath"

// UNIT_BOUNDARY_DESCRIPTION: the whole contract between a runner and the inside of its machines. The runner writes the share; platform-init reads it as the machine's entrypoint. Both are in this repository and ship in one image, so these are constants rather than fields anybody configures — and nothing about a machine's storage varies per agent, so there is no plan to write either: the disk holds the agent's home and the platform's own per-machine state, and everything else in the guest is discarded when the machine stops.
const (
	SharePath  = "/platform"
	InitPath   = SharePath + "/init"
	ShareCADir = SharePath + "/ca"

	// UNIT_BOUNDARY_DESCRIPTION: where the image expects the platform's MITM CA. The share carries it and platform-init binds it here, so an image's own trust setup is the same sequence on both backends.
	GuestCADir = "/etc/platform/ca"

	// UNIT_BOUNDARY_DESCRIPTION: DiskDevicePath is where smolvm attaches the storage disk, which is a property of the VMM and not a path anything should write to. platform-init moves it to DiskPath, so the disk is reachable by exactly one name, and that name is not "workspace" — which in this platform means the directory inside an agent's HOME.
	DiskDevicePath = "/workspace"
	DiskPath       = "/mnt/platform"

	// UNIT_BOUNDARY_DESCRIPTION: the one guest path a machine keeps. It is fixed rather than configured — the image bakes this home into its user and the controller sets it as HOME on both backends — which is what lets the whole storage model be a constant instead of a plan the runner has to write and the guest has to parse.
	AgentHome = "/home/agent"

	// UNIT_BOUNDARY_DESCRIPTION: the disk's two namespaces. The agent's home is mirrored under AgentDir and the platform's own per-machine state lives under SystemDir, so an image whose home happens to contain a `log` directory cannot overwrite the boot log — which a flat layout could not prevent, because the disk root would hold both.
	AgentDir  = "agent"
	SystemDir = "system"
)

func AgentStore(root string) string { return filepath.Join(root, AgentDir) }

func SystemStore(root, name string) string { return filepath.Join(root, SystemDir, name) }
