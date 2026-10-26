import { useCallback, useState } from "react";

import { emitToast } from "@/lib/toast";

import { parseRoute } from "../../platform/lib/routes.js";
import { signedInConnectionId } from "../lib/oauth-return.js";
import { SignedInParentDialog } from "./signed-in-parent-dialog.js";

export function SignInFollowUp() {
  const [connectionId, setConnectionId] = useState(() =>
    parseRoute(window.location.pathname).view === "starter-kit"
      ? null
      : signedInConnectionId(window.location.search),
  );
  const clear = useCallback(() => setConnectionId(null), []);
  if (connectionId === null) return null;
  return (
    <SignedInParentDialog
      connectionId={connectionId}
      onClose={clear}
      onCreated={() => {
        clear();
        emitToast({ kind: "success", message: "Connection created." });
      }}
    />
  );
}
