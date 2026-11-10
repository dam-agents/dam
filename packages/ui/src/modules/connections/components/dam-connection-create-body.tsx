import { useState } from "react";

import { Button } from "@/components/ui/button";

import { useCreateDamConnection } from "../api/mutations.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the one action a person has for the Connection that
 * drives this install: have it made, or keep the one they already hold. There is
 * no form because there is no secret to type — the api-server mints the key and
 * files it in the Connection's own Secret — and the create answers with the one
 * Connection they hold either way, which is then offered to the Agent they asked
 * from.
 * The completion fires once, from the click that asked for it, as every other
 * create pane here does — never from an effect watching the answer: the caller
 * re-renders this pane with a fresh callback after the create invalidates the
 * connection list, and an effect keyed on that would grant, toast and close a
 * second time.
 */
export function DamConnectionCreateBody({
  connectionName,
  onCreated,
  onCancel,
}: {
  connectionName: string;
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const create = useCreateDamConnection();
  const [unavailable, setUnavailable] = useState(false);
  const submit = async (): Promise<void> => {
    /* UNIT_BOUNDARY_DESCRIPTION: the alarm belongs to the answer that raised it, so a retry clears it before it asks again rather than leaving it beside a spinner. */
    setUnavailable(false);
    try {
      const result = await create.mutateAsync();
      if (result.id === null) setUnavailable(true);
      else onCreated(result.id);
    } catch {}
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {connectionName} is this install's own connection. The platform makes
        its key and keeps it, so there is nothing to type here: an agent granted
        this connection acts as you on this install, and whoever can drive that
        agent acts as you too.
      </p>
      {unavailable && (
        <p className="text-sm text-danger" role="alert">
          This install cannot offer its own connection to you.
        </p>
      )}
      <div className="flex justify-end gap-3">
        <Button
          variant="outline"
          onClick={onCancel}
          disabled={create.isPending}
        >
          Cancel
        </Button>
        <Button
          onClick={() => void submit()}
          disabled={create.isPending}
          data-testid="dam-connection-create-submit"
        >
          {create.isPending ? "Creating…" : "Create connection"}
        </Button>
      </div>
    </div>
  );
}
