import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";

import { INGREDIENT_ICON, type Pack } from "../data/packs.js";

/**
 * The demo agent becomes the user's. Each sample slot becomes a thing to fill
 * in — the same slot list, so nothing is modelled twice. Applying is never
 * blocked on an unfilled slot; the agent keeps working with less.
 */
interface Props {
  pack: Pack;
  onClose: () => void;
  onConfirm: () => void;
}

export function MakeMineModal({ pack, onClose, onConfirm }: Props) {
  return (
    <Modal widthClass="w-[560px]">
      <DialogHeader
        title="Make this agent yours"
        subtitle="Swap the sample content for your own. You can do it later instead."
        onClose={onClose}
      />
      <DialogBody>
        <div className="flex flex-col gap-2">
          {pack.slots.map((slot) => {
            const Icon = INGREDIENT_ICON[slot.kind];
            return (
              <div
                key={slot.label}
                className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
                  <Icon className="size-4 text-muted-foreground" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {slot.label}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Replaces {slot.demoValue}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </DialogBody>
      <DialogActions
        onCancel={onClose}
        cancelLabel="Later"
        label="Keep this agent"
        pendingLabel="Saving…"
        onSubmit={onConfirm}
      />
    </Modal>
  );
}
