import type { ReactNode } from "react";

import { FIELD_INSET, LABEL_INSET } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import { FormError } from "./form-error.js";

interface Props {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  disableInset?: boolean;
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
    <div className={cn("flex flex-col gap-2", className)}>
      <label className="flex flex-col gap-2">
        <SectionLabel className={cn(indentLabel && LABEL_INSET)}>
          {label}
        </SectionLabel>
        <div className={cn(!disableInset && !labelInset && FIELD_INSET)}>
          {children}
        </div>
      </label>
      {hint && <span className="text-sm text-muted-foreground">{hint}</span>}
      <FormError message={error} />
    </div>
  );
}
