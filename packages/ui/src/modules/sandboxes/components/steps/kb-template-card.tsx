import { cn } from "@/lib/utils";

import type { KbTemplate } from "../../../knowledge-bases/lib/kb-templates.js";

interface Props {
  template: KbTemplate;
  selected: boolean;
  onSelect: () => void;
}

/** One installation procedure — the user-facing "Template", not the image. */
export function KbTemplateCard({ template, selected, onSelect }: Props) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "w-full rounded-lg border px-4 py-3 text-left transition-colors",
        selected
          ? "border-foreground bg-card"
          : "border-border bg-card hover:bg-muted/30",
      )}
    >
      <p className="text-[16px] font-medium text-foreground leading-[1.2]">
        {template.name}
      </p>
      <p className="text-[14px] text-muted-foreground">
        {template.description}
      </p>
    </button>
  );
}
