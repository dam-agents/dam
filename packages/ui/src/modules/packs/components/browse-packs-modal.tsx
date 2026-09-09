import { DialogHeader, Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";

import type { Pack } from "../data/packs.js";
import { PackBrowser } from "./pack-browser.js";

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (pack: Pack) => void;
  onStartFromScratch: () => void;
}

export function BrowsePacksModal({
  open,
  onClose,
  onSelect,
  onStartFromScratch,
}: Props) {
  if (!open) return null;

  return (
    <Modal widthClass="w-[1100px]">
      <DialogHeader onClose={onClose} divided>
        <h2 className="text-lg font-semibold text-foreground">
          Browse Starter Kits
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Pick a starter kit to pre-fill your agent setup
        </p>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PackBrowser
          onSelect={(pack) => {
            onSelect(pack);
            onClose();
          }}
          className="px-6 pt-4 pb-6"
          compact
        />
      </div>
      <div className="shrink-0 border-t border-border bg-card px-6 py-4 flex justify-end">
        <Button
          variant="outline"
          onClick={() => {
            onClose();
            onStartFromScratch();
          }}
        >
          Start from scratch instead
        </Button>
      </div>
    </Modal>
  );
}
