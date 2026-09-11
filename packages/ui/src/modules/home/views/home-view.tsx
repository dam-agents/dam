import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
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
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 pb-20 md:px-[5%] md:py-10 md:pb-10">
      <div className="anim-in">
        <Callout tone="muted" className="flex flex-col gap-4 py-8">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Welcome to {brand.name}
          </h1>
          <p className="max-w-[480px] text-[14px] text-foreground/80">
            {brand.name} runs agents in the cloud. Each one gets its own
            isolated environment, with your credentials and tools already set
            up.
          </p>
          <Button className="w-fit" onClick={() => setBrowsePacksOpen(true)}>
            Create agent
          </Button>
        </Callout>
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
