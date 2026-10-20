import { useState } from "react";

import { useOutageFor } from "../api/queries.js";
import { type ProviderErrorCopy, providerErrorCopy } from "../lib/copy.js";
import { providerNameFor } from "../lib/provider-name.js";

export function useProviderErrorCopy(
  templateId: string | null,
  interrupted: boolean,
): ProviderErrorCopy {
  const condition = useOutageFor(templateId);
  const [sawOutage, setSawOutage] = useState(false);
  if (condition.kind !== "no-outage" && !sawOutage) setSawOutage(true);
  return providerErrorCopy({
    condition,
    providerName: providerNameFor(templateId),
    interrupted,
    recovered: sawOutage && condition.kind === "no-outage",
  });
}
