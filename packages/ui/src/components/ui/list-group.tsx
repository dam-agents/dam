import type { ReactNode } from "react";

/**
 * UNIT_BOUNDARY_DESCRIPTION: A titled group of rows inside a ListSection card,
 * for lists whose items fall into kinds, such as connections by provider.
 */
export function ListGroup({
  icon,
  title,
  accessory,
  testId,
  children,
}: {
  icon?: ReactNode;
  title: string;
  accessory?: ReactNode;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <section data-testid={testId}>
      <header className="flex h-10 items-center gap-2 border-b border-border bg-muted/30 px-4">
        {icon}
        <h3 className="min-w-0 truncate text-sm font-semibold text-foreground">
          {title}
        </h3>
        {accessory}
      </header>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}
