import { Checkmark, Copy } from "@carbon/icons-react";
import type { LibraryArtifact } from "api-server-api";
import { useState } from "react";

import {
  DialogActions,
  DialogBody,
  DialogFooter,
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
  if (artifact.interactive) {
    return <InteractiveRefusal artifact={artifact} onClose={onClose} />;
  }
  return <SharingControls artifact={artifact} onClose={onClose} />;
}

function InteractiveRefusal({ artifact, onClose }: Props) {
  return (
    <Modal>
      <DialogHeader title={`Share “${artifact.title}”`} onClose={onClose} />
      <DialogBody>
        <div className="flex flex-col gap-3 text-sm">
          <p className="font-medium text-foreground">
            This page cannot be shared.
          </p>
          <p className="text-muted-foreground">
            It is an interactive page: a button on it can ask its agent to do
            something, and that agent works with your credentials and your
            connections. A link anyone could open would hand them the same
            reach, so an interactive page stays private to you.
          </p>
          <p className="text-muted-foreground">
            This was settled when the page was published and cannot be changed.
            Ask the agent for a plain copy if you need something to share.
          </p>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </Modal>
  );
}

function SharingControls({ artifact, onClose }: Props) {
  const [committed, setCommitted] = useState({
    isPublic: artifact.visibility === "public",
    shareUrl: artifact.shareUrl,
  });
  const [isPublic, setIsPublic] = useState(committed.isPublic);
  const { copy, copied } = useCopy();
  const sharing = useSetArtifactSharing();
  const shareUrl = committed.shareUrl;
  const unsaved = isPublic !== committed.isPublic;

  const save = () => {
    sharing.mutate(
      { id: artifact.id, visibility: isPublic ? "public" : "private" },
      {
        onSuccess: ({ visibility, shareUrl: savedUrl }) => {
          const nowPublic = visibility === "public";
          setCommitted({ isPublic: nowPublic, shareUrl: savedUrl });
          emitToast({
            kind: "success",
            message: nowPublic
              ? "Sharing updated — the public link is live."
              : "Sharing updated — the artifact is now private.",
          });
          if (!nowPublic) onClose();
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
            <Switch
              checked={isPublic}
              onCheckedChange={setIsPublic}
              disabled={sharing.isPending}
            />
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
        disabled={!unsaved}
        onSubmit={save}
      />
    </Modal>
  );
}
