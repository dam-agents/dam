import type { ReactNode } from "react";

import { PanelCard } from "@/components/ui/panel-card";

import { ConnectionIcon } from "../../../connections/components/connection-icon.js";

export function ChannelCard({
  iconSlug,
  title,
  titleAccessory,
  headerRight,
  children,
}: {
  iconSlug: string;
  title: string;
  titleAccessory?: ReactNode;
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  return (
    <PanelCard
      testId={`channel-card-${iconSlug}`}
      title={title}
      titleAccessory={titleAccessory}
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
