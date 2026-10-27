import { useState } from "react";

import { DialogBody, DialogHeader, Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";

import { transcriptMetaForPack } from "../../../mock/data/transcripts/index.js";
import { useStore } from "../../../store.js";
import { useCreateAgent } from "../../agents/api/mutations.js";
import { BrowsePacksModal } from "../../packs/components/browse-packs-modal.js";
import type { Pack } from "../../packs/data/packs.js";
import { REAL_PACKS } from "../../packs/data/packs.js";
import { FreeBudgetBanner } from "./free-budget-banner.js";

export function Approach2Modal({ onClose }: { onClose: () => void }) {
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
      onClose();
    } catch {}
  };

  const handleBlankStart = async () => {
    try {
      const agent = await createAgent.mutateAsync({
        name: "agent",
        templateId: "claude-code",
        egressPreset: "trusted",
      });
      selectAgent(agent.id);
      onClose();
    } catch {}
  };

  const handleSelectPack = (pack: Pack) => {
    setBrowseOpen(false);
    void applyPack(pack);
  };

  return (
    <>
      <Modal widthClass="w-[560px]">
        <DialogHeader
          title="How do you want to start?"
          subtitle="Pick a starter kit or jump straight into a blank chat"
          onClose={onClose}
        />
        <DialogBody>
          <div className="mb-6">
            <FreeBudgetBanner />
          </div>

          <div className="flex flex-col gap-4">
            <button
              type="button"
              onClick={handleBlankStart}
              disabled={createAgent.isPending}
              className="flex flex-col gap-2 rounded-lg border-2 border-info/40 bg-info/5 p-4 text-left transition-colors hover:border-info/60 disabled:opacity-60"
            >
              <h3 className="text-base font-semibold text-foreground">
                Blank chat
              </h3>
              <p className="text-sm text-muted-foreground">
                Start chatting immediately with a vanilla agent — no preset
                configuration.
              </p>
            </button>

            <div className="relative flex items-center gap-3 py-2">
              <div className="flex-1 border-t border-border" />
              <span className="text-sm text-muted-foreground">or</span>
              <div className="flex-1 border-t border-border" />
            </div>

            <div className="flex flex-col gap-2">
              {REAL_PACKS.slice(0, 3).map((pack) => (
                <button
                  key={pack.id}
                  type="button"
                  onClick={() => void applyPack(pack)}
                  disabled={createAgent.isPending}
                  className="flex flex-col gap-1 rounded-lg border border-border p-4 text-left transition-colors hover:border-foreground/20 disabled:opacity-60"
                >
                  <p className="text-sm font-medium text-foreground">
                    {pack.name}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {pack.tagline}
                  </p>
                </button>
              ))}
            </div>

            <Button
              variant="outline"
              size="lg"
              className="w-full"
              onClick={() => setBrowseOpen(true)}
            >
              Browse all starter kits
            </Button>
          </div>
        </DialogBody>
      </Modal>

      {browseOpen && (
        <BrowsePacksModal
          open={browseOpen}
          onClose={() => setBrowseOpen(false)}
          onSelect={handleSelectPack}
        />
      )}
    </>
  );
}
