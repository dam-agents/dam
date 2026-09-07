import type { ConnectionTemplateView, ConnectionView } from "api-server-api";

import { GithubStepsCallout } from "../forms/github-steps-callout.js";
import { connectionKindSubtitle } from "../lib/catalog-providers.js";
import type {
  RowGrantControls,
  RowMaintenanceActions,
} from "./catalog-connection-row.js";
import { CatalogConnectionRow } from "./catalog-connection-row.js";
import { activeInstallUrl } from "./github-app-install-hint.js";

interface Props {
  connection: ConnectionView;
  template: ConnectionTemplateView | undefined;
  grant?: RowGrantControls;
  onManage?: () => void;
  onDelete?: () => void;
  deleting?: boolean;
  maintenance?: RowMaintenanceActions;
}

export function ConnectionRowCard({
  connection,
  template,
  grant,
  onManage,
  onDelete,
  deleting,
  maintenance,
}: Props) {
  const needsInstall = activeInstallUrl(connection) !== null;
  return (
    <div className="rounded-lg border border-border">
      {needsInstall && (
        <GithubStepsCallout
          templateId={connection.templateId}
          className="mx-3 mt-3"
        />
      )}
      <CatalogConnectionRow
        connection={connection}
        tag={connectionKindSubtitle(connection, template)}
        iconSlug={template?.iconSlug}
        grant={grant}
        onManage={onManage}
        onDelete={onDelete}
        deleting={deleting}
        maintenance={maintenance}
      />
    </div>
  );
}
