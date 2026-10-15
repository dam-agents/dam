import { type ReactNode, useState } from "react";

import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";

import { ProviderToggleRow } from "../../providers/components/provider-toggle-row.js";
import { useGrantProvider, useHarnessCatalog } from "../api/session-pair.js";
import {
  type ProviderConnectionRef,
  providerHarnesses,
} from "../lib/session-pair-options.js";

interface Request {
  harness: string;
  providers: readonly ProviderConnectionRef[];
  selected: readonly string[];
  resolve: (attached: string[] | null) => void;
}

// UNIT_BOUNDARY_DESCRIPTION: asks which of the owner's providers to attach to an agent before a harness can run on it, listing only providers that harness accepts, each as the row the agent's Providers page shows. Nothing is attached until the owner turns at least one on and confirms; ask() resolves to the attached ids, or null when the owner cancels or the grant fails.
export function useAttachProvidersDialog(agentId: string): {
  ask: (
    harness: string,
    providers: readonly ProviderConnectionRef[],
    selected?: readonly string[],
  ) => Promise<string[] | null>;
  pending: boolean;
  dialog: ReactNode;
} {
  const [request, setRequest] = useState<Request | null>(null);
  const { attachAll, pending } = useGrantProvider(agentId);

  const close = (attached: string[] | null) => {
    request?.resolve(attached);
    setRequest(null);
  };

  return {
    ask: (harness, providers, selected = []) =>
      new Promise((resolve) =>
        setRequest({ harness, providers, selected, resolve }),
      ),
    pending: pending || request !== null,
    dialog: request && (
      <AttachProvidersDialog
        key={request.harness}
        request={request}
        pending={pending}
        onCancel={() => close(null)}
        onAttach={async (ids) => close((await attachAll(ids)) ? ids : null)}
      />
    ),
  };
}

function AttachProvidersDialog({
  request,
  pending,
  onCancel,
  onAttach,
}: {
  request: Request;
  pending: boolean;
  onCancel: () => void;
  onAttach: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<readonly string[]>(request.selected);
  const catalog = useHarnessCatalog().data?.harnesses;
  const harnessName =
    catalog?.find((h) => h.name === request.harness)?.displayName ??
    request.harness;
  return (
    <Modal onClose={onCancel} size="sm">
      <DialogHeader
        title={`Attach a provider for ${harnessName}`}
        subtitle={`${harnessName} runs on a provider this agent does not use yet. The agent gets the credentials of each one you attach, for its sessions, schedules and channels.`}
        onClose={onCancel}
      />
      <DialogBody className="flex flex-col gap-3">
        {request.providers.map((p) => (
          <ProviderToggleRow
            key={p.id}
            provider={p}
            harnesses={catalog && providerHarnesses(catalog, p)}
            checked={selected.includes(p.id)}
            disabled={pending}
            onCheckedChange={(on) =>
              setSelected((s) =>
                on ? [...s, p.id] : s.filter((id) => id !== p.id),
              )
            }
          />
        ))}
      </DialogBody>
      <DialogActions
        onCancel={onCancel}
        label="Attach"
        pendingLabel="Attaching…"
        pending={pending}
        disabled={selected.length === 0}
        onSubmit={() => onAttach([...selected])}
      />
    </Modal>
  );
}
