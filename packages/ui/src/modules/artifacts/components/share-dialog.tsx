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
  const { form, shareUrl, needsPublicConfirm, submit, isPending } =
    useShareForm(artifact, onClose);
  const [confirmingPublic, setConfirmingPublic] = useState(false);
  const visibility = form.watch("visibility");
  const hasLink = visibility !== "private" && shareUrl !== null;

  const onSave = () => {
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
        />
      )}
    />
  );

  return (
    <Modal>
      {confirmingPublic ? (
        <>
          <DialogHeader
            title={PUBLIC_SHARE_TITLE}
            onClose={onClose}
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
                    restrictedPanel={viewerEditor}
                  />
                )}
              />
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
            disabled={!form.formState.isDirty}
            onSubmit={onSave}
          />
        </>
      )}
    </Modal>
  );
}
