import { useInstallCapabilities } from "../api/queries.js";

// UNIT_BOUNDARY_DESCRIPTION: the runtime this install gives every new agent, which is the install's own capability and nothing the user chose: one that can virtualize creates every new agent it is not told otherwise about as a microVM, and one that cannot has only containers. The answer has not arrived on the first render, which reads the same as a no, so a surface waits rather than quietly assuming the runtime its author did not get. A read that failed is also an answer: it settles as a no, because a surface that can never be shown is worse than one that says the wrong runtime.
export function useVmRuntime(): {
  answered: boolean;
  unknown: boolean;
  vm: boolean;
} {
  const install = useInstallCapabilities();
  return {
    answered: install.data !== undefined || install.isError,
    unknown: install.isError,
    vm: install.data?.virtualization === true,
  };
}
