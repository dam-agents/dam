import { Launch } from "@carbon/icons-react";

import { useKitUpdateChanges } from "../api/queries.js";
import { shortKitVersion } from "../lib/setup.js";

export function KitUpdateChangesCard({
  agentId,
  open,
}: {
  agentId: string;
  open: boolean;
}) {
  const { data: changes, isLoading } = useKitUpdateChanges(agentId, open);

  if (isLoading)
    return <p className="text-muted-foreground">Loading changes…</p>;
  if (!changes)
    return <p className="text-muted-foreground">No changes to show.</p>;

  const range =
    changes.versionFrom && changes.versionTo
      ? `${changes.versionFrom} → ${changes.versionTo}`
      : `${shortKitVersion(changes.from)} → ${shortKitVersion(changes.to)}`;
  const hidden =
    changes.commits && changes.totalCommits
      ? changes.totalCommits - changes.commits.length
      : 0;

  return (
    <div className="flex flex-col gap-2" data-testid="kit-update-changes">
      <p className="font-bold text-foreground">Kit update · {range}</p>
      {changes.changelog && (
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap font-sans text-xs text-muted-foreground">
          {changes.changelog}
        </pre>
      )}
      {changes.commits && (
        <ul className="flex max-h-[60vh] flex-col gap-1 overflow-auto text-xs text-muted-foreground">
          {changes.commits.map((c) => (
            <li key={c.sha} className="break-words">
              <span className="font-mono text-foreground">
                {shortKitVersion(c.sha)}
              </span>{" "}
              {c.subject}
            </li>
          ))}
          {hidden > 0 && <li>and {hidden} more</li>}
        </ul>
      )}
      {!changes.changelog && !changes.commits && (
        <p className="text-muted-foreground">
          {changes.totalCommits
            ? `${changes.totalCommits} new commits.`
            : "The summary is not available right now."}
        </p>
      )}
      <a
        href={changes.compareUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 self-start text-accent hover:underline"
      >
        View the changes <Launch size={12} />
      </a>
    </div>
  );
}
