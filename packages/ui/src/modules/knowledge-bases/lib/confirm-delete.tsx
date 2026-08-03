import type { DialogSlice } from "../../platform/store/dialog.js";

type ShowConfirm = DialogSlice["showConfirm"];

/** The one delete-KB confirmation — every surface that deletes a knowledge
 *  base (list, config page, chat header) asks with this copy, so the "also
 *  deletes all knowledge" warning can't drift between them. */
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
