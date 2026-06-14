import type { ReactNode } from "react";

/** Small uppercase section heading used across the wizard steps. */
export function WizardSectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </p>
  );
}
