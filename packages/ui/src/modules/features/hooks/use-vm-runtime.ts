import { useFeatures, useInstallCapabilities } from "../api/queries.js";

// UNIT_BOUNDARY_DESCRIPTION: whether an agent is created on the new sandbox runtime is two questions with two answers — the user's own flag, and whether this install can run one at all — and every surface that creates an agent must read both the same way. Neither answer has arrived on the first render, which reads the same as a no, so a form waits rather than quietly creating the pod its author did not ask for. A read that failed is also an answer: it settles as a no, because a create form that can never be submitted is worse than a container the user is told about.
export function useVmRuntime(): {
  answered: boolean;
  unknown: boolean;
  vm: boolean;
} {
  const flags = useFeatures();
  const install = useInstallCapabilities();
  const unknown = flags.isError || install.isError;
  return {
    answered:
      (flags.data !== undefined || flags.isError) &&
      (install.data !== undefined || install.isError),
    unknown,
    vm:
      flags.data?.["vm-sandboxes"] === true &&
      install.data?.virtualization === true,
  };
}
