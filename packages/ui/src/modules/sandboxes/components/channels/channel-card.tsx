import type { ReactNode } from "react";

import { PanelCard } from "@/components/ui/panel-card";

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
    <PanelCard
      testId={`channel-card-${iconSlug}`}
      title={title}
      headerRight={headerRight}
      icon={
        <ConnectionIcon
          iconSlug={iconSlug}
          alt=""
          size={16}
          className="shrink-0"
        />
      }
    >
      {children}
    </PanelCard>
  );
}
