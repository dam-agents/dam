import type { LibraryArtifact } from "api-server-api";
import { useState } from "react";
import { Controller } from "react-hook-form";

import { getBrand } from "@/brand";
import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Callout } from "@/components/ui/callout";
import { CopyField } from "@/components/ui/copy-field";

import { useShareForm } from "../hooks/use-share-form.js";
import { PUBLIC_SHARE_TITLE, publicShareMessage } from "../lib/public-share.js";
import { toastCopyOutcome } from "../lib/share-link.js";
import { ShareVisibilityChoice } from "./share-visibility-choice.js";
import { ViewerListEditor } from "./viewer-list-editor.js";

interface Props {
  artifact: LibraryArtifact;
  onClose: () => void;
}

const INTERACTIVE_UNAVAILABLE = {
  public: "Not for interactive pages: their buttons can ask your agent",
};

export function ShareDialog({ artifact, onClose }: Props) {
  const { form, shareUrl, needsPublicConfirm, submit, isPending } =
    useShareForm(artifact, onClose);
  const [draftEmail, setDraftEmail] = useState("");
  const [confirmingPublic, setConfirmingPublic] = useState(false);
  const confirmShown = confirmingPublic && needsPublicConfirm;
  const visibility = form.watch("visibility");
  const hasLink = visibility !== "private" && shareUrl !== null;
  const hasPendingViewer =
    visibility === "restricted" && draftEmail.trim().length > 0;

  const onSave = () => {
    if (hasPendingViewer) return;
    if (needsPublicConfirm) setConfirmingPublic(true);
    else void submit();
  };

  const viewerEditor = (
    <Controller
      control={form.control}
      name="viewers"
      render={({ field }) => (
        <ViewerListEditor
          viewers={field.value}
          onChange={field.onChange}
          disabled={isPending}
          draft={draftEmail}
          onDraftChange={setDraftEmail}
        />
      )}
    />
  );

  return (
    <Modal
      onClose={
        isPending
          ? undefined
          : confirmShown
            ? () => setConfirmingPublic(false)
            : onClose
      }
    >
      {confirmShown ? (
        <>
          <DialogHeader
            title={PUBLIC_SHARE_TITLE}
            onClose={() => setConfirmingPublic(false)}
            closeDisabled={isPending}
            divided={false}
          />
          <DialogBody className="pt-0">
            <p className="text-sm text-muted-foreground">
              {publicShareMessage(getBrand().vendor)}
            </p>
          </DialogBody>
          <DialogActions
            onCancel={() => setConfirmingPublic(false)}
            label="Share publicly"
            pendingLabel="Sharing…"
            pending={isPending}
            cancelDisabled={isPending}
            onSubmit={() => {
              setConfirmingPublic(false);
              void submit();
            }}
          />
        </>
      ) : (
        <>
          <DialogHeader
            title={`Share “${artifact.title}”`}
            onClose={onClose}
            closeDisabled={isPending}
          />
          <DialogBody>
            <div className="flex flex-col gap-4">
              <Controller
                control={form.control}
                name="visibility"
                render={({ field }) => (
                  <ShareVisibilityChoice
                    value={field.value}
                    onChange={field.onChange}
                    disabled={isPending}
                    unavailable={
                      artifact.interactive ? INTERACTIVE_UNAVAILABLE : undefined
                    }
                  />
                )}
              />
              {visibility === "restricted" && viewerEditor}
              {artifact.interactive && visibility === "restricted" && (
                <Callout
                  tone="warning"
                  size="sm"
                  role="note"
                  className="text-xs"
                >
                  People you invite use this page as you do: it can read and
                  change your agent&apos;s data, and its buttons send your agent
                  prompts. Your agent acts on them under your account.
                </Callout>
              )}
              {hasPendingViewer && (
                <p role="status" className="text-xs text-muted-foreground">
                  Add the email address to the list or clear it before saving.
                </p>
              )}
              {hasLink && (
                <CopyField
                  value={shareUrl}
                  label="Share link"
                  onResult={toastCopyOutcome}
                />
              )}
            </div>
          </DialogBody>
          <DialogActions
            onCancel={onClose}
            cancelLabel="Close"
            label="Save"
            pendingLabel="Saving…"
            pending={isPending}
            cancelDisabled={isPending}
            disabled={!form.formState.isDirty || hasPendingViewer}
            onSubmit={onSave}
          />
        </>
      )}
    </Modal>
  );
}
