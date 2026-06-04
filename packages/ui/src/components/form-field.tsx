import type { ReactNode } from "react";

import { FormError } from "./form-error.js";

interface Props {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}

export function FormField({ label, hint, error, children }: Props) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      <FormError message={error} />
    </label>
  );
}
