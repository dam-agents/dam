import { Checkmark, Earth, Share } from "@carbon/icons-react";
import { useState } from "react";

import { SlackColorIcon } from "@/components/brand-icons";
import { Button } from "@/components/ui/button";
import {
  EmptyHero,
  MockAgentMessage,
  MockCard,
  MockChip,
  MockPrompt,
} from "@/components/ui/empty-hero";
import { PageHeader } from "@/components/ui/page-header";

import { useCreateDefaultAgent } from "../../agents/hooks/use-create-default-agent.js";
import {
  useAllEnvironments,
  useEnvironmentsEnabled,
} from "../../environments/api/queries.js";
import { SidePanelCloseScope } from "../../sessions/components/side-panel-close-button.js";
import { useArtifactFolders, useArtifacts } from "../api/queries.js";
import { ChatArtifactsPanel } from "../components/chat-artifacts-panel.js";
import { UploadArtifactDialog } from "../components/upload-artifact-dialog.js";

export function ArtifactsView() {
  const artifacts = useArtifacts({}).data;
  const folders = useArtifactFolders().data;
  const environmentsEnabled = useEnvironmentsEnabled();
  const environments = useAllEnvironments(environmentsEnabled).data;
  if (
    artifacts?.length === 0 &&
    folders?.length === 0 &&
    (!environmentsEnabled || environments?.length === 0)
  )
    return <ArtifactsEmpty />;
  return (
    <>
      <PageHeader title="Artifacts" />
      <SidePanelCloseScope value={false}>
        <ChatArtifactsPanel
          agentId={null}
          open
          className="h-[70dvh] overflow-hidden rounded-lg border border-border"
        />
      </SidePanelCloseScope>
    </>
  );
}

function ArtifactsEmpty() {
  const defaultAgent = useCreateDefaultAgent();
  const [uploading, setUploading] = useState(false);
  const bars = [30, 55, 45, 80, 60, 90, 70];
  return (
    <>
      <EmptyHero
        title="Artifacts"
        actions={
          <>
            <Button
              size="lg"
              onClick={() => void defaultAgent.create()}
              disabled={!defaultAgent.ready}
            >
              Create agent
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => setUploading(true)}
            >
              Upload artifact
            </Button>
          </>
        }
        illustration={
          <div className="flex flex-col">
            <MockPrompt className="w-[68%]">
              Pull our weekly metrics and build me a dashboard every Monday
            </MockPrompt>
            <MockChip className="top-[12%] right-[18%]">
              <Share size={14} />
            </MockChip>
            <MockCard className="z-10 -mt-2 ml-[33%] flex gap-4">
              <div className="flex w-28 shrink-0 flex-col gap-1.5 rounded-md border border-border p-2">
                <div className="flex gap-1">
                  <span className="h-2.5 flex-1 rounded-sm bg-muted" />
                  <span className="h-2.5 flex-1 rounded-sm bg-muted" />
                  <span className="h-2.5 flex-1 rounded-sm bg-success-light" />
                </div>
                <div className="flex h-10 items-end gap-1 rounded-sm border border-border px-1">
                  {bars.map((h, i) => (
                    <span
                      key={i}
                      style={{ height: `${h}%` }}
                      className={
                        i === bars.length - 1
                          ? "flex-1 bg-accent"
                          : "flex-1 bg-accent/40"
                      }
                    />
                  ))}
                </div>
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="font-semibold">Weekly metrics dashboard</div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1 rounded-full bg-success-light px-2 py-0.5 text-success">
                    <Earth size={12} />
                    Public
                  </span>
                  HTML · 38 KB
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="truncate rounded-sm border border-border px-2 py-1 font-mono text-xs">
                    {window.location.host}/a/pw4SYBykUQQ
                  </span>
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-sm border border-border text-success">
                    <Checkmark size={14} />
                  </span>
                </div>
              </div>
            </MockCard>
            <MockChip className="top-[44%] left-[4%]">
              <SlackColorIcon className="size-4" />
            </MockChip>
            <MockAgentMessage time="6:00 AM" className="mt-4 ml-[12%] w-[68%]">
              Weekly dashboard is ready. Signups up 12% this week.
              <div className="truncate text-accent">
                {window.location.host}/a/pw4SYBykUQQ…
              </div>
            </MockAgentMessage>
          </div>
        }
      >
        Pages and files your agents create land here. Preview them, share them
        with a public link, or have an agent post them to Slack when they’re
        ready.
      </EmptyHero>
      {uploading && (
        <UploadArtifactDialog
          folders={[]}
          onClose={() => setUploading(false)}
          onUploaded={() => {}}
        />
      )}
    </>
  );
}
