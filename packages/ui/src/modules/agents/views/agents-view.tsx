import type { EntryPointChoice } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStore } from "../../../store.js";
import { BrowsePacksModal } from "../../packs/components/browse-packs-modal.js";
import { PackBrowser } from "../../packs/components/pack-browser.js";
import { PackDetailSheet } from "../../packs/components/pack-detail-sheet.js";
import type { Pack } from "../../packs/data/packs.js";
import { useRecordEntryPoint } from "../../usage/api/mutations.js";
import { OutdatedTemplatesBanner } from "../components/outdated-templates-banner.js";
import { SandboxList } from "../components/sandbox-list.js";
import { useAgentRows } from "../hooks/use-agent-rows.js";
import { useSandboxRowActions } from "../hooks/use-sandbox-row-actions.js";
import { splitTemporarySandboxes } from "../utils/temporary-sandboxes.js";

export function AgentsView() {
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
  const recordEntryPoint = useRecordEntryPoint();

  const [selectedPack, setSelectedPack] = useState<Pack | null>(null);
  const [browsePacksOpen, setBrowsePacksOpen] = useState(false);

  const createAgent = () => setView("agent-new");

  const handleCreateFromPack = (pack: Pack) => {
    recordEntryPoint.mutate({ choice: "sandbox" satisfies EntryPointChoice });
    setSelectedPack(null);
    setPendingPack(pack);
    setView("agent-new");
  };

  const isEmpty = initialLoaded && visible.length === 0;

  return (
    <div
      className={cn(
        "mx-auto w-full px-4 py-6 pb-20 md:px-[5%] md:py-10 md:pb-10",
        isEmpty ? "max-w-[1200px]" : "max-w-[960px]",
      )}
    >
      <PageHeader
        title={visible.length > 0 ? "Agents" : "Choose how to get started"}
        description={
          visible.length > 0 ? (
            "Each agent runs in its own isolated environment with your credentials and tools injected. Open one to work with it in chat."
          ) : (
            <span className="inline-block max-w-[640px]">
              You can start by choosing a preset. Each purpose-built preset
              bundles a harness, skills, schedules, and connections. Or, you can
              simply start from scratch.
            </span>
          )
        }
        actions={
          visible.length > 0 ? (
            <>
              <Button
                variant="outline"
                onClick={() => setBrowsePacksOpen(true)}
              >
                Browse presets
              </Button>
              <Button onClick={createAgent}>Create agent</Button>
            </>
          ) : (
            <Button variant="outline" onClick={createAgent}>
              Or start from scratch
            </Button>
          )
        }
      />

      {!initialLoaded && <ListSkeleton rows={2} rowHeight={70} />}

      {initialLoaded && <OutdatedTemplatesBanner agents={visible} />}

      {isEmpty && <PackBrowser onSelect={setSelectedPack} />}

      {initialLoaded && (
        <SandboxList
          agents={visible}
          drawByDriver={drawByDriver}
          rowProps={rowProps}
          onStop={(agent) => void stopSandbox(agent)}
          onDelete={(agent) => void deleteSandbox(agent)}
        />
      )}

      <PackDetailSheet
        pack={selectedPack}
        onClose={() => setSelectedPack(null)}
        onBack={() => setSelectedPack(null)}
        onCreateFromPack={handleCreateFromPack}
        onStartFromScratch={() => {
          setSelectedPack(null);
          createAgent();
        }}
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
    </div>
  );
}
