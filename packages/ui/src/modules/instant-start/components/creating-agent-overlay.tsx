import { cn } from "@/lib/utils";

export function CreatingAgentOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="relative size-10">
          <div
            className={cn(
              "absolute inset-0 rounded-full border-2 border-muted-foreground/20",
              "border-t-foreground animate-spin",
            )}
          />
        </div>
        <div>
          <p className="text-base font-semibold text-foreground">
            Setting up your agent…
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            This takes just a moment
          </p>
        </div>
      </div>
    </div>
  );
}
