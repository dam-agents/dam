import type { ReactNode } from "react";

import { ConnectionIcon } from "../../../connections/components/connection-icon.js";

export function ChannelCard({
  iconSlug,
  title,
  headerRight,
  children,
}: {
  iconSlug: string;
  title: string;
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      data-testid={`channel-card-${iconSlug}`}
      className="rounded-lg border border-border bg-card"
    >
      <header className="flex h-[52px] items-center gap-2.5 border-b border-border px-4">
        <ConnectionIcon
          iconSlug={iconSlug}
          alt=""
          size={16}
          className="shrink-0"
        />
        <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground">
          {title}
        </h3>
        {headerRight}
      </header>
      {children}
    </section>
  );
}
