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
      {usage.schedules.length > 0 && (
        <div>
          <p>These schedules won&rsquo;t run:</p>
          <ul className="mt-1 list-disc pl-5">
            {usage.schedules.map((schedule) => (
              <li key={schedule}>{schedule}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const listed = (words: readonly string[]): string =>
  words.length < 2
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
