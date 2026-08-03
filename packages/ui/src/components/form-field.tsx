import type { ReactNode } from "react";

import { FIELD_INSET, LABEL_INSET } from "@/components/ui/inset";
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
  /** Gutter-less containers (modals, bordered boxes): keep the control flush
   *  inside the container padding and indent the label to it, instead of
   *  outdenting the control onto the border. Ignored when `disableInset`. */
  labelInset?: boolean;
  className?: string;
  children: ReactNode;
}

export function FormField({
  label,
  hint,
  error,
  disableInset,
  labelInset,
  className,
  children,
}: Props) {
  const indentLabel = !disableInset && labelInset;
  return (
    <label className={cn("flex flex-col gap-2", className)}>
      <SectionLabel className={cn(indentLabel && LABEL_INSET)}>
        {label}
      </SectionLabel>
      <div className={cn(!disableInset && !labelInset && FIELD_INSET)}>
        {children}
      </div>
      {hint && <span className="text-sm text-muted-foreground">{hint}</span>}
      <FormError message={error} />
    </label>
  );
}
