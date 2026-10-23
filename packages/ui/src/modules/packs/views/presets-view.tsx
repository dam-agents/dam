import { useState } from "react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

import { useStore } from "../../../store.js";
import { PackBrowser } from "../components/pack-browser.js";
import { PackDetailSheet } from "../components/pack-detail-sheet.js";
import type { Pack } from "../data/packs.js";

export function PresetsView() {
  const setView = useStore((s) => s.setView);
  const setPendingPack = useStore((s) => s.setPendingPack);
  const [selectedPack, setSelectedPack] = useState<Pack | null>(null);

  const handleCreateFromPack = (pack: Pack) => {
    setSelectedPack(null);
    setPendingPack(pack);
    setView("agent-new");
  };

  return (
    <div className="anim-in">
      <PageHeader
        title="Starter Kits"
        description="Each starter kit bundles a harness, skills, schedules, and connections into a ready-made agent configuration."
        actions={
          <Button variant="outline" onClick={() => setView("agent-new")}>
            Start from scratch
          </Button>
        }
      />

      <PackBrowser onSelect={setSelectedPack} />

      <PackDetailSheet
        pack={selectedPack}
        onClose={() => setSelectedPack(null)}
        onBack={() => setSelectedPack(null)}
        onCreateFromPack={handleCreateFromPack}
        onStartFromScratch={() => {
          setSelectedPack(null);
          setView("agent-new");
        }}
      />
    </div>
  );
}
