import type { ReactNode } from "react";

import type { WizardStep } from "../lib/wizard-snapshot.js";
import { StickyFooterLayout } from "./sticky-footer-layout.js";
import { WizardStepIndicator } from "./wizard-step-indicator.js";

interface Props {
  step: WizardStep;
  maxStep: WizardStep;
  imageLabel: string | null;
  onNavigate: (step: WizardStep) => void;
  footer?: ReactNode;
  children: ReactNode;
}

export function SandboxWizardShell({
  step,
  maxStep,
  imageLabel,
  onNavigate,
  footer,
  children,
}: Props) {
  return (
    <StickyFooterLayout footer={footer} footerClassName="max-w-[920px]">
      <div className="mx-auto w-full max-w-[920px] px-4 pt-6 pb-8 md:px-8 md:pt-12">
        <div className="flex flex-col gap-6 md:flex-row md:gap-10">
          <WizardStepIndicator
            step={step}
            maxStep={maxStep}
            imageLabel={imageLabel}
            onNavigate={onNavigate}
          />
          <div className="min-w-0 flex-1 md:max-w-[666px]">{children}</div>
        </div>
      </div>
    </StickyFooterLayout>
  );
}
