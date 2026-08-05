import { Checkmark, Copy } from "@carbon/icons-react";
import type { LibraryArtifact } from "api-server-api";
import { useState } from "react";

import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useCopy } from "@/hooks/use-copy";
import { emitToast } from "@/lib/toast";

import { useSetArtifactSharing } from "../api/mutations.js";

const EXPIRY_OPTIONS = [
  { value: "keep", label: "Keep current expiry" },
  { value: "never", label: "Never expires" },
  { value: "1", label: "1 hour" },
  { value: "24", label: "1 day" },
  { value: "168", label: "7 days" },
  { value: "720", label: "30 days" },
] as const;

interface Props {
  artifact: LibraryArtifact;
  onClose: () => void;
}

/** Sharing controls: public link on/off and expiry. Saved in one mutation,
 *  which closes the dialog and confirms through a toast — a save that only
 *  flipped the button back to "Save" read as a no-op. A failure keeps the
 *  dialog open and surfaces through the mutation's `errorToast`, so the user
 *  can retry without re-entering anything.
 *
 *  Both exits are gated while the save is in flight. The confirmation lives in
 *  a `mutate`-scoped `onSuccess`, which React Query skips once the observer has
 *  no listeners — leaving on a closed dialog would land the write with nothing
 *  to show for it, the very no-op this dialog was fixed to stop reading as.
 *  Gating is the narrow fix: a hook-level `onSuccess` would fire after unmount,
 *  but `defaultMutationOptions` shallow-merges, so it would silently replace
 *  the client-wide `onSuccess` that applies `meta.invalidates`. */
export function ShareDialog({ artifact, onClose }: Props) {
  const [isPublic, setIsPublic] = useState(artifact.visibility === "public");
  const [expiry, setExpiry] = useState<string>(
    artifact.expiresAt === null ? "never" : "keep",
  );
  const shareUrl = artifact.shareUrl;
  const { copy, copied } = useCopy();
  const sharing = useSetArtifactSharing();

  const save = () => {
    sharing.mutate(
      {
        id: artifact.id,
        visibility: isPublic ? "public" : "private",
        ...(expiry === "keep"
          ? {}
          : { expiresInHours: expiry === "never" ? null : Number(expiry) }),
      },
      {
        onSuccess: ({ shareUrl: savedUrl }) => {
          // Closing takes the link field away with it, so the toast carries the
          // copy affordance for the one flow that just produced a fresh URL.
          emitToast(
            savedUrl
              ? {
                  kind: "success",
                  message: "Sharing updated — the public link is live.",
                  action: {
                    label: "Copy link",
                    // Runs after this dialog has unmounted, so `useCopy`'s
                    // state-based failure channel would have no renderer left
                    // and a rejected write (insecure context, denied
                    // permission) would look like a success. Report the
                    // outcome as its own toast instead.
                    onClick: () => {
                      void navigator.clipboard
                        .writeText(savedUrl)
                        .then(() =>
                          emitToast({
                            kind: "success",
                            message: "Link copied.",
                          }),
                        )
                        .catch(() =>
                          emitToast({
                            kind: "error",
                            message:
                              "Couldn't copy the link — use “Copy share link” on the artifact row.",
                          }),
                        );
                    },
                  },
                }
              : {
                  kind: "success",
                  message: "Sharing updated — the artifact is now private.",
                },
          );
          onClose();
        },
      },
    );
  };

  return (
    <Modal>
      <DialogHeader
        title={`Share “${artifact.title}”`}
        onClose={onClose}
        closeDisabled={sharing.isPending}
      />
      <DialogBody>
        <div className="flex flex-col gap-5">
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-sm font-medium text-foreground">
                Public link
              </span>
              <span className="block text-xs text-muted-foreground">
                Anyone with the link can view — no platform account needed.
              </span>
            </span>
            <Switch checked={isPublic} onCheckedChange={setIsPublic} />
          </label>

          {isPublic && shareUrl && (
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={shareUrl}
                size="sm"
                variant="monospace"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Copy link"
                tooltip="Copy link"
                onClick={() => void copy(shareUrl)}
              >
                {copied ? (
                  <Checkmark size={14} className="text-success" />
                ) : (
                  <Copy size={14} />
                )}
              </Button>
            </div>
          )}

          {isPublic && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">
                Expiry
              </span>
              <Select
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
              >
                {EXPIRY_OPTIONS.filter(
                  (o) => o.value !== "keep" || artifact.expiresAt !== null,
                ).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
              <span className="text-xs text-muted-foreground">
                An expired artifact is permanently deleted after a 7-day grace
                period — even if it was made private again.
              </span>
            </div>
          )}
        </div>
      </DialogBody>
      <DialogActions
        onCancel={onClose}
        cancelLabel="Close"
        label="Save"
        pendingLabel="Saving…"
        pending={sharing.isPending}
        cancelDisabled={sharing.isPending}
        onSubmit={save}
      />
    </Modal>
  );
}
