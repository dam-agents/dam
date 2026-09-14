import type { LibraryArtifact } from "api-server-api";
import { useState } from "react";
import { Controller } from "react-hook-form";

import { getBrand } from "@/brand";
import {
  DialogActions,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";

import { useShareForm } from "../hooks/use-share-form.js";
import { PUBLIC_SHARE_TITLE, publicShareMessage } from "../lib/public-share.js";
import { ShareLinkRow } from "./share-link-row.js";
import { ShareVisibilityChoice } from "./share-visibility-choice.js";
import { ViewerListEditor } from "./viewer-list-editor.js";

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
  const { form, shareUrl, needsPublicConfirm, submit, isPending } =
    useShareForm(artifact, onClose);
  const [draftEmail, setDraftEmail] = useState("");
  const [confirmingPublic, setConfirmingPublic] = useState(false);
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
          : confirmingPublic
            ? () => setConfirmingPublic(false)
            : onClose
      }
    >
      {confirmingPublic ? (
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
            onSubmit={() => void submit({ closeOnSuccess: true })}
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
                  />
                )}
              />
              {visibility === "restricted" && viewerEditor}
              {hasPendingViewer && (
                <p role="status" className="text-xs text-muted-foreground">
                  Add the email address to the list or clear it before saving.
                </p>
              )}
              {hasLink && <ShareLinkRow shareUrl={shareUrl} />}
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
