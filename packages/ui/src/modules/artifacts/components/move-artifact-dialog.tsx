import type { LibraryArtifact } from "api-server-api";
import { useEffect, useState } from "react";

import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Select } from "@/components/ui/select";

import { useUpdateArtifact } from "../api/mutations.js";
import { useArtifactFolders } from "../api/queries.js";
import {
  folderDisplayName,
  isExperimentFolder,
  isUserFolder,
} from "../lib/folders.js";

const NO_FOLDER = "";

interface Props {
  artifact: LibraryArtifact;
  onClose: () => void;
}

export function MoveArtifactDialog({ artifact, onClose }: Props) {
  const { data: folders, isError: foldersFailed } = useArtifactFolders();
  const [chosen, setChosen] = useState<string | null>(null);
  const update = useUpdateArtifact();
  const pending = update.isPending;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pending, onClose]);

  const all = folders ?? [];
  const userFolders = all.filter(isUserFolder);
  const experimentFolders = all.filter(isExperimentFolder);
  const currentFolderId = artifact.folderId ?? NO_FOLDER;
  const selected = chosen ?? currentFolderId;

  const move = () => {
    if (pending) return;
    if (selected === currentFolderId) {
      onClose();
      return;
    }
    update.mutate(
      { id: artifact.id, folderId: selected === NO_FOLDER ? null : selected },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal>
      <DialogHeader
        onClose={onClose}
        closeDisabled={pending}
        title="Move artifact"
      />
      <DialogBody>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Folder</span>
          <Select
            size="sm"
            aria-label="Folder"
            value={selected}
            autoFocus
            disabled={folders === undefined}
            onChange={(e) => setChosen(e.target.value)}
          >
            <option value={NO_FOLDER}>No folder</option>
            {userFolders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folderDisplayName(folder)}
              </option>
            ))}
            {experimentFolders.length > 0 && (
              <optgroup label="Experiments">
                {experimentFolders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folderDisplayName(folder)}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
          {foldersFailed && (
            <p className="text-xs text-danger">
              Couldn’t load your folders. Close this dialog and try again.
            </p>
          )}
          {folders !== undefined && all.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No folders yet — create one from the Artifacts page first.
            </p>
          )}
        </div>
      </DialogBody>
      <DialogActions
        onCancel={onClose}
        cancelDisabled={pending}
        label="Move"
        pendingLabel="Moving…"
        pending={pending}
        disabled={folders === undefined}
        onSubmit={move}
      />
    </Modal>
  );
}
