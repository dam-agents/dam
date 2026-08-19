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
import { Switch } from "@/components/ui/switch";
import { useCopy } from "@/hooks/use-copy";
import { emitToast } from "@/lib/toast";

import { useSetArtifactSharing } from "../api/mutations.js";
import { toastCopyOutcome } from "../lib/share-link.js";

interface Props {
  artifact: LibraryArtifact;
  onClose: () => void;
}

export function ShareDialog({ artifact, onClose }: Props) {
  const [isPublic, setIsPublic] = useState(artifact.visibility === "public");
  const shareUrl = artifact.shareUrl;
  const { copy, copied } = useCopy();
  const sharing = useSetArtifactSharing();

  const save = () => {
    sharing.mutate(
      { id: artifact.id, visibility: isPublic ? "public" : "private" },
      {
        onSuccess: ({ shareUrl: savedUrl }) => {
          emitToast(
            savedUrl
              ? {
                  kind: "success",
                  message: "Sharing updated — the public link is live.",
                  action: {
                    label: "Copy link",
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
                onClick={() => void copy(shareUrl).then(toastCopyOutcome)}
              >
                {copied ? (
                  <Checkmark size={14} className="text-success" />
                ) : (
                  <Copy size={14} />
                )}
              </Button>
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
