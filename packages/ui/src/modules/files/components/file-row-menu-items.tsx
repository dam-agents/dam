import type { ComponentType, ReactNode } from "react";

import { PLATFORM_INSTRUCTIONS_PATH } from "../lib/platform-instructions.js";

export type FileRowMenuAction =
  | "edit"
  | "download"
  | "new-file"
  | "new-folder"
  | "upload-here"
  | "rename"
  | "delete";

interface MenuItemProps {
  tone?: "default" | "danger";
  onSelect?: (event: Event) => void;
  children: ReactNode;
}

export function FileRowMenuItems({
  path,
  isDir,
  onAction,
  Item,
}: {
  path: string;
  isDir: boolean;
  onAction: (action: FileRowMenuAction) => void;
  Item: ComponentType<MenuItemProps>;
}) {
  return (
    <>
      {isDir ? (
        <>
          <Item onSelect={() => onAction("new-file")}>New file…</Item>
          <Item onSelect={() => onAction("new-folder")}>New folder…</Item>
          <Item onSelect={() => onAction("upload-here")}>
            Upload files here…
          </Item>
        </>
      ) : (
        <>
          {path !== PLATFORM_INSTRUCTIONS_PATH && (
            <Item onSelect={() => onAction("edit")}>Edit</Item>
          )}
          <Item onSelect={() => onAction("download")}>Download</Item>
        </>
      )}
      <Item onSelect={() => onAction("rename")}>Rename</Item>
      <Item tone="danger" onSelect={() => onAction("delete")}>
        Delete
      </Item>
    </>
  );
}
