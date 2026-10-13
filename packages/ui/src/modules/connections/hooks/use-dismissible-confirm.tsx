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

export function useDismissibleConfirm(storageKey: string): DismissibleConfirm {
  const showConfirm = useStore((s) => s.showConfirm);
  const [dismissed, setDismissed] = useState(() =>
    readPersistedFlag(storageKey, false),
  );
  const confirm = useCallback(
    async ({ title, body, confirmLabel }: DismissibleConfirmRequest) => {
      if (readPersistedFlag(storageKey, false)) return true;
      const choice = { dontShowAgain: false };
      const ok = await showConfirm(
        <DismissibleBody
          body={body}
          onDontShowAgainChange={(value) => {
            choice.dontShowAgain = value;
          }}
        />,
        title,
        { kind: "info", confirmLabel },
      );
      if (ok && choice.dontShowAgain) {
        writePersistedFlag(storageKey, true);
        setDismissed(true);
      }
      return ok;
    },
    [showConfirm, storageKey],
  );
  return { dismissed, confirm };
}

function DismissibleBody({
  body,
  onDontShowAgainChange,
}: {
  body: ReactNode;
  onDontShowAgainChange: (value: boolean) => void;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <p>{body}</p>
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
    </div>
  );
}
