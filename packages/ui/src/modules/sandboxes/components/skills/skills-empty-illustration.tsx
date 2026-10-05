import { Checkmark, Document } from "@carbon/icons-react";

import { GithubIcon } from "@/components/brand-icons";
import {
  Bar,
  IconTile,
  ILLUSTRATION_CARD,
  IllustrationCanvas,
  SlackMessage,
  TILE_LEFT,
  TILE_TOP_RIGHT,
} from "@/components/empty-illustration";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const SOURCE_SKILLS = [
  { name: "link-checker", installed: true },
  { name: "release-notes", installed: true },
  { name: "triage-issues", installed: false },
];

export function SkillsEmptyIllustration({ className }: { className?: string }) {
  return (
    <IllustrationCanvas className={className}>
      <div
        className={`${ILLUSTRATION_CARD} left-[18px] top-[20px] w-[380px] px-4 py-3`}
      >
        <div className="flex items-center gap-2">
          <GithubIcon width={16} height={16} />
          <p className="truncate text-[15px] font-semibold leading-[23px] text-foreground">
            docs-team/agent-skills
          </p>
        </div>
        <div className="mt-2 divide-y divide-border border-t border-border">
          {SOURCE_SKILLS.map((s) => (
            <div key={s.name} className="flex h-8 items-center justify-between">
              <span className="font-mono text-[13px] text-foreground">
                {s.name}
              </span>
              {s.installed ? (
                <span className="flex items-center gap-1 text-[14px] text-muted-foreground">
                  <Checkmark size={16} className="text-success" />
                  Installed
                </span>
              ) : (
                <Button variant="outline" size="xs">
                  Install
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div
        className={`${ILLUSTRATION_CARD} left-[201px] top-[164px] flex w-[381px] gap-4 rounded-xl p-4`}
      >
        <div className="flex h-[84px] w-[112px] shrink-0 flex-col gap-[5px] overflow-hidden rounded border border-border bg-white px-2.5 py-2">
          <Bar tone="title" className="h-[5px] w-[64%]" />
          <Bar className="mt-1 h-[3px] w-[90%]" />
          <Bar className="h-[3px] w-[78%]" />
          <Bar className="h-[3px] w-[84%]" />
          <Bar tone="title" className="mt-1 h-[4px] w-[40%]" />
          <Bar className="h-[3px] w-[70%]" />
          <Bar className="h-[3px] w-[88%]" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="truncate text-[15px] font-semibold leading-[23px] text-foreground">
            link-checker
          </p>
          <p className="truncate text-[14px] leading-[22px] text-muted-foreground">
            Finds broken links on a site
          </p>
          <div className="mt-auto flex items-center gap-2 text-[14px] leading-[22px] text-muted-foreground">
            <Badge variant="success">Installed</Badge>
            <span className="font-mono text-[12px]">
              SKILL.md &middot; 2 KB
            </span>
          </div>
        </div>
      </div>

      <SlackMessage className="left-[102px] top-[290px]" time="2:47 AM">
        Ran link-checker. 3 broken links found.
      </SlackMessage>

      <IconTile {...TILE_TOP_RIGHT}>
        <Document size={16} />
      </IconTile>
      <IconTile {...TILE_LEFT}>
        <GithubIcon width={16} height={16} />
      </IconTile>
    </IllustrationCanvas>
  );
}
