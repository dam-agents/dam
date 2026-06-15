import type { WizardStep } from "../lib/wizard-snapshot.js";

interface Props {
  step: WizardStep;
  title: string;
  subtitle: string;
}

export function StepHeader({ step, title, subtitle }: Props) {
  return (
    <div className="mb-8">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        Step {step} of 3
      </p>
      <h1 className="mt-2 text-[24px] font-semibold tracking-[-0.5px] text-foreground">
        {title}
      </h1>
      <p className="mt-1 text-[14px] text-muted-foreground">{subtitle}</p>
    </div>
  );
}
