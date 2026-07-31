import type { ArtifactFolder } from "api-server-api";
import { useState } from "react";

import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { useCreateFolder, useUpdateFolder } from "../api/mutations.js";

interface Props {
  /** null = create a new folder. */
  folder: ArtifactFolder | null;
  onClose: () => void;
}

export function FolderDialog({ folder, onClose }: Props) {
  const [name, setName] = useState(folder?.name ?? "");
  const create = useCreateFolder();
  const update = useUpdateFolder();
  const pending = create.isPending || update.isPending;

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (folder) {
      update.mutate({ id: folder.id, name: trimmed }, { onSuccess: onClose });
    } else {
      create.mutate({ name: trimmed }, { onSuccess: onClose });
    }
  };

  return (
    <Modal>
      <DialogHeader title={folder ? "Edit folder" : "New folder"} />
      <DialogBody>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Name</span>
            <Input
              size="sm"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
              }}
            />
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save} disabled={!name.trim() || pending}>
          {pending ? "Saving…" : folder ? "Save" : "Create"}
        </Button>
      </DialogFooter>
    </Modal>
  );
}
