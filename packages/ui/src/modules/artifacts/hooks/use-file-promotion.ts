import { INLINE_CONTENT_MAX_BYTES, type LibraryArtifact } from "api-server-api";
import { useMemo, useState } from "react";

import { ACTION_FAILED, runAction } from "../../../lib/query-helpers.js";
import { useStore } from "../../../store.js";
import type { FileContent } from "../../files/api/queries.js";
import { useCreateArtifact, useUpdateArtifact } from "../api/mutations.js";
import { useArtifacts } from "../api/queries.js";
import { uploadArtifactFile } from "../lib/transfer.js";

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function linkedArtifactFor(
  artifacts: readonly LibraryArtifact[],
  path: string,
): LibraryArtifact | null {
  const matches = artifacts.filter((a) => a.sourcePath === path);
  if (matches.length === 0) return null;
  return matches.reduce((newest, a) =>
    a.updatedAt > newest.updatedAt ? a : newest,
  );
}

export interface FilePromotion {
  linked: LibraryArtifact | null;
  linkReady: boolean;
  promotable: boolean;
  pending: boolean;
  promote: () => Promise<void>;
}

export function useFilePromotion(
  agentId: string | null,
  file: FileContent,
): FilePromotion {
  const { data: artifacts } = useArtifacts(agentId ? { agentId } : null);
  const createArtifact = useCreateArtifact();
  const updateArtifact = useUpdateArtifact();
  const setOpenArtifactId = useStore((s) => s.setOpenArtifactId);
  const [uploading, setUploading] = useState(false);

  const linked = useMemo(
    () => linkedArtifactFor(artifacts ?? [], file.path),
    [artifacts, file.path],
  );

  const linkReady = agentId === null || artifacts !== undefined;
  const promotable = linkReady && !file.binary && !file.tooLarge;

  const promote = async () => {
    if (!promotable) return;
    setUploading(true);
    try {
      const name = basename(file.path);
      const big = new Blob([file.content]).size > INLINE_CONTENT_MAX_BYTES;
      let payload: { uploadRef: string } | { content: string };
      if (big) {
        const uploadRef = await runAction(
          () =>
            uploadArtifactFile(
              new File([file.content], name, { type: "text/plain" }),
            ),
          "Publishing the file failed",
        );
        if (uploadRef === ACTION_FAILED) return;
        payload = { uploadRef };
      } else {
        payload = { content: file.content };
      }

      const artifact = linked
        ? await updateArtifact.mutateAsync({
            id: linked.id,
            ...payload,
            sourcePath: file.path,
          })
        : await createArtifact.mutateAsync({
            title: name,
            fileName: name,
            ...payload,
            sourcePath: file.path,
            ...(agentId ? { agentId } : {}),
          });

      setOpenArtifactId(artifact.id);
    } catch {
    } finally {
      setUploading(false);
    }
  };

  return {
    linked,
    linkReady,
    promotable,
    pending: uploading || createArtifact.isPending || updateArtifact.isPending,
    promote,
  };
}
