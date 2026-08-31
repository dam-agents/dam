import type { CarbonIconType } from "@carbon/icons-react";
import {
  Categories,
  Chat,
  Code,
  ConnectionSignal,
  ContainerSoftware,
  FlashFilled,
  Folders,
  Notebook,
  Play,
  Time,
} from "@carbon/icons-react";

import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/section-label";

import type { Pack, PackIngredientKind, PackSlot } from "../data/packs.js";
import { INGREDIENT_LABELS } from "../data/packs.js";

const INGREDIENT_ICONS: Record<PackIngredientKind, CarbonIconType> = {
  harness: ContainerSoftware,
  framework: Categories,
  connection: ConnectionSignal,
  channel: Chat,
  schedule: Time,
  skill: FlashFilled,
  "knowledge-base": Notebook,
  "starter-repo": Code,
  artifact: Folders,
};

interface Props {
  pack: Pack | null;
  onClose: () => void;
}

export function PackDetailSheet({ pack, onClose }: Props) {
  if (!pack) return null;

  return (
    <Modal widthClass="w-[960px]">
      <DialogHeader
        title={pack.name}
        subtitle={pack.tagline}
        onClose={onClose}
        divided={false}
        titleAccessory={
          <Badge variant="muted" size="sm">
            {pack.category}
          </Badge>
        }
      />

      <DialogBody>
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <div className="flex flex-col gap-6">
            <div>
              <SectionLabel spaced>Included</SectionLabel>
              <div className="flex flex-col gap-2">
                {pack.included.map((slot) => (
                  <SlotRow key={`${slot.kind}-${slot.label}`} slot={slot} />
                ))}
              </div>
            </div>

            {pack.required.length > 0 && (
              <div>
                <SectionLabel spaced>You'll need</SectionLabel>
                <div className="flex flex-col gap-2">
                  {pack.required.map((slot) => (
                    <SlotRow key={`${slot.kind}-${slot.label}`} slot={slot} />
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex aspect-[9/14] w-full flex-col items-center justify-center rounded-xl border border-border bg-muted">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-foreground/10">
                <Play size={16} className="ml-0.5 text-muted-foreground" />
              </div>
              <p className="mt-3 text-sm font-medium text-muted-foreground">
                See it in action
              </p>
              <p className="mt-1 text-[14px] text-muted-foreground/60">
                Video coming soon
              </p>
            </div>
          </div>
        </div>

        <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
          {pack.description}
        </p>
      </DialogBody>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button>Create agent with this pack</Button>
      </DialogFooter>
    </Modal>
  );
}

function SlotRow({ slot }: { slot: PackSlot }) {
  const Icon = INGREDIENT_ICONS[slot.kind];
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/50 px-4 py-3">
      <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg border border-border bg-card">
        <Icon size={16} className="text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground">{slot.label}</p>
          <Badge variant="muted" size="sm">
            {INGREDIENT_LABELS[slot.kind]}
          </Badge>
        </div>
        <p className="mt-0.5 text-[14px] text-muted-foreground">
          {slot.description}
        </p>
        {slot.demoValue && (
          <p className="mt-1 font-mono text-[14px] text-muted-foreground/60">
            {slot.demoValue}
          </p>
        )}
      </div>
    </div>
  );
}
