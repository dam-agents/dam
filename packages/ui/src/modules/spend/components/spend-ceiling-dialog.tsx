import {
  type SpendCeilingEntry,
  spendCeilingUsdTextSchema,
  spendCeilingUserSchema,
} from "api-server-api";
import { useState } from "react";

import { OperatorOverrideDialog } from "../../operator/components/operator-override-dialog.js";
import { useSetSpendCeiling } from "../api/mutations.js";
import {
  CEILING_APPLIES_NEXT_CALL,
  CEILING_REMOVED_MEANWHILE,
  CEILING_SAVE_FAILED,
  SET_CEILING,
} from "../lib/copy.js";
import { amountText } from "../lib/format.js";

interface Props {
  entry: SpendCeilingEntry | null;
  onClose: () => void;
}

export function SpendCeilingDialog({ entry, onClose }: Props) {
  const setCeiling = useSetSpendCeiling({ inlineErrors: true });
  const [email, setEmail] = useState("");
  const [draft, setDraft] = useState(
    entry ? amountText(entry.amountMicros) : "",
  );
  const user = entry
    ? spendCeilingUserSchema.safeParse({ ownerSub: entry.ownerSub })
    : spendCeilingUserSchema.safeParse({ email });
  const amount = spendCeilingUsdTextSchema.safeParse(draft);
  const pending = setCeiling.isPending;
  const canSave = user.success && amount.success;

  function save() {
    if (!user.success || !amount.success) return;
    setCeiling.mutate(
      { user: user.data, amountMicros: amount.data },
      { onSuccess: onClose },
    );
  }

  return (
    <OperatorOverrideDialog
      title={entry ? "Change spend ceiling" : SET_CEILING}
      subtitle={
        entry
          ? `For ${entry.email ?? entry.ownerSub}. ${CEILING_APPLIES_NEXT_CALL}`
          : CEILING_APPLIES_NEXT_CALL
      }
      user={
        entry
          ? null
          : {
              value: email,
              valid: user.success,
              onChange: (text) => {
                setEmail(text);
                setCeiling.reset();
              },
            }
      }
      failure={setCeiling.error}
      errorCopy={{
        removedMeanwhile: CEILING_REMOVED_MEANWHILE,
        saveFailed: CEILING_SAVE_FAILED,
        showServerMessage: false,
      }}
      fields={[
        {
          label: "Daily spend ceiling",
          hint: "US dollars of paid API spend per UTC day, over all the user's agents.",
          placeholder: "50.00",
          error:
            draft.trim() === "" || amount.success
              ? undefined
              : "Enter dollars like 50 or 12.50.",
          value: draft,
          inputMode: "decimal",
          autoFocus: entry !== null,
          onChange: setDraft,
        },
      ]}
      pending={pending}
      canSave={canSave}
      onSave={save}
      onClose={onClose}
    />
  );
}
