import { cn } from "@/lib/utils";

export function Caret({ className }: { className?: string }) {
  return (
    <svg
      width="10"
      height="6"
      viewBox="0 0 10 6"
      fill="none"
      aria-hidden
      className={cn("shrink-0", className)}
    >
      <path
        d="M5 5.7L0 0.7L0.7 0L5 4.3L9.3 0L10 0.7L5 5.7Z"
        fill="currentColor"
      />
    </svg>
  );
}
