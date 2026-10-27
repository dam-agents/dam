import { useInstallCapabilities } from "../api/queries.js";

// UNIT_BOUNDARY_DESCRIPTION: the vm-sandboxes experiment became an install capability, so a form reads the install's virtualization setting instead of the removed flag. An answer that has not arrived, or one that failed, reads as a no: a create form that can never be submitted is worse than a container the user is told about. The idle timeout is the one the install gives a new agent on that runtime, which the create form shows until the user sets its own.
export function useVmRuntime(): {
  answered: boolean;
  unknown: boolean;
  vm: boolean;
  vmAgentSizing: "spec" | "pool" | undefined;
  idleTimeoutMin: number | undefined;
} {
  const install = useInstallCapabilities();
  const vm = install.data?.virtualization === true;
  return {
    answered: install.data !== undefined || install.isError,
    unknown: install.isError,
    vm,
    vmAgentSizing: install.data?.vmAgentSizing,
    idleTimeoutMin: install.data?.idleTimeoutMinutes?.[vm ? "vm" : "container"],
  };
}
