import {
  DocumentAdd,
  Download,
  Edit,
  FolderAdd,
  TextCreation,
  TrashCan,
  Upload,
} from "@carbon/icons-react";
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
          <Item onSelect={() => onAction("new-file")}>
            <DocumentAdd size={14} />
            New file…
          </Item>
          <Item onSelect={() => onAction("new-folder")}>
            <FolderAdd size={14} />
            New folder…
          </Item>
          <Item onSelect={() => onAction("upload-here")}>
            <Upload size={14} />
            Upload files here…
          </Item>
        </>
      ) : (
        <>
          {path !== PLATFORM_INSTRUCTIONS_PATH && (
            <Item onSelect={() => onAction("edit")}>
              <Edit size={14} />
              Edit
            </Item>
          )}
          <Item onSelect={() => onAction("download")}>
            <Download size={14} />
            Download
          </Item>
        </>
      )}
      <Item onSelect={() => onAction("rename")}>
        <TextCreation size={14} />
        Rename
      </Item>
      <Item tone="danger" onSelect={() => onAction("delete")}>
        <TrashCan size={14} />
        {isDir ? "Delete folder" : "Delete file"}
      </Item>
    </>
  );
}
