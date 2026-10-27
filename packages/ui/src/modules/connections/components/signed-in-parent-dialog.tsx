import { emitToast } from "@/lib/toast";

import { useSignedInParent } from "../hooks/use-signed-in-parent.js";
import { parentAddedMessage } from "../lib/connection-hierarchy.js";
import { ConnectionCreateChildDialog } from "./connection-create-child-dialog.js";

interface Props {
  connectionId: string;
  onCreated: (id: string) => void;
  onClose: () => void;
}

export function SignedInParentDialog({
  connectionId,
  onCreated,
  onClose,
}: Props) {
  const parent = useSignedInParent(connectionId, onClose);
  if (!parent) return null;
  return (
    <ConnectionCreateChildDialog
      parent={parent}
      onCreated={onCreated}
      onClose={onClose}
      onLater={() => {
        onClose();
        emitToast({ kind: "success", message: parentAddedMessage(parent) });
      }}
    />
  );
}
