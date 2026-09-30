import { cn } from "@/lib/utils";

export const POD_LEFT =
  "M19.4 3 C11 9 7 15.5 7 22.5 C7 30.5 12.5 36.5 19.4 37 Z";
export const POD_RIGHT =
  "M20.6 3 C29 9 33 15.5 33 22.5 C33 30.5 27.5 36.5 20.6 37 Z";
export const POD_LEFT_FILL = "#c1c7cd";
export const POD_RIGHT_FILL = "#dde1e6";

export function MysteryAvatar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden className={cn("shrink-0", className)}>
      <path d={POD_LEFT} fill={POD_LEFT_FILL} />
      <path d={POD_RIGHT} fill={POD_RIGHT_FILL} />
    </svg>
  );
}
