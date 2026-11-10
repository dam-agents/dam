import type { ProviderUsage } from "../hooks/use-provider-usage.js";
import { DEFAULT_KIND_LABEL } from "../lib/default-kind.js";

export function DetachProviderMessage({
  name,
  usage,
}: {
  name: string;
  usage: ProviderUsage;
}) {
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
          <NameList names={usage.schedules} />
        </div>
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

function NameList({ names }: { names: readonly string[] }) {
  const hidden = names.length > MAX_LISTED ? names.length - MAX_LISTED + 1 : 0;
  return (
    <ul className="mt-1 list-disc pl-5">
      {names.slice(0, names.length - hidden).map((name) => (
        <li key={name}>{name}</li>
      ))}
      {hidden > 0 && <li>and {hidden} more</li>}
    </ul>
  );
}

const listed = (words: readonly string[]): string =>
  words.length < 2
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
