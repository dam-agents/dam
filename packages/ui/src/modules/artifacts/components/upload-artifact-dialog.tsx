import type { ArtifactFolder } from "api-server-api";
import { Upload } from "lucide-react";
import { useRef, useState } from "react";

import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

import { useCreateArtifact } from "../api/mutations.js";
import { uploadArtifactFile } from "../lib/transfer.js";

interface Props {
  folders: ArtifactFolder[];
  defaultFolderId?: string;
  onClose: () => void;
}

/** Upload flow: bytes go through the authenticated upload route first, then
 *  the artifact is created from the returned uploadRef — the same two-step
 *  direct-transfer shape agents use over MCP. */
export function UploadArtifactDialog({
  folders,
  defaultFolderId,
  onClose,
}: Props) {
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
      setError(err instanceof Error ? err.message : "Upload failed");
      setUploading(false);
    }
  };

  return (
    <Modal>
      <DialogHeader title="Upload artifact" />
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
            <span className="text-[13px] font-medium text-foreground">
              Title
            </span>
            <Input
              size="sm"
              placeholder="Shown in the library and on the share page"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-foreground">
              Folder
            </span>
            <Select
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
            >
              <option value="">No folder</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </Select>
          </div>

          {error && <p className="text-[13px] text-danger">{error}</p>}
          <p className="text-[12px] text-muted-foreground">
            The artifact stays private until you share it. HTML, JSX, markdown,
            and code render on the share page; anything else is downloadable.
          </p>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => void submit()}
          disabled={!file || uploading || create.isPending}
        >
          {uploading || create.isPending ? "Uploading…" : "Upload"}
        </Button>
      </DialogFooter>
    </Modal>
  );
}
