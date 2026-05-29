import {
  Launch as ExternalLink,
  Login as LogIn,
  TrashCan as Trash2,
} from "@carbon/icons-react";
import type { ConnectionView } from "api-server-api";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { AppStatusPill } from "../../../components/app-status-pill.js";
import { ConnectionIcon } from "./connection-icon.js";

export function ConnectionRow({
  connection,
  iconSlug,
  onDelete,
  onConnect,
  connecting,
  deleting,
}: {
  connection: ConnectionView;
  iconSlug: string | undefined;
  onDelete: () => void;
  onConnect: () => void;
  connecting: boolean;
  deleting: boolean;
}) {
  const needsOAuth =
    connection.authKind === "oauth" && connection.status === "pending";
  const installUrl = githubAppInstallUrl(connection);
  return (
    <Card className="flex flex-row items-center gap-3 px-4 py-3">
      <ConnectionIcon
        iconSlug={iconSlug}
        alt={connection.name}
        size={16}
        className="text-muted-foreground shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-foreground truncate">
          {connection.name}
        </div>
        <div className="text-[11px] text-muted-foreground truncate">
          {connection.hosts.join(", ") || connection.templateId}
        </div>
      </div>
      <AppStatusPill status={connection.status} />
      {needsOAuth && (
        <Button
          size="sm"
          onClick={onConnect}
          disabled={connecting}
          title="Authorize this connection"
        >
          <LogIn /> Connect
        </Button>
      )}
      {installUrl && connection.status === "active" && (
        <Button
          asChild
          variant="outline"
          size="sm"
          title="Install the GitHub App on the repositories this connection should reach. Required for GitHub App credentials (no effect for OAuth Apps)."
        >
          <a href={installUrl} target="_blank" rel="noreferrer noopener">
            <ExternalLink /> Install on GitHub
          </a>
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        onClick={onDelete}
        disabled={deleting}
        className="text-muted-foreground hover:text-destructive"
        title="Delete connection"
      >
        <Trash2 />
      </Button>
    </Card>
  );
}

function githubAppInstallUrl(connection: ConnectionView): string | null {
  if (!connection.appSlug) return null;
  const host =
    connection.templateId === "github-enterprise"
      ? (connection.host ?? null)
      : "github.com";
  if (!host) return null;
  return `https://${host}/apps/${connection.appSlug}/installations/new`;
}
