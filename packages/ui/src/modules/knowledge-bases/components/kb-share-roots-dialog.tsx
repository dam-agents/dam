import { useMemo, useState } from "react";

import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Checkbox } from "@/components/ui/checkbox";

import { useKbShareDefaults } from "../api/kb-share-queries.js";

interface Props {
  agentId: string;
  pending: boolean;
  onCancel: () => void;
  onShare: (roots: string[]) => void;
}

export function KbShareRootsDialog({
  agentId,
  pending,
  onCancel,
  onShare,
}: Props) {
  const defaults = useKbShareDefaults(agentId, true);
  const defaultRoots = useMemo(
    () => defaults.data?.roots ?? [],
    [defaults.data],
  );
  const workspace = defaults.data?.workspace;
  const available = workspace?.state === "listed" ? workspace.roots : undefined;
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const choices = useMemo(() => {
    const listed = available ?? [];
    return [...new Set([...listed, ...defaultRoots])].sort().map((name) => ({
      name,
      missing: available !== undefined && !listed.includes(name),
    }));
  }, [available, defaultRoots]);

  const isSelected = (name: string): boolean =>
    overrides[name] ?? defaultRoots.includes(name);
  const selected = choices
    .filter((c) => !c.missing && isSelected(c.name))
    .map((c) => c.name);

  return (
    <Modal>
      <DialogHeader
        title="Share this knowledge base"
        onClose={onCancel}
        closeDisabled={pending}
      />
      <DialogBody>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            You are making the selected folders readable to anyone with the
            share link — nothing more. Consumers get raw file access only:
            skills, commands, and agent behavior are not shared and will not
            work for them.
          </p>

          <div className="flex flex-col gap-2">
            {defaults.isPending && (
              <p className="text-xs text-muted-foreground">
                Listing workspace folders…
              </p>
            )}
            {defaults.isError && (
              <p className="text-xs text-warning">
                Couldn't load the sharing options — close this dialog and try
                again.
              </p>
            )}
            {workspace?.state === "unreachable" && (
              <p className="text-xs text-warning">
                Couldn't list the workspace folders — the knowledge base may be
                asleep. Wake it to browse, or share the default folders below.
              </p>
            )}
            {workspace?.state === "listed" && workspace.roots.length === 0 && (
              <p className="text-xs text-muted-foreground">
                This knowledge base has no folders in its workspace yet — add
                content before sharing.
              </p>
            )}
            {choices.map((choice) => (
              <label
                key={choice.name}
                className={`flex items-center gap-2 text-sm ${
                  choice.missing ? "text-muted-foreground" : "text-foreground"
                }`}
              >
                <Checkbox
                  checked={!choice.missing && isSelected(choice.name)}
                  disabled={choice.missing || pending}
                  onCheckedChange={(checked) =>
                    setOverrides((prev) => ({
                      ...prev,
                      [choice.name]: checked === true,
                    }))
                  }
                />
                <span className="font-mono">{choice.name}/</span>
                {choice.missing && (
                  <span className="text-xs">(not in the workspace)</span>
                )}
              </label>
            ))}
          </div>
        </div>
      </DialogBody>
      <DialogActions
        onCancel={onCancel}
        cancelLabel="Cancel"
        label="Share"
        pendingLabel="Sharing…"
        pending={pending}
        cancelDisabled={pending}
        disabled={selected.length === 0}
        onSubmit={() => onShare(selected)}
      />
    </Modal>
  );
}
