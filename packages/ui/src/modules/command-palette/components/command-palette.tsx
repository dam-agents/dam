import type { SessionView } from "api-server-api";
import { useCallback, useState } from "react";

import { MessengerBindDialog } from "../../sandboxes/components/channels/messenger-bind-dialog.js";
import type { BindMessenger } from "../../sandboxes/components/channels/messenger-instructions.js";
import { RenameSessionDialog } from "../../sessions/components/rename-session-dialog.js";
import { usePaletteActions } from "../hooks/use-palette-actions.js";
import { usePaletteHotkey } from "../hooks/use-palette-hotkey.js";
import { PaletteDialog } from "./palette-dialog.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the command palette's place in the app: the
 * hotkey that toggles it, and the dialogs a command opens once the palette
 * has closed. Nothing else in the app shows or names it.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [binding, setBinding] = useState<BindMessenger | null>(null);
  const [renaming, setRenaming] = useState<{
    agentId: string;
    session: SessionView;
  } | null>(null);
  const actions = usePaletteActions({
    onBind: setBinding,
    onRenameSession: (agentId, session) => setRenaming({ agentId, session }),
  });
  usePaletteHotkey(useCallback(() => setOpen((was) => !was), []));

  return (
    <>
      {open && (
        <PaletteDialog actions={actions} onClose={() => setOpen(false)} />
      )}
      {binding && (
        <MessengerBindDialog
          messenger={binding}
          onClose={() => setBinding(null)}
        />
      )}
      {renaming && (
        <RenameSessionDialog
          agentId={renaming.agentId}
          session={renaming.session}
          onClose={() => setRenaming(null)}
        />
      )}
    </>
  );
}
