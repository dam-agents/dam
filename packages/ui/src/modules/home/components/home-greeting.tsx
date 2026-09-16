import type { ReactNode } from "react";

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function HomeGreeting({
  title,
  actions,
}: {
  title: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-10">
      <div>
        <p className="mb-1 text-[18px] text-muted-foreground">
          {greetingFor(new Date().getHours())}
        </p>
        <h1 className="text-[40px] leading-none font-bold tracking-[-1px] text-foreground">
          {title}
        </h1>
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-3">{actions}</div>
      )}
    </div>
  );
}
