import type { ConnectionView } from "api-server-api";

import { cn } from "@/lib/utils";

import { connectionDetail } from "../lib/connection-detail.js";

export function ConnectionRowDetail({
  connection,
  indented,
}: {
  connection: ConnectionView;
  indented: boolean;
}) {
  const { account, reach } = connectionDetail(connection);
  if (!account && !reach) return null;
  return (
    <p
      className={cn(
        "mt-0.5 truncate text-xs text-muted-foreground",
        indented && "pl-6",
      )}
      title={[account, reach?.text].filter(Boolean).join(" · ")}
      data-testid={`catalog-connection-account-${connection.id}`}
    >
      {account}
      {account && reach && " · "}
      {reach && (
        <span
          className={cn(reach.fullAccess && "font-medium text-danger")}
          data-testid={`connection-scope-${connection.id}`}
        >
          {reach.text}
        </span>
      )}
    </p>
  );
}
