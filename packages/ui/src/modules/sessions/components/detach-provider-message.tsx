import type { ProviderUsage } from "../hooks/use-provider-usage.js";

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
      {/* UNIT_BOUNDARY_DESCRIPTION: what still follows an agent-level default
       * runs on it — the chat default, and a channel or scheduled default saved
       * before profiles (QA); channels and schedules with a profile of their own
       * are untouched. */}
      {usage.kinds.includes("chat") && (
        <p>
          The chat default runs on it, so new chats can&rsquo;t start until you
          choose another model.
        </p>
      )}
      {(usage.kinds.includes("channel") ||
        usage.kinds.includes("scheduled")) && (
        <p>
          A{" "}
          {listed(
            [
              ...(usage.kinds.includes("channel") ? ["channel"] : []),
              ...(usage.kinds.includes("scheduled") ? ["scheduled"] : []),
            ],
            "or",
          )}{" "}
          default saved before profiles stops too.
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

const listed = (words: readonly string[], joins: string): string =>
  words.length < 2
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} ${joins} ${words[words.length - 1]}`;
