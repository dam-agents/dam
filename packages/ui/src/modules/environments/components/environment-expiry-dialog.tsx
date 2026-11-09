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
const NEVER = "never";

// UNIT_BOUNDARY_DESCRIPTION: what the dialog says each choice does, so its text never contradicts the choice: a date deletes the Environment then, "never" keeps it.
function consequence(choice: string, current: string | null): string {
  if (choice === NEVER || (choice === KEEP && current === null))
    return "The Environment is kept until you or the agent delete it, with its machine, its disk and its addresses.";
  return "The Environment, its machine and its disk are deleted on that date, and its addresses stop answering.";
}

const EXPIRY_DAYS = [1, 7, ENVIRONMENT_EXPIRY_MAX_DAYS];

/**
 * UNIT_BOUNDARY_DESCRIPTION: The delete-after control of an artifact, for an
 * Environment: "Keep until deleted" keeps it until someone deletes it, as a
 * server people rely on needs, and the install cuts a later date to its
 * maximum. Its text says what the choice in the field does. The agent may
 * change it too, and the last change wins.
 */
export function EnvironmentExpiryDialog({
  environment,
  onClose,
}: {
  environment: EnvironmentView;
  onClose: () => void;
}) {
  const current = environment.expiresAt
    ? deletionDate(environment.expiresAt)
    : null;
  const [choice, setChoice] = useState<string>(current ? KEEP : NEVER);
  const extend = useExtendEnvironment();

  const save = () => {
    if (choice === KEEP || (choice === NEVER && current === null))
      return onClose();
    extend.mutate(
      {
        id: environment.id,
        expiresAt:
          choice === NEVER
            ? NEVER
            : new Date(Date.now() + Number(choice) * DAY_MS).toISOString(),
      },
      {
        onSuccess: ({ expiresAt }) => {
          emitToast({
            kind: "success",
            message: expiresAt
              ? `${environment.name} is deleted on ${deletionDate(expiresAt)}.`
              : `${environment.name} is kept until you or the agent delete it.`,
          });
          onClose();
        },
      },
    );
  };

  return (
    <Modal onClose={extend.isPending ? undefined : onClose}>
      <DialogHeader
        title={`Delete “${environment.name}” after`}
        onClose={onClose}
        closeDisabled={extend.isPending}
      />
      <DialogBody>
        <div className="flex flex-col gap-5">
          <p
            className="text-sm text-foreground"
            data-testid="expiry-consequence"
          >
            {consequence(choice, current)}
          </p>
          <p className="text-sm text-muted-foreground">
            The agent can change it too, and the last change wins.
          </p>
          <FormField label="Delete after">
            <Select
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              disabled={extend.isPending}
            >
              {current && (
                <option value={KEEP}>{`Keep current date (${current})`}</option>
              )}
              <option value={NEVER}>Keep until deleted</option>
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
