import { Chat } from "@carbon/icons-react";

import { getBrand } from "@/brand";
import {
  IconSquare,
  IconTile,
  ILLUSTRATION_CARD,
  IllustrationCanvas,
  SlackMessage,
  TILE_LEFT,
  TILE_TOP_RIGHT,
} from "@/components/empty-illustration";
import { Badge } from "@/components/ui/badge";

import { ConnectionIcon } from "../../../connections/components/connection-icon.js";

export function ChannelsEmptyIllustration({
  className,
}: {
  className?: string;
}) {
  const brand = getBrand();
  return (
    <IllustrationCanvas className={className}>
      <SlackMessage
        className="left-[18px] top-[20px]"
        author="person"
        time="10:14 AM"
      >
        <span className="rounded bg-[#1D9BD1]/10 px-0.5 text-[#1264A3]">
          @{brand.name}
        </span>{" "}
        why did last night&rsquo;s docs deploy fail?
      </SlackMessage>

      <div
        className={`${ILLUSTRATION_CARD} left-[201px] top-[138px] flex w-[381px] items-center gap-4 rounded-xl p-4`}
      >
        <IconSquare>
          <ConnectionIcon iconSlug="slack" alt="" size={16} />
        </IconSquare>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-[23px] text-foreground">
            #docs-team
          </p>
          <p className="truncate text-[14px] leading-[22px] text-muted-foreground">
            Mentions go to this agent
          </p>
        </div>
        <Badge variant="success">Connected</Badge>
      </div>

      <SlackMessage className="left-[102px] top-[235px]" time="10:15 AM">
        An expired deploy token. I rotated it and the job is green again.
      </SlackMessage>

      <IconTile {...TILE_TOP_RIGHT}>
        <Chat size={16} />
      </IconTile>
      <IconTile {...TILE_LEFT}>
        <ConnectionIcon iconSlug="slack" alt="" size={16} />
      </IconTile>
    </IllustrationCanvas>
  );
}
