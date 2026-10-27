import { Checkmark, Copy } from "@carbon/icons-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { useCopy } from "@/hooks/use-copy";
import { emitToast } from "@/lib/toast";

import { timeAgo } from "../../../lib/format-time.js";
import { useStore } from "../../../store.js";
import {
  useRefreshKbShare,
  useRevealKbShare,
  useRevokeKbShare,
  useRotateKbShare,
  useSetKbShareName,
  useShareKb,
} from "../api/kb-share-mutations.js";
import { useKbShareStatus } from "../api/kb-share-queries.js";
import { KbShareRootsDialog } from "./kb-share-roots-dialog.js";

const AWARENESS_COPY =
  "Anyone with the share link can read everything published here — raw files only; skills, commands, and agent behavior are not shared.";

export function KbSharingSection({ agentId }: { agentId: string }) {
  const status = useKbShareStatus(agentId);
  const share = useShareKb();
  const refresh = useRefreshKbShare();
  const rotate = useRotateKbShare();
  const revoke = useRevokeKbShare();
  const reveal = useRevealKbShare();
  const setName = useSetKbShareName();
  const showConfirm = useStore((s) => s.showConfirm);
  const { copy, copied } = useCopy();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [revealedLink, setRevealedLink] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  if (status.isPending) {
    return (
      <div className="rounded-lg border border-border p-4">
        <p className="text-sm text-muted-foreground">
          Loading the sharing status…
        </p>
      </div>
    );
  }
  if (status.isError) {
    return (
      <div className="rounded-lg border border-border p-4">
        <p className="text-sm text-warning">
          Couldn't load the sharing status — reload before changing it.
        </p>
      </div>
    );
  }
  const view = status.data ?? null;

  const onShare = (roots: string[]) => {
    share.mutate({ agentId, roots }, { onSuccess: () => setDialogOpen(false) });
  };

  const onReveal = () => {
    reveal.mutate(
      { agentId },
      { onSuccess: ({ shareString }) => setRevealedLink(shareString) },
    );
  };

  const onSaveName = (name: string) => {
    setName.mutate({ agentId, name }, { onSuccess: () => setNameDraft(null) });
  };

  const onRotate = async () => {
    const confirmed = await showConfirm(
      <>
        Rotate the share link?{" "}
        <strong>Everyone with the current link loses access</strong> until you
        hand them the new one.
      </>,
      "Rotate share link",
      { kind: "destructive" },
    );
    if (!confirmed) return;
    rotate.mutate(
      { agentId },
      {
        onSuccess: ({ shareString }) => {
          setRevealedLink(shareString);
          emitToast({
            kind: "success",
            message: "Share link rotated — hand out the new one.",
          });
        },
      },
    );
  };

  const onUnshare = async () => {
    const confirmed = await showConfirm(
      <>
        Stop sharing this knowledge base? The published copy is deleted and the
        share link stops working immediately.{" "}
        <strong>Your knowledge base itself is untouched.</strong>
      </>,
      "Stop sharing",
      { kind: "destructive" },
    );
    if (!confirmed) return;
    setRevealedLink(null);
    revoke.mutate({ agentId });
  };

  if (!view) {
    return (
      <div className="rounded-lg border border-border p-4">
        <p className="mb-3 text-sm text-muted-foreground">
          Share this knowledge base as a read-only endpoint: teammates paste a
          share link into their own account and every agent they grant it to can
          list, search, and read the published content. {AWARENESS_COPY}
        </p>
        <Button onClick={() => setDialogOpen(true)}>
          Share this knowledge base
        </Button>
        {dialogOpen && (
          <KbShareRootsDialog
            agentId={agentId}
            pending={share.isPending}
            onCancel={() => setDialogOpen(false)}
            onShare={onShare}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {view.publishState === "publishing" ? (
          <Badge variant="info">Publishing…</Badge>
        ) : view.publishState === "failed" ? (
          <Badge variant="warning">Update failed</Badge>
        ) : view.snapshotCreatedAt !== null ? (
          <Badge variant="success">Shared</Badge>
        ) : (
          <Badge variant="info">Waiting to publish…</Badge>
        )}
        {view.documentCount !== null && (
          <span className="text-muted-foreground">
            {view.documentCount} documents
          </span>
        )}
        {view.snapshotCreatedAt && (
          <span className="text-muted-foreground">
            · updated {timeAgo(view.snapshotCreatedAt)}
          </span>
        )}
        <span className="text-muted-foreground">· updates automatically</span>
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="kb-public-name"
          className="text-xs font-medium text-muted-foreground"
        >
          Public name
        </label>
        <div className="flex items-center gap-2">
          <Input
            id="kb-public-name"
            size="sm"
            placeholder="Name people see for this knowledge base"
            value={nameDraft ?? view.publicName ?? ""}
            onChange={(e) => setNameDraft(e.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={
              setName.isPending ||
              nameDraft === null ||
              nameDraft.trim().length === 0 ||
              nameDraft.trim() === (view.publicName ?? "")
            }
            onClick={() => onSaveName((nameDraft ?? "").trim())}
          >
            {setName.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          What consumers see when they connect this knowledge base.
        </p>
      </div>

      {view.publishState === "failed" && view.publishError && (
        <Callout tone="danger" size="sm">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>Last update failed: {view.publishError}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={refresh.isPending}
              onClick={() => refresh.mutate({ agentId })}
            >
              Retry
            </Button>
          </div>
        </Callout>
      )}

      <div className="flex items-center gap-2">
        {revealedLink ? (
          <>
            <Input
              readOnly
              aria-label="Share link"
              value={revealedLink}
              size="sm"
              variant="monospace"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Copy share link"
              tooltip="Copy share link"
              onClick={() => void copy(revealedLink)}
            >
              {copied ? (
                <Checkmark size={14} className="text-success" />
              ) : (
                <Copy size={14} />
              )}
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={reveal.isPending}
            onClick={onReveal}
          >
            {reveal.isPending ? "Revealing…" : "Reveal share link"}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Shared folders:</span>
        {view.roots.map((root) => (
          <Badge key={root} variant="muted" size="sm">
            {root}/
          </Badge>
        ))}
        <span>
          · {view.queryCount} queries
          {view.lastUsedAt ? ` · last used ${timeAgo(view.lastUsedAt)}` : ""}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">{AWARENESS_COPY}</p>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={refresh.isPending || view.publishState === "publishing"}
          onClick={() => refresh.mutate({ agentId })}
        >
          Refresh now
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={rotate.isPending}
          onClick={() => void onRotate()}
        >
          Rotate link…
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:text-destructive"
          disabled={revoke.isPending}
          onClick={() => void onUnshare()}
        >
          Stop sharing…
        </Button>
      </div>
    </div>
  );
}
