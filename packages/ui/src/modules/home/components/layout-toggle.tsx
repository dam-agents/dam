import { cn } from "@/lib/utils";

export type HomeLayout = "feed" | "combined";

interface Props {
  value: HomeLayout;
  onChange: (layout: HomeLayout) => void;
}

const OPTIONS: { value: HomeLayout; label: string }[] = [
  { value: "feed", label: "Feed" },
  { value: "combined", label: "Combined" },
];

export function LayoutToggle({ value, onChange }: Props) {
  if (!import.meta.env.VITE_MOCK) return null;

  return (
    <div className="flex gap-0.5 rounded-lg border border-border/50 bg-muted/40 p-0.5">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm transition-colors",
            value === opt.value
              ? "bg-background font-medium text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
