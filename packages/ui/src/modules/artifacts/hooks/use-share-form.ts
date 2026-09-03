import type { ArtifactVisibility, LibraryArtifact } from "api-server-api";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { emitToast } from "@/lib/toast";

import { useSetArtifactSharing } from "../api/mutations.js";
import { sameViewers } from "../lib/viewer-allowlist.js";

export interface ShareFormValues {
  visibility: ArtifactVisibility;
  viewers: string[];
}

const SAVED_MESSAGE: Record<ArtifactVisibility, string> = {
  private: "Sharing updated — the artifact is now private.",
  restricted:
    "Sharing updated — only the people on the list can open the link.",
  public: "Sharing updated — the public link is live.",
};

export function useShareForm(artifact: LibraryArtifact, onClose: () => void) {
  const [committed, setCommitted] = useState({
    shareUrl: artifact.shareUrl,
    viewers: artifact.viewers,
  });
  const sharing = useSetArtifactSharing();
  const form = useForm<ShareFormValues>({
    defaultValues: {
      visibility: artifact.visibility,
      viewers: artifact.viewers,
    },
  });

  const submit = form.handleSubmit((values) => {
    const sendViewers =
      values.visibility === "restricted" ||
      !sameViewers(values.viewers, committed.viewers);
    sharing.mutate(
      {
        id: artifact.id,
        visibility: values.visibility,
        ...(sendViewers ? { viewers: values.viewers } : {}),
      },
      {
        onSuccess: (saved) => {
          setCommitted({ shareUrl: saved.shareUrl, viewers: saved.viewers });
          form.reset({ visibility: saved.visibility, viewers: saved.viewers });
          emitToast({
            kind: "success",
            message: SAVED_MESSAGE[saved.visibility],
          });
          if (saved.visibility === "private") onClose();
        },
      },
    );
  });

  return {
    form,
    shareUrl: committed.shareUrl,
    submit,
    isPending: sharing.isPending,
  };
}
