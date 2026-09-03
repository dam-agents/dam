import type { LibraryArtifact } from "api-server-api";
import { Controller } from "react-hook-form";

import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";

import { useShareForm } from "../hooks/use-share-form.js";
import { ShareLinkRow } from "./share-link-row.js";
import { ShareVisibilityChoice } from "./share-visibility-choice.js";
import { ViewerListEditor } from "./viewer-list-editor.js";

interface Props {
  artifact: LibraryArtifact;
  onClose: () => void;
}

export function ShareDialog({ artifact, onClose }: Props) {
  const { form, shareUrl, submit, isPending } = useShareForm(artifact, onClose);
  const visibility = form.watch("visibility");
  const hasLink = visibility !== "private" && shareUrl !== null;

  return (
    <Modal>
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
          {visibility === "restricted" && (
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
        disabled={!form.formState.isDirty}
        onSubmit={() => void submit()}
      />
    </Modal>
  );
}
