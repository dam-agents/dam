import type { ReactNode } from "react";

import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import { FormError } from "./form-error.js";

interface Props {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  className?: string;
  children: ReactNode;
}

export function FormField({ label, hint, error, className, children }: Props) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label className="contents">
        <SectionLabel>{label}</SectionLabel>
        {children}
      </label>
      {hint && <span className="text-sm text-muted-foreground">{hint}</span>}
      <FormError message={error} />
    </div>
  );
}
