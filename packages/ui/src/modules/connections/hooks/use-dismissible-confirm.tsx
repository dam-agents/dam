import { type ReactNode, useCallback, useState } from "react";

import { CheckboxItem } from "@/components/ui/checkbox";

import {
  readPersistedFlag,
  writePersistedFlag,
} from "../../../lib/persisted-prefs.js";
import { useStore } from "../../../store.js";

export interface DismissibleConfirmRequest {
  title: string;
  body: ReactNode;
  confirmLabel: string;
}

export interface DismissibleConfirm {
  dismissed: boolean;
  confirm: (request: DismissibleConfirmRequest) => Promise<boolean>;
}

export interface DismissibleConfirms {
  dismissed: (storageKey: string) => boolean;
  confirm: (
    request: DismissibleConfirmRequest,
    storageKeys: readonly string[],
  ) => Promise<boolean>;
}

export function useDismissibleConfirms(): DismissibleConfirms {
  const showConfirm = useStore((s) => s.showConfirm);
  const [written, setWritten] = useState<ReadonlySet<string>>(new Set());
  const dismissed = useCallback(
    (storageKey: string) =>
      written.has(storageKey) || readPersistedFlag(storageKey, false),
    [written],
  );
  const confirm = useCallback(
    async (
      { title, body, confirmLabel }: DismissibleConfirmRequest,
      storageKeys: readonly string[],
    ) => {
      /* UNIT_BOUNDARY_DESCRIPTION: no storage key means the question cannot be dismissed — it is asked again every time, because nothing about it has been decided. `every` holds for an empty list, so the emptiness has to be tested first: a caller that passes none is asking for a dialog that must always show. */
      if (
        storageKeys.length > 0 &&
        storageKeys.every((key) => readPersistedFlag(key, false))
      )
        return true;
      const choice = { dontShowAgain: false };
      const ok = await showConfirm(
        <DismissibleBody
          body={body}
          dismissible={storageKeys.length > 0}
          onDontShowAgainChange={(value) => {
            choice.dontShowAgain = value;
          }}
        />,
        title,
        { kind: "info", confirmLabel },
      );
      if (ok && choice.dontShowAgain) {
        for (const key of storageKeys) writePersistedFlag(key, true);
        setWritten((prev) => new Set([...prev, ...storageKeys]));
      }
      return ok;
    },
    [showConfirm],
  );
  return { dismissed, confirm };
}

export function useDismissibleConfirm(storageKey: string): DismissibleConfirm {
  const confirms = useDismissibleConfirms();
  const { confirm: confirmAll } = confirms;
  const confirm = useCallback(
    (request: DismissibleConfirmRequest) => confirmAll(request, [storageKey]),
    [confirmAll, storageKey],
  );
  return { dismissed: confirms.dismissed(storageKey), confirm };
}

/* UNIT_BOUNDARY_DESCRIPTION: the body a confirmable question is shown with. A question that cannot be dismissed — one no storage key guards, such as the warning before granting the Connection that acts as the owner — offers no "don't show again", because nothing would be recorded and the box would promise what the dialog cannot do. */
function DismissibleBody({
  body,
  dismissible,
  onDontShowAgainChange,
}: {
  body: ReactNode;
  dismissible: boolean;
  onDontShowAgainChange: (value: boolean) => void;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <p>{body}</p>
      {dismissible && (
        <CheckboxItem
          label="Don't show this again"
          checked={checked}
          onCheckedChange={(value) => {
            const next = value === true;
            setChecked(next);
            onDontShowAgainChange(next);
          }}
          testId="dismissible-confirm-dont-show-again"
        />
      )}
    </div>
  );
}
