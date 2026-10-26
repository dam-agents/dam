import { useInstallCapabilities } from "../api/queries.js";

// UNIT_BOUNDARY_DESCRIPTION: the vm-sandboxes experiment became an install capability, so a form reads the install's virtualization setting instead of the removed flag. An answer that has not arrived, or one that failed, reads as a no: a create form that can never be submitted is worse than a container the user is told about.
export function useVmRuntime(): {
  answered: boolean;
  unknown: boolean;
  vm: boolean;
  vmAgentSizing: "spec" | "pool" | undefined;
} {
  const install = useInstallCapabilities();
  return {
    answered: install.data !== undefined || install.isError,
    unknown: install.isError,
    vm: install.data?.virtualization === true,
    vmAgentSizing: install.data?.vmAgentSizing,
  };
}
