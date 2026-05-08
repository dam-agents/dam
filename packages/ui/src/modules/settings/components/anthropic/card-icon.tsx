import { cn } from "@/lib/utils";

import { AnthropicIcon } from "../brand-icons.js";

export function CardIcon({ variant }: { variant: "accent" | "warning" }) {
  return (
    <div
      className={cn(
        "w-10 h-10 shrink-0 rounded-lg flex items-center justify-center text-white",
        variant === "accent" ? "bg-[#D97757]" : "bg-warning",
      )}
    >
      <AnthropicIcon className="w-5 h-5" />
    </div>
  );
}
