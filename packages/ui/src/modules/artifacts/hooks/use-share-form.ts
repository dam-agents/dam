import { zodResolver } from "@hookform/resolvers/zod";
import {
  artifactSharingInputSchema,
  type ArtifactVisibility,
  type LibraryArtifact,
} from "api-server-api";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import { emitToast } from "@/lib/toast";

import { useSetArtifactSharing } from "../api/mutations.js";
import { useArtifact } from "../api/queries.js";
import { becomesPublic } from "../lib/public-share.js";
import { sameViewers } from "../lib/viewer-allowlist.js";

const shareFormSchema = artifactSharingInputSchema
  .pick({ visibility: true, viewers: true })
  .required();

type ShareFormValues = z.infer<typeof shareFormSchema>;

const SAVED_MESSAGE: Record<ArtifactVisibility, string> = {
  private: "Sharing updated — the artifact is now private.",
  restricted:
    "Sharing updated — only you and the people on the list can open the link.",
  public: "Sharing updated — the public link is live.",
};

export function useShareForm(artifact: LibraryArtifact, onClose: () => void) {
  const { data: committed = artifact } = useArtifact(artifact.id);
  const sharing = useSetArtifactSharing();
  const form = useForm<ShareFormValues>({
    resolver: zodResolver(shareFormSchema),
    values: {
      visibility: committed.visibility,
      viewers: committed.viewers,
    },
    resetOptions: { keepDirtyValues: true },
  });

  const submit = (opts?: { closeOnSuccess?: boolean }) =>
    form.handleSubmit((values) => {
      const sendViewers = !sameViewers(values.viewers, committed.viewers);
      sharing.mutate(
        {
          id: artifact.id,
          visibility: values.visibility,
          ...(sendViewers ? { viewers: values.viewers } : {}),
        },
        {
          onSuccess: (saved) => {
            form.reset({
              visibility: saved.visibility,
              viewers: saved.viewers,
            });
            emitToast({
              kind: "success",
              message: SAVED_MESSAGE[saved.visibility],
            });
            if (saved.visibility === "private" || opts?.closeOnSuccess)
              onClose();
          },
        },
      );
    })();

  return {
    form,
    shareUrl: committed.shareUrl,
    needsPublicConfirm: becomesPublic(
      committed.visibility,
      form.watch("visibility"),
    ),
    submit,
    isPending: sharing.isPending,
  };
}
