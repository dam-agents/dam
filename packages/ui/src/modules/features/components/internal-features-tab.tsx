import { PageHeader } from "@/components/ui/page-header";
import { SectionLabel } from "@/components/ui/section-label";

import { ResetOnboardingCard } from "../../getting-started/components/reset-onboarding-card.js";
import { useInstallCapabilities } from "../api/queries.js";
import { offeredFeatures } from "../lib/visible-features.js";
import { FeatureSwitches } from "./feature-switches.js";

export function InternalFeaturesTab() {
  const { data: install } = useInstallCapabilities();

  return (
    <div>
      <PageHeader
        title="Internal features"
        description="Features the team is still trying out. They can change or go away at any time. Each switch changes only your own account."
      />
      <FeatureSwitches features={offeredFeatures("internal", install)} />

      <SectionLabel spaced className="mt-8">
        Onboarding
      </SectionLabel>
      <ResetOnboardingCard />
    </div>
  );
}
