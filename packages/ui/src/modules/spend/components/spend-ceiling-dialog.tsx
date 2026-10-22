import { TRPCClientError } from "@trpc/client";
import {
  type SpendCeilingEntry,
  spendCeilingUsdTextSchema,
  spendCeilingUserSchema,
} from "api-server-api";
import { useState } from "react";

import { FormField } from "@/components/form-field";
import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Input } from "@/components/ui/input";

import { useSetSpendCeiling } from "../api/mutations.js";
import { CEILING_APPLIES_NEXT_CALL, SET_CEILING } from "../lib/copy.js";
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
  const failure = setCeiling.error;
  const unknownUser =
    failure instanceof TRPCClientError && failure.data?.code === "NOT_FOUND";
  const emailError = unknownUser
    ? failure.message
    : email.trim() !== "" && !user.success
      ? "Enter an email address."
      : undefined;
  const amountError =
    draft.trim() === "" || amount.success
      ? undefined
      : "Enter dollars like 50 or 12.50.";
  const pending = setCeiling.isPending;
  const canSave = user.success && amount.success;

  return (
    <Modal size="sm" onClose={pending ? undefined : onClose}>
      <form
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          if (!user.success || !amount.success || pending) return;
          setCeiling.mutate(
            { user: user.data, amountMicros: amount.data },
            { onSuccess: onClose },
          );
        }}
      >
        <DialogHeader
          title={entry ? "Change spend ceiling" : SET_CEILING}
          subtitle={
            entry
              ? `For ${entry.email ?? entry.ownerSub}. ${CEILING_APPLIES_NEXT_CALL}`
              : CEILING_APPLIES_NEXT_CALL
          }
          onClose={onClose}
          closeDisabled={pending}
        />
        <DialogBody className="flex flex-col gap-4">
          {!entry && (
            <FormField label="User's email" error={emailError}>
              <Input
                autoFocus
                type="email"
                autoComplete="off"
                placeholder="name@example.com"
                variant={emailError ? "invalid" : "standard"}
                aria-invalid={emailError !== undefined}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setCeiling.reset();
                }}
              />
            </FormField>
          )}
          <FormField
            label="Daily spend ceiling"
            hint="US dollars of paid API spend per UTC day, over all the user's agents."
            error={amountError}
          >
            <Input
              autoFocus={entry !== null}
              inputMode="decimal"
              placeholder="50.00"
              variant={amountError ? "invalid" : "standard"}
              className="w-36 font-mono"
              aria-invalid={amountError !== undefined}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </FormField>
          {failure && !unknownUser && (
            <p role="alert" className="text-sm text-danger">
              Couldn't save the spend ceiling. Try again.
            </p>
          )}
        </DialogBody>
        <DialogActions
          onCancel={onClose}
          cancelDisabled={pending}
          label="Save"
          pendingLabel="Saving…"
          pending={pending}
          disabled={!canSave}
        />
      </form>
    </Modal>
  );
}
