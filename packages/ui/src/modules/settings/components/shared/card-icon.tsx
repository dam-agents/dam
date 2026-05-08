import { Sparkles } from "lucide-react";

export function CardIcon({ variant }: { variant: "accent" | "warning" }) {
  return (
    <div
      className={`w-10 h-10 shrink-0 rounded-lg ${variant === "accent" ? "bg-accent" : "bg-warning"} flex items-center justify-center text-white`}
    >
      <Sparkles size={18} />
    </div>
  );
}
