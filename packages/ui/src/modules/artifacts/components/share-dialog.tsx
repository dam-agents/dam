import { Checkmark, Copy } from "@carbon/icons-react";
import type { LibraryArtifact } from "api-server-api";
import { useState } from "react";

import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useCopy } from "@/lib/use-copy";

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

/** Sharing controls: public link on/off and expiry. Saved in one mutation;
 *  the fresh share URL comes back on the mutation result. */
export function ShareDialog({ artifact, onClose }: Props) {
  const [isPublic, setIsPublic] = useState(artifact.visibility === "public");
  const [expiry, setExpiry] = useState<string>(
    artifact.expiresAt === null ? "never" : "keep",
  );
  const [shareUrl, setShareUrl] = useState(artifact.shareUrl);
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
        onSuccess: (updated) => {
          setShareUrl(updated.shareUrl);
          if (!updated.shareUrl) onClose();
        },
      },
    );
  };

  return (
    <Modal>
      <DialogHeader title={`Share “${artifact.title}”`} />
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
                title="Copy link"
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
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button onClick={save} disabled={sharing.isPending}>
          {sharing.isPending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </Modal>
  );
}
