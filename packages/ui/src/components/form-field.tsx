import type { ReactNode } from "react";

import { FIELD_INSET } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import { FormError } from "./form-error.js";

interface Props {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  /** Outdent the control on `md+` so its text aligns with the label. On by
   *  default for new-design forms; pass `false` for forms not yet migrated. */
  inset?: boolean;
  children: ReactNode;
}

export function FormField({
  label,
  hint,
  error,
  inset = true,
  children,
}: Props) {
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
