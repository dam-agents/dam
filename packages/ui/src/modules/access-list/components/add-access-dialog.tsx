import { ACCESS_LIST_ADD_MAX } from "api-server-api";
import { useState } from "react";

import { FormField } from "@/components/form-field";
import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Textarea } from "@/components/ui/textarea";

import { parseEmails } from "../lib/parse-emails.js";

function inputError(invalid: string[], count: number): string | undefined {
  if (invalid.length > 0)
    return `Not an email address: ${invalid.slice(0, 3).join(", ")}${invalid.length > 3 ? ` and ${invalid.length - 3} more` : ""}`;
  if (count > ACCESS_LIST_ADD_MAX)
    return `Add at most ${ACCESS_LIST_ADD_MAX} addresses at once`;
  return undefined;
}

// UNIT_BOUNDARY_DESCRIPTION: adds one or more people to the access list by email. A pasted list works too: the addresses may be split by commas, spaces or lines. Add stays off while any piece is not an email address, and the dialog says which.
export function AddAccessDialog({
  saving,
  onAdd,
  onClose,
}: {
  saving: boolean;
  onAdd: (emails: string[]) => void;
  onClose: () => void;
}) {
  const [raw, setRaw] = useState("");
  const { emails, invalid } = parseEmails(raw);
  const error = inputError(invalid, emails.length);
  const canAdd = emails.length > 0 && !error && !saving;

  return (
    <Modal size="sm" onClose={saving ? undefined : onClose}>
      <form
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          if (canAdd) onAdd(emails);
        }}
      >
        <DialogHeader
          title="Add people"
          subtitle="They can sign in from their next attempt."
          onClose={onClose}
          closeDisabled={saving}
        />
        <DialogBody className="flex flex-col gap-4">
          <FormField
            label="Email addresses"
            hint="One or more, separated by commas, spaces or new lines."
            error={error}
          >
            <Textarea
              autoFocus
              rows={5}
              placeholder="name@company.com"
              variant={error ? "invalid" : "standard"}
              aria-invalid={error !== undefined}
              value={raw}
              onChange={(event) => setRaw(event.target.value)}
              data-testid="access-list-emails"
            />
          </FormField>
        </DialogBody>
        <DialogActions
          onCancel={onClose}
          cancelDisabled={saving}
          label={emails.length > 1 ? `Add ${emails.length} people` : "Add"}
          pendingLabel="Adding…"
          pending={saving}
          disabled={!canAdd}
        />
      </form>
    </Modal>
  );
}
