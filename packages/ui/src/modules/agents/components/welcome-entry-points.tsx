import { Time } from "@carbon/icons-react";

import { SlackColorIcon } from "@/components/brand-icons";
import {
  EmptyHero,
  MockAgentMessage,
  MockCard,
  MockChip,
  MockPrompt,
} from "@/components/ui/empty-hero";

import { getBrand } from "../../../brand.js";
import { EntryPointButtons } from "./entry-point-buttons.js";

export function WelcomeEntryPoints() {
  const brand = getBrand().name;
  return (
    <EmptyHero
      title={`Welcome to ${brand}`}
      actions={<EntryPointButtons hero />}
      illustration={
        <div className="flex flex-col">
          <MockPrompt className="w-[75%]">
            Create a schedule to review new PRs every weekday at 9am
          </MockPrompt>
          <MockChip className="top-[18%] right-[8%] bg-accent-light text-accent">
            <Time size={16} />
          </MockChip>
          <MockCard className="z-10 -mt-1 ml-[33%] flex items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-light text-accent">
              <Time size={16} />
            </span>
            <div className="min-w-0">
              <div className="font-semibold">Weekday PR Review</div>
              <div className="truncate text-xs text-muted-foreground">
                Every weekday at 9AM · Next tomorrow at 9AM
              </div>
            </div>
          </MockCard>
          <MockChip className="top-[48%] left-[10%]">
            <SlackColorIcon className="size-4" />
          </MockChip>
          <MockAgentMessage time="9:03 AM" className="mt-6 ml-[8%] w-[75%]">
            Reviewed 3 new PRs. #142 has an unhandled error path — left a
            comment on the diff.
          </MockAgentMessage>
        </div>
      }
    >
      With {brand}, you can deploy automated assistants that handle tasks like
      reviewing PRs, summarizing tickets, and monitoring builds in the cloud
      24/7. Connect your tools, schedule runs, and share securely with your
      team.
    </EmptyHero>
  );
}
