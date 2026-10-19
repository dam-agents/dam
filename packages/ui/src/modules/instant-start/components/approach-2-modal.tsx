import { useState } from "react";

import { DialogBody, DialogHeader, Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { useCreateAgent } from "../../agents/api/mutations.js";
import type { Pack } from "../../packs/data/packs.js";
import { BrowsePacksModal } from "../../packs/components/browse-packs-modal.js";
import { FreeBudgetBanner } from "./free-budget-banner.js";

export function Approach2Modal({ onClose }: { onClose: () => void }) {
  const [browseOpen, setBrowseOpen] = useState(false);
  const createAgent = useCreateAgent();
  const selectAgent = useStore((s) => s.selectAgent);

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
    void handleBlankStart();
  };

  return (
    <>
      <Modal size="lg" onClose={onClose}>
        <DialogHeader
          title="How do you want to start?"
          subtitle="Pick a pack or jump straight into a blank chat"
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

            <Button
              variant="outline"
              size="lg"
              className="w-full"
              onClick={() => setBrowseOpen(true)}
            >
              Browse packs
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
