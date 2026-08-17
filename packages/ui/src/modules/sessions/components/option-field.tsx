import { ChevronDown } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { READ_ONLY_FIELD_BASE } from "@/components/ui/read-only-field";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

export function OptionField({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <SectionLabel className="mb-1.5 block">{title}</SectionLabel>
      {children}
    </div>
  );
}

export function ReadOnlyOptionFace({
  label,
  hint,
}: {
  label: string;
  hint?: string;
}) {
  return (
    <div
      aria-disabled="true"
      className={cn(
        READ_ONLY_FIELD_BASE,
        "min-h-10 cursor-not-allowed justify-between gap-2 py-1.5",
      )}
    >
      <span className="flex min-w-0 flex-col items-start gap-px">
        <span className="max-w-full truncate">{label}</span>
        {hint && (
          <span className="max-w-full truncate text-[11px] leading-snug">
            {hint}
          </span>
        )}
      </span>
      <ChevronDown size={14} className="shrink-0" />
    </div>
  );
}
