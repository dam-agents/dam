import { CheckmarkFilled, Launch } from "@carbon/icons-react";
import type { ReactNode } from "react";

import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

import {
  INGREDIENT_ICON,
  type Pack,
  type PackIngredient,
  type PackSlot,
} from "../data/packs.js";

function Row({
  kind,
  name,
  detail,
  trailing,
}: {
  kind: PackIngredient["kind"];
  name: string;
  detail: string;
  trailing?: ReactNode;
}) {
  const Icon = INGREDIENT_ICON[kind];
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
        <Icon className="size-4 text-muted-foreground" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{name}</p>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </div>
      {trailing}
    </div>
  );
}

/**
 * A slot the user can already fill is worth saying so. An unmet one never blocks
 * the primary action — it is a note about what makes the agent more useful.
 */
function slotState(
  slot: PackSlot,
  connectedTemplateIds: ReadonlySet<string>,
): { detail: string; met: boolean } {
  if (!slot.templateIds) return { detail: "Add it now or later", met: false };
  const met = slot.templateIds.some((id) => connectedTemplateIds.has(id));
  return met
    ? { detail: "You have one of these", met: true }
    : { detail: "Not connected yet", met: false };
}

interface Props {
  pack: Pack | null;
  /** Set when the user came from an agent, so the primary action applies instead. */
  applyToName?: string;
  /** Connection templates the user has already connected. */
  connectedTemplateIds: ReadonlySet<string>;
  onClose: () => void;
  onCreate: (pack: Pack) => void;
  onTry: (pack: Pack) => void;
}

export function PackDetailSheet({
  pack,
  applyToName,
  connectedTemplateIds,
  onClose,
  onCreate,
  onTry,
}: Props) {
  if (!pack) return null;
  const Icon = pack.icon;
  const unmet = pack.slots.filter(
    (slot) => !slotState(slot, connectedTemplateIds).met,
  ).length;

  return (
    <Modal widthClass="w-[600px]">
      <DialogHeader
        title={pack.name}
        subtitle={pack.outcome}
        onClose={onClose}
        titleAccessory={
          <span className="flex size-9 items-center justify-center rounded-lg border border-border bg-card">
            <Icon className="size-5 text-muted-foreground" />
          </span>
        }
      />
      <DialogBody>
        {pack.setupNote && (
          <Callout tone="warning" size="sm" className="mb-5">
            <p className="text-sm font-medium text-foreground">
              {pack.setupNote.title}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {pack.setupNote.body}
            </p>
          </Callout>
        )}

        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          What&apos;s included
        </h3>
        <div className="mt-3 flex flex-col gap-2">
          {pack.included.map((item) => (
            <Row
              key={`${item.kind}-${item.name}`}
              kind={item.kind}
              name={item.name}
              detail={item.detail}
            />
          ))}
        </div>

        {pack.slots.length > 0 && (
          <>
            <h3 className="mt-7 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              You&apos;ll need
            </h3>
            <div className="mt-3 flex flex-col gap-2">
              {pack.slots.map((slot) => {
                const state = slotState(slot, connectedTemplateIds);
                return (
                  <Row
                    key={`${slot.kind}-${slot.label}`}
                    kind={slot.kind}
                    name={slot.label}
                    detail={state.detail}
                    trailing={
                      state.met ? (
                        <CheckmarkFilled className="size-4 shrink-0 text-success" />
                      ) : undefined
                    }
                  />
                );
              })}
            </div>
            {unmet > 0 && (
              <p className="mt-3 text-sm text-muted-foreground">
                You can {applyToName ? "apply" : "create"} without these. The
                agent does more once they are connected.
              </p>
            )}
          </>
        )}

        {pack.docsUrl && (
          <a
            href={pack.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-6 inline-flex items-center gap-1.5 text-sm text-accent hover:underline"
          >
            Read the docs
            <Launch className="size-4" />
          </a>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={() => onTry(pack)}>
          Try it
        </Button>
        <Button onClick={() => onCreate(pack)}>
          {applyToName ? "Apply pack" : "Create agent"}
        </Button>
      </DialogFooter>
    </Modal>
  );
}
