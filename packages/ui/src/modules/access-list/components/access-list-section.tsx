import { Add, Information } from "@carbon/icons-react";
import { useState } from "react";

import { AddRow, LIST_ROW, ListSection } from "@/components/ui/list-section";
import { Notice } from "@/components/ui/notice";
import { RemoveButton } from "@/components/ui/remove-button";

import { formatDate } from "../../../lib/format-time.js";
import { useStore } from "../../../store.js";
import {
  useAddToAccessList,
  useRemoveFromAccessList,
} from "../api/mutations.js";
import { useAccessList } from "../api/queries.js";
import { AddAccessDialog } from "./add-access-dialog.js";

// UNIT_BOUNDARY_DESCRIPTION: the operator's card for the install's access list: who may sign in, by email. An add or a confirmed removal saves at once and takes effect at that person's next sign-in; a person already signed in keeps their session until it ends. When the install does not check the list, a notice says so above it, so an operator can fill it before it is turned on.
export function AccessListSection() {
  const { data, isLoading, isError } = useAccessList();
  const add = useAddToAccessList();
  const remove = useRemoveFromAccessList();
  const showConfirm = useStore((s) => s.showConfirm);
  const [adding, setAdding] = useState(false);
  const entries = data?.entries ?? [];
  const busy = add.isPending || remove.isPending;

  async function confirmRemove(email: string) {
    const ok = await showConfirm(
      <p>
        <span className="font-semibold text-foreground">{email}</span> can no
        longer sign in, from their next attempt.
      </p>,
      "Remove from the access list?",
      { kind: "destructive", confirmLabel: "Remove" },
    );
    if (ok) remove.mutate({ email });
  }

  return (
    <>
      {data && !data.enabled && (
        <Notice
          icon={Information}
          title="Sign-in does not check this list yet."
          className="mb-4"
        >
          Everyone who can sign in to the identity provider gets in. The list
          applies once the install turns it on.
        </Notice>
      )}
      <ListSection
        label="People who may sign in"
        description={
          entries.length > 0
            ? `${entries.length} ${entries.length === 1 ? "address" : "addresses"}. A change applies at the person's next sign-in.`
            : "A change applies at the person's next sign-in."
        }
        loading={isLoading}
        error={isError && "Couldn't load the access list."}
        isEmpty={entries.length === 0}
        empty="Nobody is on the list."
        onNew={() => setAdding(true)}
        newLabel="Add people"
        addRow={
          <AddRow onClick={() => setAdding(true)} disabled={busy}>
            <Add size={20} className="shrink-0" />
            <p className="text-md font-medium text-foreground">Add people</p>
          </AddRow>
        }
      >
        {entries.map((entry) => (
          <div key={entry.email} className={LIST_ROW}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-md font-medium text-foreground">
                {entry.email}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Added {formatDate(entry.addedAt)}
              </p>
            </div>
            <RemoveButton
              label={`Remove ${entry.email}`}
              tooltip="Remove"
              disabled={busy}
              onClick={() => void confirmRemove(entry.email)}
            />
          </div>
        ))}
      </ListSection>

      {adding && (
        <AddAccessDialog
          saving={add.isPending}
          onClose={() => setAdding(false)}
          onAdd={(emails) =>
            add.mutate({ emails }, { onSuccess: () => setAdding(false) })
          }
        />
      )}
    </>
  );
}
