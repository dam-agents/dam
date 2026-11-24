import type { ConnectionView } from "api-server-api";

import { retiredHostNote } from "../lib/github-enterprise-hosts.js";

export function RetiredHostNote({
  connection,
}: {
  connection: ConnectionView;
}) {
  const note = retiredHostNote(connection);
  if (!note) return null;
  return (
    <p
      className="mt-0.5 text-xs text-muted-foreground"
      data-testid={`catalog-connection-retired-${connection.id}`}
    >
      {note}
    </p>
  );
}
