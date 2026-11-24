import type { ConnectionView } from "api-server-api";

import { cn } from "@/lib/utils";

import { useToolApprovalOffered } from "../hooks/use-tool-approval-offered.js";
import {
  type ConnectionDetail,
  connectionDetail,
} from "../lib/connection-detail.js";
import { isDamConnection } from "../lib/dam-connection.js";

export function ConnectionRowDetail({
  connection,
  grantAccess,
}: {
  connection: ConnectionView;
  grantAccess?: string;
}) {
  const toolApproval = useToolApprovalOffered();
  const detail = connectionDetail(connection, toolApproval);
  const account = detail.account;
  const reach: ConnectionDetail["reach"] = grantAccess
    ? { text: grantAccess }
    : detail.reach;
  if (!account && !reach) return null;
  const dam = isDamConnection(connection);
  return (
    <p
      className={cn(
        "mt-0.5 break-words text-xs",
        dam ? "font-medium text-warning-fg" : "text-muted-foreground",
      )}
      title={[account, reach?.title ?? reach?.text].filter(Boolean).join(" · ")}
      data-testid={`catalog-connection-account-${connection.id}`}
    >
      {account}
      {account && reach && " · "}
      {reach && (
        <span data-testid={`connection-scope-${connection.id}`}>
          {reach.text}
        </span>
      )}
    </p>
  );
}
