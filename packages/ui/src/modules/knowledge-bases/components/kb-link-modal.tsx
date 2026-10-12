import { FormField } from "@/components/form-field";
import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Input } from "@/components/ui/input";

import { useConnectKnowledgeBase } from "../hooks/use-connect-knowledge-base.js";

export function KbLinkModal({
  onConnected,
  onClose,
}: {
  onConnected: (connectionId: string) => void;
  onClose: () => void;
}) {
  const form = useConnectKnowledgeBase();
  const connect = () =>
    form.connect((id) => {
      onConnected(id);
      onClose();
    });
  return (
    <Modal onClose={form.busy ? undefined : onClose}>
      <form
        className="contents"
        onSubmit={(e) => {
          e.preventDefault();
          if (form.formatOk && !form.busy) connect();
        }}
      >
        <DialogHeader
          onClose={onClose}
          closeDisabled={form.busy}
          title="Connect a knowledge base"
          subtitle="Paste a share link to give this agent read-only access. Ask the knowledge base owner for their link."
        />
        <DialogBody className="flex flex-col gap-2">
          <FormField label="Share link" error={form.error ?? undefined}>
            <Input
              autoFocus
              variant="monospace"
              placeholder="kbshare_…"
              value={form.link}
              onChange={(e) => form.setLink(e.target.value)}
            />
          </FormField>
          {form.trimmed.length > 0 && !form.formatOk && (
            <p className="text-xs text-warning">
              {form.trimmed.startsWith("kbshare_")
                ? "That share link looks incomplete or mistyped — check you copied the whole kbshare_… string."
                : "That doesn't look like a share link — expected a kbshare_… string."}
            </p>
          )}
        </DialogBody>
        <DialogActions
          onCancel={onClose}
          cancelDisabled={form.busy}
          label="Connect"
          pendingLabel="Connecting…"
          pending={form.busy}
          disabled={!form.formatOk}
        />
      </form>
    </Modal>
  );
}
