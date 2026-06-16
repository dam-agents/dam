import type { ReactNode } from "react";

import { SectionLabel } from "@/components/ui/section-label";

export function WizardSectionLabel({ children }: { children: ReactNode }) {
  return <SectionLabel className="mb-3 block">{children}</SectionLabel>;
}
