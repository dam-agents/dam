import type { ConnectionView } from "api-server-api";

import { connectionDetail } from "../lib/connection-detail.js";

export function ConnectionRowDetail({
  connection,
}: {
  connection: ConnectionView;
}) {
  const { account, reach } = connectionDetail(connection);
  if (!account && !reach) return null;
  return (
    <p
      className="mt-0.5 truncate text-xs text-muted-foreground"
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
