import { useInstallCapabilities } from "../api/queries.js";

// UNIT_BOUNDARY_DESCRIPTION: the vm-sandboxes experiment was removed from the api-server, so the new sandbox runtime stays off as it was on every install that ran it off. The create form still waits for the install answer, so it never quietly creates the pod its author did not ask for: an answer that has not arrived reads as a no, and so does a read that failed, because a create form that can never be submitted is worse than a container the user is told about.
export function useVmRuntime(): {
  answered: boolean;
  unknown: boolean;
  vm: boolean;
} {
  const install = useInstallCapabilities();
  return {
    answered: install.data !== undefined || install.isError,
    unknown: install.isError,
    vm: false,
  };
}
