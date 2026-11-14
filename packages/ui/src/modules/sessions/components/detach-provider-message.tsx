import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import type { ProviderUsage } from "../hooks/use-provider-usage.js";
import { DEFAULT_KIND_LABEL } from "../lib/default-kind.js";

export function DetachProviderMessage({
  agentId,
  name,
  usage,
}: {
  agentId: string | null;
  name: string;
  usage: ProviderUsage;
}) {
  const closeDialog = useStore((s) => s.closeDialog);
  const openAgentSettings = useStore((s) => s.openAgentSettings);
  const seeAll = agentId
    ? () => {
        closeDialog(false);
        openAgentSettings(agentId, "schedules");
      }
    : undefined;
  const turnedOff = usage.turnedOffSchedules;
  return (
    <div className="flex flex-col gap-2">
      <p>
        Sessions running on <strong>{name}</strong> stop until it is attached
        again.
      </p>
      {usage.kinds.length > 0 && (
        <p>
          The {listed(usage.kinds.map((kind) => DEFAULT_KIND_LABEL[kind]))}{" "}
          {usage.kinds.length === 1 ? "default runs" : "defaults run"} on it and
          won&rsquo;t run until you choose another model.
        </p>
      )}
      {usage.profiles.length > 0 && (
        <div>
          <p>These profiles run on it:</p>
          <NameList names={usage.profiles} />
        </div>
      )}
      {usage.schedules.length > 0 && (
        <div>
          <p>These schedules won&rsquo;t run:</p>
          <NameList names={usage.schedules} onSeeAll={seeAll} />
        </div>
      )}
      {turnedOff > 0 && (
        <p>
          {turnedOff === 1
            ? "1 turned-off schedule uses it too. Turned back on, it won\u2019t run"
            : `${turnedOff} turned-off schedules use it too. Turned back on, they won\u2019t run`}{" "}
          until {name} is attached again or{" "}
          {turnedOff === 1 ? "it gets" : "they get"} another model.
        </p>
      )}
      {usage.pages.length > 0 && (
        <div>
          <p>Prompts from these pages won&rsquo;t run:</p>
          <NameList names={usage.pages} />
        </div>
      )}
    </div>
  );
}

const MAX_LISTED = 5;

function NameList({
  names,
  onSeeAll,
}: {
  names: readonly string[];
  onSeeAll?: () => void;
}) {
  const hidden = names.length > MAX_LISTED ? names.length - MAX_LISTED + 1 : 0;
  return (
    <div className="mt-1 text-left">
      <ul className="list-disc pl-5">
        {names.slice(0, names.length - hidden).map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
      {hidden > 0 && (
        <p className="mt-1 text-xs">
          and {hidden} more
          {onSeeAll && (
            <>
              {" · "}
              <Button variant="link" size="inline" onClick={onSeeAll}>
                See all in Schedules
              </Button>
            </>
          )}
        </p>
      )}
    </div>
  );
}

const listed = (words: readonly string[]): string =>
  words.length < 2
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
