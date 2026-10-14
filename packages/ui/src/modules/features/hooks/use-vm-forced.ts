import { useInstallCapabilities } from "../api/queries.js";

// UNIT_BOUNDARY_DESCRIPTION: whether this install pins every new agent on the new sandbox runtime, the api-server's own vmForced rule read from the install's answer; until it arrives it reads as no.
export function useVmForced(): boolean {
  const install = useInstallCapabilities().data;
  return (
    install?.virtualization === true &&
    install.features["vm-sandboxes"] === "on"
  );
}
