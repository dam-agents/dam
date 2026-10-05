import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

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
          <PageHeader title="Home" />
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
          title="Home"
          description="Each agent runs in its own isolated environment with your credentials and tools injected. Open one to work with it in chat."
          actions={
            <>
              <Button variant="outline" onClick={createAgent}>
                Create agent
              </Button>
              <Button onClick={() => setBrowsePacksOpen(true)}>
                Start from a kit
              </Button>
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

function HomeEmptyState() {
  const brand = getBrand();
  const setView = useStore((s) => s.setView);
  const setPendingPack = useStore((s) => s.setPendingPack);

  const [browsePacksOpen, setBrowsePacksOpen] = useState(false);
  const [selectedPack, setSelectedPack] = useState<Pack | null>(null);

  const createAgent = () => setView("agent-new");

  const handleCreateFromPack = (pack: Pack) => {
    setSelectedPack(null);
    setPendingPack(pack);
    setView("agent-new");
  };

  return (
    <div className="flex min-h-[calc(100vh-48px)] w-full items-center justify-center px-4 md:px-[5%]">
      <div className="anim-in w-full max-w-[1200px]">
        <div className="flex flex-col-reverse items-center gap-8 px-6 md:flex-row md:gap-12">
          <div className="flex min-w-0 flex-1 flex-col gap-5">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Welcome to {brand.name}
            </h1>
            <p className="max-w-[480px] text-[15px] leading-relaxed text-muted-foreground">
              With {brand.name}, you can deploy automated assistants that handle
              tasks like reviewing PRs, summarizing tickets, and monitoring
              builds in the cloud 24/7. Connect your tools, schedule runs, and
              share securely with your team.
            </p>
            <div className="flex items-center gap-3 pt-1">
              <Button variant="outline" onClick={createAgent}>
                Create Agent
              </Button>
              <Button onClick={() => setBrowsePacksOpen(true)}>
                Start from a Kit
              </Button>
            </div>
          </div>
          <div className="shrink-0">
            <img
              src="/illustrations/home-empty-state.svg"
              alt=""
              className="h-[280px] w-[420px] object-contain md:h-[420px] md:w-[630px]"
            />
          </div>
        </div>
      </div>

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
  );
}
