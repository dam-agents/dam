import { ArrowRight } from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { transcriptMetaForPack } from "../../../mock/data/transcripts/index.js";
import { useStore } from "../../../store.js";
import { useCreateAgent } from "../../agents/api/mutations.js";
import { BrowsePacksModal } from "../../packs/components/browse-packs-modal.js";
import type { Pack } from "../../packs/data/packs.js";
import { REAL_PACKS } from "../../packs/data/packs.js";

const SUGGESTED_IDS = ["code-guardian", "personal-assistant", "llm-wiki"];
const SUGGESTED = REAL_PACKS.filter((p) => SUGGESTED_IDS.includes(p.id));

export function KitSuggestionsEmpty() {
  const [browseOpen, setBrowseOpen] = useState(false);
  const createAgent = useCreateAgent();
  const selectAgent = useStore((s) => s.selectAgent);
  const initOnboarding = useStore((s) => s.initOnboarding);

  const applyPack = async (pack: Pack) => {
    try {
      const agent = await createAgent.mutateAsync({
        name: pack.name,
        templateId: "claude-code",
        egressPreset: "trusted",
      });
      initOnboarding(agent.id, pack);
      const meta = transcriptMetaForPack(pack.id);
      useStore.setState({
        starterKitMode: true,
        selectedStarterKitId: pack.id,
        onboardingStep: 0,
        currentTranscriptSteps: meta?.steps ?? [],
        currentTranscriptMeta: meta,
      });
      selectAgent(agent.id);
    } catch {}
  };

  const handleBrowseSelect = (pack: Pack) => {
    setBrowseOpen(false);
    void applyPack(pack);
  };

  return (
    <div className="mt-6 w-full max-w-md">
      <p className="mb-3 text-sm font-medium text-muted-foreground">
        Or start from a starter kit
      </p>
      <div className="flex flex-col gap-2">
        {SUGGESTED.map((pack) => (
          <button
            key={pack.id}
            type="button"
            onClick={() => void applyPack(pack)}
            disabled={createAgent.isPending}
            className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:border-foreground/20 disabled:opacity-60"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{pack.name}</p>
              <p className="text-sm text-muted-foreground truncate">
                {pack.tagline}
              </p>
            </div>
            <ArrowRight size={16} className="shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="mt-2"
        onClick={() => setBrowseOpen(true)}
      >
        Browse all starter kits
      </Button>
      {browseOpen && (
        <BrowsePacksModal
          open={browseOpen}
          onClose={() => setBrowseOpen(false)}
          onSelect={handleBrowseSelect}
        />
      )}
    </div>
  );
}

export function KitSuggestionsCompact() {
  const [browseOpen, setBrowseOpen] = useState(false);
  const createAgent = useCreateAgent();
  const selectAgent = useStore((s) => s.selectAgent);
  const initOnboarding = useStore((s) => s.initOnboarding);

  const handleBrowseSelect = async (pack: Pack) => {
    setBrowseOpen(false);
    try {
      const agent = await createAgent.mutateAsync({
        name: pack.name,
        templateId: "claude-code",
        egressPreset: "trusted",
      });
      initOnboarding(agent.id, pack);
      const meta = transcriptMetaForPack(pack.id);
      useStore.setState({
        starterKitMode: true,
        selectedStarterKitId: pack.id,
        onboardingStep: 0,
        currentTranscriptSteps: meta?.steps ?? [],
        currentTranscriptMeta: meta,
      });
      selectAgent(agent.id);
    } catch {}
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5"
        onClick={() => setBrowseOpen(true)}
      >
        <ArrowRight size={16} />
        Browse starter kits
      </Button>
      {browseOpen && (
        <BrowsePacksModal
          open={browseOpen}
          onClose={() => setBrowseOpen(false)}
          onSelect={handleBrowseSelect}
        />
      )}
    </>
  );
}
