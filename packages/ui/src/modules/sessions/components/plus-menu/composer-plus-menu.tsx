import { Add } from "@carbon/icons-react";
import type { ConnectionView } from "api-server-api";
import { type ReactNode, useRef, useState } from "react";
import { match } from "ts-pattern";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import type { RowMaintenanceActions } from "../../../connections/components/catalog-connection-row.js";
import { ConnectionMaintenanceDialog } from "../../../connections/components/connection-update-credential-dialog.js";
import { useConnectionMaintenance } from "../../../connections/hooks/use-connection-maintenance.js";
import {
  DESCRIBE_PROMPTS,
  type PlusMenuDialog,
  type PlusMenuPanel,
} from "../../lib/plus-menu.js";
import { ConnectionsQuickPanel } from "./connections-quick-panel.js";
import { PlusMenuDialogs } from "./plus-menu-dialogs.js";
import { PlusMenuRoot } from "./plus-menu-root.js";
import { SchedulesQuickPanel } from "./schedules-quick-panel.js";
import { SkillsQuickPanel } from "./skills-quick-panel.js";

interface Props {
  agentId: string | null;
  disabled: boolean;
  onAttachFile: () => void;
  onDescribe: (text: string) => void;
  onManage?: (panel: PlusMenuPanel) => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The + button at the start of the composer and
 * the menu it opens, so a person reaches what the Agent works with without
 * leaving the chat: attach a file, and the Agent's skills, schedules and
 * Connections, each turned on or off in place, added through its usual
 * dialog, or, for skills and schedules, described to the Agent with a
 * starting prompt left in the composer. Manage opens the same section of the
 * Agent's settings. The lists load only while the menu is open.
 */
export function ComposerPlusMenu({
  agentId,
  disabled,
  onAttachFile,
  onDescribe,
  onManage,
}: Props) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<PlusMenuPanel | null>(null);
  const [dialog, setDialog] = useState<PlusMenuDialog | null>(null);
  /* UNIT_BOUNDARY_DESCRIPTION: whether the menu has opened in this composer: until it has, nothing behind it, the Connection maintenance included, is mounted or loaded. */
  const [armed, setArmed] = useState(false);
  const focusHandedOff = useRef(false);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) setArmed(true);
    else setPanel(null);
  };
  const closeAndThen = (then: () => void) => {
    focusHandedOff.current = true;
    handleOpenChange(false);
    then();
  };
  const back = () => setPanel(null);
  const manage = (section: PlusMenuPanel) =>
    onManage && (() => closeAndThen(() => onManage(section)));
  const describe = (text: string) => () => closeAndThen(() => onDescribe(text));
  const openDialog = (next: PlusMenuDialog) => () =>
    closeAndThen(() => setDialog(next));

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 mb-[9px] text-muted-foreground hover:text-primary disabled:opacity-40"
            disabled={disabled || !agentId}
            aria-label="Add"
            tooltip="Add"
            data-testid="composer-plus-menu"
          >
            <Add size={16} />
          </Button>
        </PopoverTrigger>
        {armed && (
          <ConnectionMaintenanceHost closeMenuAndThen={closeAndThen}>
            {(rowActions) => (
              <PopoverContent
                side="top"
                align="start"
                tail={false}
                className="flex max-h-[60vh] w-[360px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden p-0"
                onCloseAutoFocus={(e) => {
                  if (!focusHandedOff.current) return;
                  focusHandedOff.current = false;
                  e.preventDefault();
                }}
              >
                {agentId &&
                  match(panel)
                    .with(null, () => (
                      <PlusMenuRoot
                        agentId={agentId}
                        onAttachFile={() => {
                          handleOpenChange(false);
                          onAttachFile();
                        }}
                        onOpenPanel={setPanel}
                      />
                    ))
                    .with("skills", () => (
                      <SkillsQuickPanel
                        agentId={agentId}
                        onBack={back}
                        onManage={manage("skills")}
                        onAddSource={openDialog({ kind: "add-skill-source" })}
                        onDescribe={describe(DESCRIBE_PROMPTS.skills)}
                      />
                    ))
                    .with("schedules", () => (
                      <SchedulesQuickPanel
                        agentId={agentId}
                        onBack={back}
                        onManage={manage("schedules")}
                        onCreate={openDialog({ kind: "add-schedule" })}
                        onEdit={(schedule) =>
                          openDialog({ kind: "edit-schedule", schedule })()
                        }
                        onDescribe={describe(DESCRIBE_PROMPTS.schedules)}
                      />
                    ))
                    .with("connections", () => (
                      <ConnectionsQuickPanel
                        agentId={agentId}
                        onBack={back}
                        onManage={manage("connections")}
                        onAdd={openDialog({ kind: "add-connection" })}
                        rowActions={rowActions}
                      />
                    ))
                    .exhaustive()}
              </PopoverContent>
            )}
          </ConnectionMaintenanceHost>
        )}
      </Popover>
      {agentId && dialog && (
        <PlusMenuDialogs
          agentId={agentId}
          dialog={dialog}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

type RowActions = (
  connection: ConnectionView,
) => RowMaintenanceActions | undefined;

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Connection maintenance of the + menu's
 * Connections panel, kept above the panel: a row's action that opens a dialog
 * closes the menu first, and the dialog is drawn here, outside the menu, so it
 * is neither under the menu nor closed by a click in it, and it outlives the
 * panel.
 */
function ConnectionMaintenanceHost({
  closeMenuAndThen,
  children,
}: {
  closeMenuAndThen: (then: () => void) => void;
  children: (rowActions: RowActions) => ReactNode;
}) {
  const maintenance = useConnectionMaintenance();
  const rowActions: RowActions = (connection) => {
    const actions = maintenance.rowActions(connection);
    if (!actions) return actions;
    const { onUpdateCredential, onEditScope, onMoveHost } = actions;
    return {
      ...actions,
      ...(onUpdateCredential && {
        onUpdateCredential: () => closeMenuAndThen(onUpdateCredential),
      }),
      ...(onEditScope && {
        onEditScope: () => closeMenuAndThen(onEditScope),
      }),
      ...(onMoveHost && { onMoveHost: () => closeMenuAndThen(onMoveHost) }),
    };
  };
  return (
    <>
      {children(rowActions)}
      <ConnectionMaintenanceDialog maintenance={maintenance} />
    </>
  );
}
