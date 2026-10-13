import { cn } from "@/lib/utils";

interface Props {
  className?: string;
}

export function NewAvatarDot({ className }: Props) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute size-2.5 rounded-full border-2 border-background bg-accent",
        className,
      )}
    />
  );
}
