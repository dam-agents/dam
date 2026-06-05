import { Plus } from "lucide-react";

export function CreateSandboxCard({
  label,
  description,
  onClick,
}: {
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group anim-in flex flex-col items-start gap-1.5 rounded-xl border border-dashed border-border p-4 text-left transition-colors hover:border-primary hover:bg-primary/5"
    >
      <span className="flex items-center gap-1.5 text-[14px] font-semibold text-foreground transition-colors group-hover:text-primary">
        <Plus size={15} />
        {label}
      </span>
      <span className="text-[12px] leading-snug text-muted-foreground">
        {description}
      </span>
    </button>
  );
}
