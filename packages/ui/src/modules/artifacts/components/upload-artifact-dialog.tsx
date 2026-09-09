import { Upload } from "@carbon/icons-react";
import type { ArtifactFolder } from "api-server-api";
import { useRef, useState } from "react";

import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getErrorMessage } from "@/lib/errors";

import { useCreateArtifact } from "../api/mutations.js";
import { folderDisplayNames } from "../lib/folders.js";
import { uploadArtifactFile } from "../lib/transfer.js";

interface Props {
  folders: ArtifactFolder[];
  defaultFolderId?: string;
  onClose: () => void;
}

export function UploadArtifactDialog({
  folders,
  defaultFolderId,
  onClose,
}: Props) {
  const folderNames = folderDisplayNames(folders);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [folderId, setFolderId] = useState(defaultFolderId ?? "");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = useCreateArtifact();

  const submit = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const uploadRef = await uploadArtifactFile(file);
      create.mutate(
        {
          title: title.trim() || file.name,
          uploadRef,
          fileName: file.name,
          ...(folderId ? { folderId } : {}),
        },
        { onSuccess: onClose, onSettled: () => setUploading(false) },
      );
    } catch (err) {
      setError(getErrorMessage(err, "Upload failed"));
      setUploading(false);
    }
  };

  return (
    <Modal>
      <DialogHeader title="Upload artifact" onClose={onClose} />
      <DialogBody>
        <div className="flex flex-col gap-4">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const picked = e.target.files?.[0] ?? null;
              setFile(picked);
              if (picked && !title) setTitle(picked.name);
            }}
          />
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={16} />
            {file ? file.name : "Choose a file…"}
          </Button>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Title</span>
            <Input
              size="sm"
              placeholder="Shown in the library and on the share page"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Folder</span>
            <Select
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
            >
              <option value="">No folder</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folderNames.get(folder.id) ?? folder.name}
                </option>
              ))}
            </Select>
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}
          <p className="text-xs text-muted-foreground">
            The artifact stays private until you share it. HTML, JSX, markdown,
            and code render on the share page; anything else is downloadable.
          </p>
        </div>
      </DialogBody>
      <DialogActions
        onCancel={onClose}
        label="Upload"
        pendingLabel="Uploading…"
        pending={uploading || create.isPending}
        disabled={!file}
        onSubmit={() => void submit()}
      />
    </Modal>
  );
}
