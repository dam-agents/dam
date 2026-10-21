import type { DefaultKind, SessionPair } from "api-server-api";

import { useHarnessCatalog } from "../api/session-pair.js";
import { DEFAULT_KIND_LABEL } from "../lib/default-kind.js";
import { harnessDisplayName } from "../lib/session-pair-options.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: whether a session follows its kind's default
 * or keeps its own choice, as the session's model popover shows it. A
 * session on a default that moved to another harness keeps the values it
 * last took, and says so; one on its own choice offers to follow again.
 */
export function DefaultFollowState({
  kind,
  follows,
  harness,
  model,
  target,
  onFollow,
}: {
  kind: DefaultKind;
  follows: DefaultKind | null | undefined;
  harness: string;
  model: string | null;
  target: SessionPair | null | undefined;
  onFollow: () => void;
}) {
  const { data: catalog } = useHarnessCatalog();
  const name = (h: string) => harnessDisplayName(h, catalog?.harnesses) ?? h;
  const label = DEFAULT_KIND_LABEL[kind];
  if (follows !== kind)
    return (
      <span className="flex min-w-0 items-center gap-2">
        <span>Own choice</span>
        <button
          type="button"
          onClick={onFollow}
          className="whitespace-nowrap underline underline-offset-2 hover:text-foreground"
        >
          Back to default
        </button>
      </span>
    );
  if (target && target.harness !== harness)
    return (
      <span className="min-w-0">
        On the {label} default, which is now {name(target.harness)}. Running on
        the last {name(harness)} default{model ? ` (${model})` : ""}.
      </span>
    );
  return <span>On the {label} default</span>;
}
