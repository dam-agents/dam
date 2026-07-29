import { SectionLabel } from "@/components/ui/section-label";

import type { WizardStep } from "../lib/wizard-snapshot.js";

interface Props {
  step: WizardStep;
  title: string;
  subtitle: string;
}

export function StepHeader({ step, title, subtitle }: Props) {
  return (
    <div className="mb-8">
      <SectionLabel>Step {step} of 3</SectionLabel>
      <h1 className="mt-2 text-[24px] font-semibold tracking-[-0.5px] text-foreground">
        {title}
      </h1>
      <p className="mt-1 text-[14px] text-muted-foreground">{subtitle}</p>
    </div>
  );
}
