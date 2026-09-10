import type { CarbonIconType } from "@carbon/icons-react";
import { Chat, Code, Document, Time } from "@carbon/icons-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { CARD_SURFACE } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

import { getBrand } from "../../../brand.js";
import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStore } from "../../../store.js";
import { OutdatedTemplatesBanner } from "../../agents/components/outdated-templates-banner.js";
import { SandboxList } from "../../agents/components/sandbox-list.js";
import { useAgentRows } from "../../agents/hooks/use-agent-rows.js";
import { useSandboxRowActions } from "../../agents/hooks/use-sandbox-row-actions.js";
import { splitTemporarySandboxes } from "../../agents/utils/temporary-sandboxes.js";
import { BrowsePacksModal } from "../../packs/components/browse-packs-modal.js";
import { PackDetailSheet } from "../../packs/components/pack-detail-sheet.js";
import type { Pack } from "../../packs/data/packs.js";
import { ComputeWidget } from "../components/compute-widget.js";
import { SpendWidget } from "../components/spend-widget.js";

export function HomeView() {
  const { agentsData, initialLoaded, rowProps, deleteAgent, suspend } =
    useAgentRows();
  const { visible, drawByDriver } = splitTemporarySandboxes(
    agentsData?.list ?? [],
  );
  const { stopSandbox, deleteSandbox } = useSandboxRowActions({
    deleteAgent,
    suspend,
  });

  const setView = useStore((s) => s.setView);
  const setPendingPack = useStore((s) => s.setPendingPack);

  const [selectedPack, setSelectedPack] = useState<Pack | null>(null);
  const [browsePacksOpen, setBrowsePacksOpen] = useState(false);

  const createAgent = () => setView("agent-new");

  const handleCreateFromPack = (pack: Pack) => {
    setSelectedPack(null);
    setPendingPack(pack);
    setView("agent-new");
  };

  const runningAgents = useMemo(
    () => visible.filter((a) => a.state === "running"),
    [visible],
  );
  const workingAgentIds = useMemo(
    () =>
      new Set(
        visible
          .filter((a) => a.state === "running" && a.size?.cpu)
          .map((a) => a.id),
      ),
    [visible],
  );

  const hasAgents = initialLoaded && visible.length > 0;

  if (!initialLoaded) {
    return (
      <div className="mx-auto w-full max-w-[1200px] px-4 py-6 pb-20 md:px-[5%] md:py-10 md:pb-10">
        <div className="anim-in">
          <PageHeader title="Agents" />
          <ListSkeleton rows={2} rowHeight={70} />
        </div>
      </div>
    );
  }

  if (!hasAgents) {
    return <HomeEmptyState />;
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 pb-20 md:px-[5%] md:py-10 md:pb-10">
      <div className="anim-in">
        <PageHeader
          title="Agents"
          description="Each agent runs in its own isolated environment with your credentials and tools injected. Open one to work with it in chat."
          actions={
            <>
              <Button
                variant="outline"
                onClick={() => setBrowsePacksOpen(true)}
              >
                Browse starter kits
              </Button>
              <Button onClick={createAgent}>Create agent</Button>
            </>
          }
        />

        <OutdatedTemplatesBanner agents={visible} />

        <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
          <ComputeWidget
            runningAgents={runningAgents}
            workingAgentIds={workingAgentIds}
          />
          <SpendWidget />
        </div>

        <SandboxList
          agents={visible}
          drawByDriver={drawByDriver}
          rowProps={rowProps}
          onStop={(agent) => void stopSandbox(agent)}
          onDelete={(agent) => void deleteSandbox(agent)}
        />

        <BrowsePacksModal
          open={browsePacksOpen}
          onClose={() => setBrowsePacksOpen(false)}
          onSelect={(pack) => {
            setBrowsePacksOpen(false);
            setSelectedPack(pack);
          }}
          onStartFromScratch={createAgent}
        />

        <PackDetailSheet
          pack={selectedPack}
          onClose={() => setSelectedPack(null)}
          onBack={() => {
            setSelectedPack(null);
            setBrowsePacksOpen(true);
          }}
          onCreateFromPack={handleCreateFromPack}
          onStartFromScratch={() => {
            setSelectedPack(null);
            createAgent();
          }}
        />
      </div>
    </div>
  );
}

const WELCOME_BLOCKS: {
  icon: CarbonIconType;
  title: string;
  body: string;
}[] = [
  {
    icon: Code,
    title: "Agents",
    body: "An agent is yours to keep. It has its own files, tools, and memory. You chat with it, and it keeps working after you close the tab.",
  },
  {
    icon: Time,
    title: "Schedules",
    body: "An agent can work every morning, every Monday, or whenever you need. Tell it when and what, and it writes its own schedule.",
  },
  {
    icon: Chat,
    title: "Channels",
    body: "Bind an agent to a Slack channel and your team can talk to it there. Or connect your editor over SSH and work in its environment directly.",
  },
  {
    icon: Document,
    title: "Wikis",
    body: "Point an agent at a repo or docs and it writes them up as a wiki, keeps it current, and answers questions from it.",
  },
];

function HomeEmptyState() {
  const brand = getBrand();
  const setView = useStore((s) => s.setView);
  const setPendingPack = useStore((s) => s.setPendingPack);

  const [browseOpen, setBrowseOpen] = useState(false);
  const [selectedPack, setSelectedPack] = useState<Pack | null>(null);

  const handleCreateFromPack = (pack: Pack) => {
    setSelectedPack(null);
    setPendingPack(pack);
    setView("agent-new");
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 pb-20 md:px-[5%] md:py-10 md:pb-10">
      <div className="anim-in">
        <PageHeader
          title={`Welcome to ${brand.name}`}
          description={
            <span className="inline-block max-w-[560px]">
              {brand.name} runs agents in the cloud. Each one gets its own
              isolated environment, with your credentials and tools already set
              up.
            </span>
          }
          actions={
            <Button onClick={() => setBrowseOpen(true)}>
              Create your first agent
            </Button>
          }
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {WELCOME_BLOCKS.map((block) => {
            const Icon = block.icon;
            return (
              <div
                key={block.title}
                className={cn(CARD_SURFACE, "flex flex-col overflow-hidden")}
              >
                <div className="flex h-36 w-full items-center justify-center bg-muted/50">
                  <Icon size={32} className="text-muted-foreground/40" />
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <h3 className="text-base font-semibold text-foreground">
                    {block.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {block.body}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <BrowsePacksModal
          open={browseOpen}
          onClose={() => setBrowseOpen(false)}
          onSelect={(pack) => {
            setBrowseOpen(false);
            setSelectedPack(pack);
          }}
          onStartFromScratch={() => setView("agent-new")}
        />

        <PackDetailSheet
          pack={selectedPack}
          onClose={() => setSelectedPack(null)}
          onBack={() => {
            setSelectedPack(null);
            setBrowseOpen(true);
          }}
          onCreateFromPack={handleCreateFromPack}
          onStartFromScratch={() => {
            setSelectedPack(null);
            setView("agent-new");
          }}
        />
      </div>
    </div>
  );
}
