import { ArrowRight } from "@carbon/icons-react";
import type { EntryPointChoice } from "api-server-api";
import { useState } from "react";

import { CARD_HOVER, CARD_SURFACE } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { externalLinkProps } from "@/lib/external-link";
import { cn } from "@/lib/utils";

import { getBrand } from "../../../brand.js";
import { DOCS_URL } from "../../../constants.js";
import { useStore } from "../../../store.js";
import { PackDetailSheet } from "../../packs/components/pack-detail-sheet.js";
import { PackIngredientSummary } from "../../packs/components/pack-ingredient-summary.js";
import { FEATURED_PRESET_IDS } from "../../packs/data/featured-presets.js";
import { type Pack, PACKS } from "../../packs/data/packs.js";
import { createDemoAgent } from "../../packs/lib/create-demo-agent.js";
import { seedDemoChat } from "../../packs/lib/seed-demo-chat.js";
import { useRecordEntryPoint } from "../../usage/api/mutations.js";

const featuredPacks = FEATURED_PRESET_IDS.map((id) =>
  PACKS.find((p) => p.id === id),
).filter((p): p is Pack => p != null);

export function WelcomeEntryPoints() {
  const setView = useStore((s) => s.setView);
  const setPendingPack = useStore((s) => s.setPendingPack);
  const selectAgent = useStore((s) => s.selectAgent);
  const demoAgents = useStore((s) => s.demoAgents);
  const recordEntryPoint = useRecordEntryPoint();
  const [selectedPack, setSelectedPack] = useState<Pack | null>(null);

  const startFromScratch = () => {
    recordEntryPoint.mutate({ choice: "sandbox" satisfies EntryPointChoice });
    setView("agent-new");
  };

  const handleCreateFromPack = (pack: Pack) => {
    setSelectedPack(null);
    setPendingPack(pack);
    setView("agent-new");
  };

  const handleTryIt = (pack: Pack) => {
    setSelectedPack(null);
    const existingDemoId = demoAgents.get(pack.id);
    if (existingDemoId) {
      selectAgent(existingDemoId);
      seedDemoChat(pack);
      return;
    }
    const agentId = createDemoAgent(pack);
    selectAgent(agentId);
    seedDemoChat(pack);
  };

  return (
    <div className="anim-in">
      <h1 className="text-[32px] font-bold leading-tight tracking-[-0.5px] text-foreground">
        Accelerate research with {getBrand().name}
      </h1>
      <p className="mt-2 text-base leading-relaxed text-muted-foreground">
        Run agents in isolated cloud environments with credentials and tools
        securely injected — then trigger them from Slack or on a schedule.
      </p>

      <div className="mt-10">
        <SectionLabel>Start with a preset</SectionLabel>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {featuredPacks.map((pack) => {
            const PackIcon = pack.icon;
            return (
              <button
                key={pack.id}
                type="button"
                onClick={() => setSelectedPack(pack)}
                className={cn(
                  CARD_SURFACE,
                  CARD_HOVER,
                  "flex flex-col overflow-hidden text-left",
                )}
              >
                <div className="flex h-28 w-full items-center justify-center bg-preset-light">
                  <PackIcon size={16} className="text-preset/40" />
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <h4 className="text-sm font-semibold text-foreground">
                    {pack.name}
                  </h4>
                  <p className="mt-1 flex-1 text-sm leading-relaxed text-muted-foreground">
                    {pack.tagline}
                  </p>
                  <div className="mt-3">
                    <PackIngredientSummary pack={pack} />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setView("packs")}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
        >
          Browse all presets
          <ArrowRight size={16} className="shrink-0" />
        </button>
        <button
          type="button"
          onClick={startFromScratch}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          Start from scratch
          <ArrowRight size={16} className="shrink-0" />
        </button>
      </div>

      <div className="mt-6 flex justify-end">
        <a
          href={DOCS_URL}
          {...externalLinkProps}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
        >
          Or check out the Documentation
          <ArrowRight size={16} className="shrink-0" />
        </a>
      </div>

      <PackDetailSheet
        pack={selectedPack}
        onClose={() => setSelectedPack(null)}
        onCreateFromPack={handleCreateFromPack}
        onTryIt={handleTryIt}
      />
    </div>
  );
}
