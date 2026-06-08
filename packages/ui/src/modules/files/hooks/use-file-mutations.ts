import { useCallback } from "react";

import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import { type BundleEntry, importBundle } from "../api/import-bundle.js";
import {
  MAX_UPLOAD_BYTES,
  useFileCreateMutation,
  useFileDeleteMutation,
  useFileRenameMutation,
  useFileUploadMutation,
  useFolderCreateMutation,
} from "../api/queries.js";
import { trackImport } from "../track-import.js";
import { useIsImporting } from "./use-is-importing.js";

export type FileEntryKind = "file" | "dir";

interface CreateEntryInput {
  kind: FileEntryKind;
  dir: string;
  name: string;
}

interface RenameEntryInput {
  from: string;
  nextName: string;
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

function isConflictError(err: unknown): boolean {
  return err instanceof Error && /conflict|already exists/i.test(err.message);
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function sanitizeUploadName(name: string): string {
  return name.replace(/\\/g, "/").split("/").filter(Boolean).join("/") || name;
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function useFileMutations(agentId: string | null) {
  const showConfirm = useStore((s) => s.showConfirm);
  const openFilePath = useStore((s) => s.openFilePath);
  const setOpenFilePath = useStore((s) => s.setOpenFilePath);
  const renameExpandedDir = useStore((s) => s.renameExpandedDir);
  const pruneExpandedDir = useStore((s) => s.pruneExpandedDir);

  const createFile = useFileCreateMutation(agentId);
  const createFolder = useFolderCreateMutation(agentId);
  const renameMutation = useFileRenameMutation(agentId);
  const deleteMutation = useFileDeleteMutation(agentId);
  const uploadMutation = useFileUploadMutation(agentId);

  const isUploading = useIsImporting(agentId);

  const createEntry = useCallback(
    async ({ kind, dir, name }: CreateEntryInput) => {
      const cleaned = name.trim().replace(/^\/+/, "");
      if (!cleaned) return;
      const path = joinPath(dir, cleaned);
      try {
        if (kind === "file") {
          await createFile.mutateAsync({ path, content: "" });
          emitToast({ kind: "success", message: `Created ${path}` });
        } else {
          await createFolder.mutateAsync({ path });
          emitToast({ kind: "success", message: `Created ${path}/` });
        }
      } catch (err) {
        emitToast({
          kind: "error",
          message: errorMessage(err, "Create failed"),
        });
      }
    },
    [createFile, createFolder],
  );

  const renameEntry = useCallback(
    async ({ from, nextName }: RenameEntryInput) => {
      const to = joinPath(parentOf(from), nextName);
      if (to === from) return;

      const tryRename = async (overwrite: boolean) => {
        await renameMutation.mutateAsync({ from, to, overwrite });
        if (agentId) renameExpandedDir(agentId, from, to);
        if (openFilePath === from) setOpenFilePath(to);
      };

      try {
        await tryRename(false);
      } catch (err) {
        if (!isConflictError(err)) {
          emitToast({
            kind: "error",
            message: errorMessage(err, "Rename failed"),
          });
          return;
        }
        const ok = await showConfirm(
          `"${nextName}" already exists. Overwrite?`,
          "Overwrite",
        );
        if (!ok) return;
        try {
          await tryRename(true);
        } catch (err2) {
          emitToast({
            kind: "error",
            message: errorMessage(err2, "Rename failed"),
          });
        }
      }
    },
    [
      renameMutation,
      agentId,
      renameExpandedDir,
      openFilePath,
      setOpenFilePath,
      showConfirm,
    ],
  );

  const deleteEntry = useCallback(
    async (path: string, type: FileEntryKind) => {
      const isDir = type === "dir";
      const msg = isDir
        ? `Delete ${path}/? This will remove its contents.`
        : `Delete ${path}?`;
      const ok = await showConfirm(msg, "Delete");
      if (!ok) return;
      try {
        await deleteMutation.mutateAsync({ path });
        if (agentId) pruneExpandedDir(agentId, path);
        if (
          openFilePath === path ||
          (openFilePath ?? "").startsWith(path + "/")
        ) {
          setOpenFilePath(null);
        }
        emitToast({ kind: "success", message: `Deleted ${path}` });
      } catch (err) {
        emitToast({
          kind: "error",
          message: errorMessage(err, "Delete failed"),
        });
      }
    },
    [
      deleteMutation,
      agentId,
      pruneExpandedDir,
      openFilePath,
      setOpenFilePath,
      showConfirm,
    ],
  );

  const uploadFiles = useCallback(
    async (files: FileList | File[], targetDir?: string) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      const dir = (targetDir ?? "").replace(/^\/+|\/+$/g, "");
      const prefix = dir ? `${dir}/` : "";

      const uploadOne = async (
        path: string,
        contentBase64: string,
        contentType: string | undefined,
      ) => {
        try {
          await uploadMutation.mutateAsync({
            path,
            contentBase64,
            contentType,
          });
          return true;
        } catch (err) {
          if (!isConflictError(err)) throw err;
          const ok = await showConfirm(
            `"${path}" already exists. Overwrite?`,
            "Overwrite",
          );
          if (!ok) return false;
          await uploadMutation.mutateAsync({
            path,
            contentBase64,
            contentType,
            overwrite: true,
          });
          return true;
        }
      };

      await trackImport(agentId, async () => {
        for (const file of list) {
          if (file.size > MAX_UPLOAD_BYTES) {
            emitToast({
              kind: "error",
              message: `${file.name} exceeds 10 MB — skipped`,
            });
            continue;
          }
          const safe = sanitizeUploadName(file.name);
          if (!safe) continue;
          const path = `${prefix}${safe}`;
          try {
            const contentBase64 = await fileToBase64(file);
            const contentType = file.type || undefined;
            const written = await uploadOne(path, contentBase64, contentType);
            if (written)
              emitToast({ kind: "success", message: `Uploaded ${path}` });
          } catch (err) {
            emitToast({
              kind: "error",
              message: errorMessage(err, `Upload failed: ${path}`),
            });
          }
        }
      });
    },
    [uploadMutation, showConfirm, agentId],
  );

  const uploadBundle = useCallback(
    async (entries: BundleEntry[]) => {
      if (!agentId || entries.length === 0) return;
      try {
        await trackImport(agentId, () => importBundle({ agentId, entries }));
        emitToast({
          kind: "success",
          message: `Imported ${entries.length} file${entries.length === 1 ? "" : "s"}`,
        });
      } catch (err) {
        emitToast({
          kind: "error",
          message: errorMessage(err, "Import failed"),
        });
      }
    },
    [agentId],
  );

  return {
    createEntry,
    renameEntry,
    deleteEntry,
    uploadFiles,
    uploadBundle,
    isUploading,
  };
}
