import type { ComponentType, ReactNode } from "react";

export type FileRowMenuAction =
  | "edit"
  | "download"
  | "new-file"
  | "new-folder"
  | "upload-here"
  | "rename"
  | "delete";

/** Shape both DropdownMenuItem and ContextMenuItem satisfy — `onSelect` is the
 *  Radix item signature, so either primitive can render the shared list. */
interface MenuItemProps {
  tone?: "default" | "danger";
  onSelect?: (event: Event) => void;
  children: ReactNode;
}

/**
 * The files-panel row menu, defined once and rendered with either the
 * DropdownMenu (hover kebab) or ContextMenu (right-click) item primitive.
 */
export function FileRowMenuItems({
  isDir,
  onAction,
  Item,
}: {
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
          <Item onSelect={() => onAction("edit")}>Edit</Item>
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
