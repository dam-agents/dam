import { Password } from "@carbon/icons-react";

import { GithubIcon } from "@/components/brand-icons";
import {
  IconSquare,
  IconTile,
  ILLUSTRATION_CARD,
  IllustrationCanvas,
  SlackLink,
  SlackMessage,
  TILE_LEFT,
  TILE_TOP_RIGHT,
} from "@/components/empty-illustration";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

import { ConnectionIcon } from "./connection-icon.js";

export function ConnectionsEmptyIllustration({
  className,
}: {
  className?: string;
}) {
  return (
    <IllustrationCanvas className={className}>
      <div
        className={`${ILLUSTRATION_CARD} left-[18px] top-[20px] w-[380px] divide-y divide-border px-4`}
      >
        <div className="flex items-center gap-3 py-3">
          <IconSquare>
            <GithubIcon width={16} height={16} />
          </IconSquare>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold leading-[23px] text-foreground">
              GitHub
            </p>
            <p className="truncate text-[14px] leading-[22px] text-muted-foreground">
              Repos, issues and pull requests
            </p>
          </div>
          <Badge variant="success">Connected</Badge>
        </div>
        <div className="flex items-center gap-3 py-3">
          <IconSquare>
            <ConnectionIcon iconSlug="google-drive" alt="" size={16} />
          </IconSquare>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold leading-[23px] text-foreground">
              Google Drive
            </p>
            <p className="truncate text-[14px] leading-[22px] text-muted-foreground">
              Docs, sheets and slides
            </p>
          </div>
          <Button variant="outline" size="xs">
            Connect
          </Button>
        </div>
      </div>

      <div
        className={`${ILLUSTRATION_CARD} left-[201px] top-[154px] flex w-[381px] items-center gap-4 rounded-xl p-4`}
      >
        <IconSquare>
          <GithubIcon width={16} height={16} />
        </IconSquare>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-[23px] text-foreground">
            Docs monitor can use GitHub
          </p>
          <p className="truncate font-mono text-[12px] leading-[22px] text-muted-foreground">
            api.github.com allowed
          </p>
        </div>
        <Switch checked onCheckedChange={() => {}} />
      </div>

      <SlackMessage className="left-[102px] top-[251px]" time="2:52 AM">
        Opened a PR fixing the 3 broken links.
        <SlackLink>github.com/docs-site/docs/pull/218</SlackLink>
      </SlackMessage>

      <IconTile {...TILE_TOP_RIGHT}>
        <Password size={16} />
      </IconTile>
      <IconTile {...TILE_LEFT}>
        <GithubIcon width={16} height={16} />
      </IconTile>
    </IllustrationCanvas>
  );
}
