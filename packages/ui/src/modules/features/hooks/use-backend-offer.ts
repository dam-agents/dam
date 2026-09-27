import { useFeatures, useInstallCapabilities } from "../api/queries.js";
import { type BackendOffer, backendOffer } from "../lib/backend-offer.js";

export function useBackendOffer(): BackendOffer {
  const flags = useFeatures();
  const install = useInstallCapabilities();
  return backendOffer(
    { value: install.data, failed: install.isError },
    {
      value:
        flags.data === undefined
          ? undefined
          : flags.data["vm-sandboxes"] === true,
      failed: flags.isError,
    },
  );
}
