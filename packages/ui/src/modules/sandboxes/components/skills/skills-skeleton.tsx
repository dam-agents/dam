import { Card } from "@/components/ui/card";

/** Placeholder rows shown while a source's skills load, shaped like the real
 *  skill rows so the card doesn't reflow (and never flashes "No skills"). The
 *  bars sit inside `<p>` lines with the same font-sizes as `SkillRow`, so each
 *  row's line-box height matches the real one exactly. */
export function SkillRowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-t border-border px-4 py-3"
        >
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-medium">
              <span className="inline-block h-[0.7em] w-32 rounded bg-muted align-middle" />
            </p>
            <p className="text-sm">
              <span className="inline-block h-[0.7em] w-48 rounded bg-muted/60 align-middle" />
            </p>
          </div>
          <div className="h-5 w-9 shrink-0 rounded-full bg-muted" />
        </div>
      ))}
    </div>
  );
}

/** A whole source-card placeholder, for the initial sources fetch. Header
 *  mirrors `SkillSourceCard`'s two-line header typography. */
export function SkillSourcesSkeleton({ cards = 2 }: { cards?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: cards }).map((_, i) => (
        <Card key={i}>
          <div className="animate-pulse px-4 py-3">
            <p className="text-[15px] font-semibold">
              <span className="inline-block h-[0.7em] w-40 rounded bg-muted align-middle" />
            </p>
            <p className="text-sm">
              <span className="inline-block h-[0.7em] w-56 rounded bg-muted/60 align-middle" />
            </p>
          </div>
          <SkillRowsSkeleton rows={2} />
        </Card>
      ))}
    </div>
  );
}
