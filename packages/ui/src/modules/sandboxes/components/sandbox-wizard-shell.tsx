import type { ReactNode } from "react";

import type { WizardStep } from "../lib/wizard-snapshot.js";
import { SandboxTwoColumnShell } from "./sandbox-two-column-shell.js";
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
    <SandboxTwoColumnShell
      footer={footer}
      nav={
        <WizardStepIndicator
          step={step}
          maxStep={maxStep}
          imageLabel={imageLabel}
          onNavigate={onNavigate}
        />
      }
    >
      {children}
    </SandboxTwoColumnShell>
  );
}
