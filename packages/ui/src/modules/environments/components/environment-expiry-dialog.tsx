import {
  ENVIRONMENT_EXPIRY_MAX_DAYS,
  type EnvironmentView,
} from "api-server-api";
import { useState } from "react";

import { FormField } from "@/components/form-field";
import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Select } from "@/components/ui/select";
import { emitToast } from "@/lib/toast";

import { deletionDate } from "../../artifacts/lib/format.js";
import { useExtendEnvironment } from "../api/mutations.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const KEEP = "keep";

const EXPIRY_DAYS = [1, 7, ENVIRONMENT_EXPIRY_MAX_DAYS];

/**
 * UNIT_BOUNDARY_DESCRIPTION: The delete-after control of an artifact, for an
 * Environment: every Environment has an expiry, so there is no "never", and
 * the install cuts a later date to its maximum.
 */
export function EnvironmentExpiryDialog({
  environment,
  onClose,
}: {
  environment: EnvironmentView;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState<string>(KEEP);
  const extend = useExtendEnvironment();
  const current = deletionDate(environment.expiresAt);

  const save = () => {
    if (choice === KEEP) return onClose();
    extend.mutate(
      {
        id: environment.id,
        expiresAt: new Date(Date.now() + Number(choice) * DAY_MS).toISOString(),
      },
      {
        onSuccess: ({ expiresAt }) => {
          emitToast({
            kind: "success",
            message: `${environment.name} is deleted on ${deletionDate(expiresAt)}.`,
          });
          onClose();
        },
      },
    );
  };

  return (
    <Modal onClose={extend.isPending ? undefined : onClose}>
      <DialogHeader
        title={`Set expiration for “${environment.name}”`}
        onClose={onClose}
        closeDisabled={extend.isPending}
      />
      <DialogBody>
        <div className="flex flex-col gap-5">
          <p className="text-sm text-foreground">
            The Environment, its machine and its disk are deleted on the date
            you choose, and its addresses stop answering. The agent can extend
            it too.
          </p>
          <FormField label="Delete after">
            <Select
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              disabled={extend.isPending}
            >
              <option value={KEEP}>{`Keep current date (${current})`}</option>
              {EXPIRY_DAYS.map((days) => (
                <option key={days} value={String(days)}>
                  {`Delete in ${days} day${days === 1 ? "" : "s"}`}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
      </DialogBody>
      <DialogActions
        onCancel={onClose}
        cancelLabel="Cancel"
        label="Save"
        pendingLabel="Saving…"
        pending={extend.isPending}
        cancelDisabled={extend.isPending}
        onSubmit={save}
      />
    </Modal>
  );
}
