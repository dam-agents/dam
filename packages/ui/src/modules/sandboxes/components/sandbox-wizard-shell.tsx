import type { ReactNode } from "react";

import type { WizardStep } from "../lib/wizard-snapshot.js";
import { WizardStepIndicator } from "./wizard-step-indicator.js";

interface Props {
  step: WizardStep;
  imageLabel: string | null;
  onNavigate: (step: WizardStep) => void;
  children: ReactNode;
}

export function SandboxWizardShell({
  step,
  imageLabel,
  onNavigate,
  children,
}: Props) {
  return (
    <div className="mx-auto w-full max-w-[920px] px-4 pt-6 pb-24 md:px-8 md:py-12">
      <div className="flex flex-col gap-6 md:flex-row md:gap-10">
        <WizardStepIndicator
          step={step}
          imageLabel={imageLabel}
          onNavigate={onNavigate}
        />
        <div className="min-w-0 flex-1 md:max-w-[666px]">{children}</div>
      </div>
    </div>
  );
}
