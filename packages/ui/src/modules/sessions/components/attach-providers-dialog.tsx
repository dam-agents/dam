import { type ReactNode, useEffect, useRef, useState } from "react";

import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Card } from "@/components/ui/card";

import { ProviderSpendRow } from "../../providers/components/provider-spend-row.js";
import { useGrantProvider, useHarnessCatalog } from "../api/session-pair.js";
import { attachableProviders } from "../lib/catalog-groups.js";
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

// UNIT_BOUNDARY_DESCRIPTION: asks which of the owner's providers to attach to an agent before a harness can run on it, listing only providers that harness accepts, each as the row the agent's Providers page shows. Nothing is attached until the owner turns at least one on and confirms. Two providers of one kind cannot both be attached, so switching one on locks the others of its kind. While the grant runs the dialog cannot be dismissed, so a confirmed attach always reaches its caller. ask() resolves to the attached ids, or null when the owner cancels, the grant fails or the host goes away.
export function useAttachProvidersDialog(agentId: string | null): {
  ask: (
    harness: string,
    providers: readonly ProviderConnectionRef[],
    selected?: readonly string[],
  ) => Promise<string[] | null>;
  pending: boolean;
  dialog: ReactNode;
} {
  const [request, setRequest] = useState<Request | null>(null);
  const { attachAll } = useGrantProvider(agentId);
  const [attaching, setAttaching] = useState(false);
  const open = useRef<Request | null>(null);
  open.current = request;
  useEffect(() => () => open.current?.resolve(null), []);

  const close = (attached: string[] | null) => {
    request?.resolve(attached);
    setRequest(null);
  };

  return {
    ask: (harness, providers, selected = []) =>
      new Promise((resolve) =>
        setRequest({ harness, providers, selected, resolve }),
      ),
    pending: request !== null,
    dialog: request && (
      <AttachProvidersDialog
        key={request.harness}
        request={request}
        pending={attaching}
        onCancel={() => close(null)}
        onAttach={async (ids) => {
          setAttaching(true);
          const attached = await attachAll(ids);
          setAttaching(false);
          close(attached ? ids : null);
        }}
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
  const [selected, setSelected] = useState<readonly string[]>(() =>
    request.selected.filter((id) => request.providers.some((p) => p.id === id)),
  );
  const selectedRows = request.providers.filter((p) => selected.includes(p.id));
  const blocked = (p: ProviderConnectionRef) =>
    !selected.includes(p.id) &&
    attachableProviders(selectedRows, [p]).length === 0;
  const catalog = useHarnessCatalog().data?.harnesses;
  const harnessName =
    catalog?.find((h) => h.name === request.harness)?.displayName ??
    request.harness;
  const dismiss = pending ? undefined : onCancel;
  return (
    <Modal onClose={dismiss} size="sm">
      <DialogHeader
        title={`Attach a provider for ${harnessName}`}
        subtitle={`${harnessName} runs on a provider this agent does not use yet. The agent gets the credentials of each one you attach, for its sessions, schedules and channels.`}
        onClose={onCancel}
        closeDisabled={pending}
      />
      <DialogBody>
        <Card className="divide-y divide-border overflow-hidden">
          {request.providers.map((p) => (
            <ProviderSpendRow
              key={p.id}
              agentId={null}
              provider={p}
              harnesses={catalog && providerHarnesses(catalog, p)}
              showSpend={false}
              checked={selected.includes(p.id)}
              disabled={pending || blocked(p)}
              onCheckedChange={(on) =>
                setSelected((s) =>
                  on ? [...s, p.id] : s.filter((id) => id !== p.id),
                )
              }
            />
          ))}
        </Card>
      </DialogBody>
      <DialogActions
        onCancel={onCancel}
        cancelDisabled={pending}
        label="Attach"
        pendingLabel="Attaching…"
        pending={pending}
        disabled={selected.length === 0}
        onSubmit={() => onAttach([...selected])}
      />
    </Modal>
  );
}
