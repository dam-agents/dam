import { Add } from "@carbon/icons-react";
import type { SpendCeilingEntry } from "api-server-api";
import { useState } from "react";

import { AddRow, ListSection } from "@/components/ui/list-section";

import { useStore } from "../../../store.js";
import { useSetSpendCeiling } from "../api/mutations.js";
import { useSpendCeilings } from "../api/queries.js";
import {
  ceilingDefaultLine,
  ceilingPerDay,
  CEILINGS_EMPTY,
  CEILINGS_HELP,
  CEILINGS_LOAD_ERROR,
  CEILINGS_TITLE,
  SET_CEILING,
  SET_CEILING_HINT,
} from "../lib/copy.js";
import { HelpTip } from "./help-tip.js";
import { SpendCeilingDialog } from "./spend-ceiling-dialog.js";
import { SpendCeilingRow } from "./spend-ceiling-row.js";

type DialogTarget = { entry: SpendCeilingEntry | null } | null;

export function SpendCeilingsSection() {
  const { data, isLoading, isError } = useSpendCeilings();
  const removeCeiling = useSetSpendCeiling();
  const showConfirm = useStore((s) => s.showConfirm);
  const [dialog, setDialog] = useState<DialogTarget>(null);
  const ceilings = data?.ceilings ?? [];
  const defaultMicros = data?.defaultMicros ?? null;
  const removing = removeCeiling.isPending
    ? removeCeiling.variables.user
    : null;
  const removingSub =
    removing && "ownerSub" in removing ? removing.ownerSub : null;

  async function remove(entry: SpendCeilingEntry) {
    const user = entry.email ?? entry.ownerSub;
    const ok = await showConfirm(
      <p>
        <span className="font-semibold text-foreground">{user}</span>{" "}
        {defaultMicros === null
          ? "then has no spend ceiling."
          : `then has the default spend ceiling of ${ceilingPerDay(defaultMicros)}.`}
      </p>,
      "Remove spend ceiling?",
      { kind: "destructive", confirmLabel: "Remove ceiling" },
    );
    if (ok) {
      removeCeiling.mutate({
        user: { ownerSub: entry.ownerSub },
        amountMicros: null,
      });
    }
  }

  return (
    <>
      <ListSection
        label={
          <span className="inline-flex items-center gap-1.5">
            {CEILINGS_TITLE}
            <HelpTip content={CEILINGS_HELP} />
          </span>
        }
        description={data && ceilingDefaultLine(data.defaultMicros)}
        loading={isLoading}
        error={isError && CEILINGS_LOAD_ERROR}
        isEmpty={ceilings.length === 0}
        empty={CEILINGS_EMPTY}
        onNew={() => setDialog({ entry: null })}
        newLabel={SET_CEILING}
        addRow={
          <AddRow onClick={() => setDialog({ entry: null })}>
            <Add size={20} className="shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-md font-medium text-foreground">
                {SET_CEILING}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {SET_CEILING_HINT}
              </p>
            </div>
          </AddRow>
        }
      >
        {ceilings.map((entry) => (
          <SpendCeilingRow
            key={entry.ownerSub}
            entry={entry}
            onChange={(target) => setDialog({ entry: target })}
            onRemove={(target) => void remove(target)}
            removing={removingSub === entry.ownerSub}
          />
        ))}
      </ListSection>

      {dialog && (
        <SpendCeilingDialog
          entry={dialog.entry}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
