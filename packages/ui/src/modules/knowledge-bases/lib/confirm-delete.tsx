import type { DialogSlice } from "../../platform/store/dialog.js";

type ShowConfirm = DialogSlice["showConfirm"];

export function confirmDeleteKnowledgeBase(
  showConfirm: ShowConfirm,
  name: string,
): Promise<boolean> {
  return showConfirm(
    <>
      Delete knowledge base{" "}
      <strong className="text-foreground">"{name}"</strong>? This will also
      delete <strong>all of its knowledge and data</strong> and cannot be
      undone.
    </>,
    "Delete Knowledge Base",
    { kind: "destructive" },
  );
}
