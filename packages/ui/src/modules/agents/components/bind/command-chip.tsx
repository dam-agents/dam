import type { ReactNode } from "react";

export function withCommandChips(text: string): ReactNode[] {
  return text
    .split("`")
    .map((part, i) =>
      i % 2 === 1 ? <CommandChip key={i}>{part}</CommandChip> : part,
    );
}

export function CommandChip({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em] text-foreground">
      {children}
    </code>
  );
}
