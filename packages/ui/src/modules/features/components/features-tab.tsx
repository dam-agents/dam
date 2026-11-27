import { PageHeader } from "@/components/ui/page-header";

import { useInstallCapabilities } from "../api/queries.js";
import { offeredFeatures } from "../lib/visible-features.js";
import { FeatureSwitches } from "./feature-switches.js";

export function FeaturesTab() {
  const { data: install } = useInstallCapabilities();

  return (
    <div>
      <PageHeader
        title="Experimental features"
        description="Try features before they are finished. Each switch changes only your own account."
      />
      <FeatureSwitches features={offeredFeatures("experimental", install)} />
    </div>
  );
}
