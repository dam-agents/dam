import { Plus } from "lucide-react";

export function CreateSandboxCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="anim-in flex items-center justify-center gap-2 rounded-lg border border-dashed border-border px-5 py-4 text-[14px] font-semibold text-muted-foreground hover:border-primary hover:text-primary transition-colors"
    >
      <Plus size={18} />
      Create sandbox
    </button>
  );
}
