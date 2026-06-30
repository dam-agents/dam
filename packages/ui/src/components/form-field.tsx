import type { ReactNode } from "react";

import { FIELD_INSET } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import { FormError } from "./form-error.js";

interface Props {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  /** The control is outdent-aligned with the label on `md+` by default (see
   *  Inset). Set to opt out — forms not yet migrated, or containers with no
   *  gutter (nested side panels). */
  disableInset?: boolean;
  children: ReactNode;
}

export function FormField({
  label,
  hint,
  error,
  disableInset,
  children,
}: Props) {
  return (
    <label className="flex flex-col gap-2">
      <SectionLabel>{label}</SectionLabel>
      <div className={cn(!disableInset && FIELD_INSET)}>{children}</div>
      {hint && (
        <span className="text-[12px] text-muted-foreground">{hint}</span>
      )}
      <FormError message={error} />
    </label>
  );
}
