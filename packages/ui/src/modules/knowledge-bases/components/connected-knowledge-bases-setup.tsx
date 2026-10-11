import { useAppConnections } from "../../connections/api/queries.js";
import { KnowledgeBaseList } from "./connected-knowledge-bases.js";

interface Props {
  connectionIds: string[];
  onToggle: (id: string, granted: boolean) => void;
}

export function ConnectedKnowledgeBasesSetup({
  connectionIds,
  onToggle,
}: Props) {
  const connectionsQ = useAppConnections({ fresh: true });
  const staged = new Set(connectionIds);
  return (
    <KnowledgeBaseList
      label="Knowledge bases"
      description="Give this agent read-only access to other knowledge bases: it can list, search and read their content."
      connections={(connectionsQ.data ?? []).filter((c) => staged.has(c.id))}
      onAdd={(id) => onToggle(id, true)}
      onRemove={(id) => onToggle(id, false)}
      status={
        connectionsQ.isError
          ? "Couldn't load the knowledge bases already added — they stay selected and reappear once the list loads."
          : connectionsQ.isPending && connectionIds.length > 0
            ? "Loading the knowledge bases already added…"
            : null
      }
    />
  );
}
