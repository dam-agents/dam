import { Cloud } from "@carbon/icons-react";
import type { EnvironmentView } from "api-server-api";
import { type CSSProperties, useState } from "react";

import { TREE_GUIDE, treeGuideX } from "@/components/ui/tree-guide";

import { EnvironmentExpiryDialog } from "./environment-expiry-dialog.js";
import { EnvironmentRow } from "./environment-row.js";
import { EnvironmentShareDialog } from "./environment-share-dialog.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Environments of the Artifacts list, above its
 * folders: a group that folds like a folder, with a row per Environment and
 * the dialogs its rows open. The list passes only the Environments it shows,
 * so the group is absent when there are none.
 */
export function EnvironmentsGroup({
  environments,
  showAgent,
  collapsed,
  onToggle,
}: {
  environments: readonly EnvironmentView[];
  showAgent: boolean;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const [shareId, setShareId] = useState<string | null>(null);
  const [expiryId, setExpiryId] = useState<string | null>(null);
  const shareTarget = environments.find((e) => e.id === shareId);
  const expiryTarget = environments.find((e) => e.id === expiryId);
  const count = environments.length;

  return (
    <div data-testid="artifacts-environments">
      <div className="group flex h-8 items-center transition-colors hover:bg-muted">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-3 text-left text-sm text-foreground"
        >
          <Cloud size={16} className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">Environments</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {count} Environment{count === 1 ? "" : "s"}
          </span>
        </button>
      </div>
      {!collapsed && (
        <div style={{ "--tree-guide-x": treeGuideX(0) } as CSSProperties}>
          {environments.map((environment) => (
            <div key={environment.id} className={TREE_GUIDE}>
              <EnvironmentRow
                environment={environment}
                depth={1}
                showAgent={showAgent}
                onShare={(e) => setShareId(e.id)}
                onSetExpiry={(e) => setExpiryId(e.id)}
              />
            </div>
          ))}
        </div>
      )}
      {shareTarget && (
        <EnvironmentShareDialog
          environment={shareTarget}
          onClose={() => setShareId(null)}
        />
      )}
      {expiryTarget && (
        <EnvironmentExpiryDialog
          environment={expiryTarget}
          onClose={() => setExpiryId(null)}
        />
      )}
    </div>
  );
}
