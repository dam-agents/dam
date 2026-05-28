import type { ReactNode } from "react";

import { FormError } from "./form-error.js";

const LABEL_CLASS =
  "text-[11px] font-bold text-text-secondary uppercase tracking-[0.03em]";
const HINT_CLASS = "text-[11px] text-text-muted";

interface Props {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}

/**
 * Label + input + hint + error scaffold. `children` is whatever input-like
 * element the form needs; the wrapper `<label>` implicitly associates them so
 * no `htmlFor` is required. For inputs that can't live inside a `<label>`
 * (file drop zones) open-code the layout with a `<div>`.
 */
export function FormField({ label, hint, error, children }: Props) {
  return (
    <label className="flex flex-col gap-2">
      <span className={LABEL_CLASS}>{label}</span>
      {children}
      {hint && <span className={HINT_CLASS}>{hint}</span>}
      <FormError message={error} />
    </label>
  );
}
