export function SessionListSkeleton() {
  return (
    <div aria-hidden className="animate-pulse">
      <div className="flex flex-col gap-0.5 rounded-lg py-1.5 pr-2 pl-9">
        <span className="text-sm">
          <span className="inline-block h-[0.7em] w-1/2 rounded bg-muted align-middle" />
        </span>
        <span className="text-2xs">
          <span className="inline-block h-[0.7em] w-1/4 rounded bg-muted/60 align-middle" />
        </span>
      </div>
    </div>
  );
}
