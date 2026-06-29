import type { ReactNode } from "react";

import { FIELD_INSET } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import { FormError } from "./form-error.js";

interface Props {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  /** Outdent the control to align its text with the label on `md+`. Use on
   *  base-level page forms; leave off in modals and nested containers. */
  inset?: boolean;
  children: ReactNode;
}

export function FormField({ label, hint, error, inset, children }: Props) {
  return (
    <label className="flex flex-col gap-2">
      <SectionLabel>{label}</SectionLabel>
      <div className={cn(inset && FIELD_INSET)}>{children}</div>
      {hint && (
        <span className="text-[12px] text-muted-foreground">{hint}</span>
      )}
      <FormError message={error} />
    </label>
  );
}
