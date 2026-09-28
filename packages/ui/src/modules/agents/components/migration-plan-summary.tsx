import type { RuntimeMigrationPlanView } from "../../../types.js";
import {
  planMoveLines,
  retentionSentence,
} from "../utils/runtime-migration.js";

export function MigrationPlanSummary({
  name,
  plan,
}: {
  name: string;
  plan: RuntimeMigrationPlanView;
}) {
  const moves = planMoveLines(plan);
  return (
    <div className="flex flex-col gap-3" data-testid="migration-plan">
      <p>
        Move agent <strong className="text-foreground">"{name}"</strong> to the
        new sandbox runtime? The agent stops, its home directory — the workspace
        and settings — is copied over, and it restarts on the new runtime.
      </p>
      {moves.length > 0 && (
        <div className="flex flex-col gap-1">
          <p>Its other saved folders move into the home directory:</p>
          <ul className="list-disc pl-5">
            {moves.map((m) => (
              <li key={m.from}>
                {m.stays ? (
                  <>
                    <code>{m.from}</code> stays where it is
                  </>
                ) : (
                  <>
                    <code>{m.from}</code> will live in your home at{" "}
                    <code>{m.to}</code>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ul className="list-disc pl-5">
        <li>
          {plan.storageResized
            ? `Its disk is resized to ${plan.storageSize} to hold all of its saved folders.`
            : `Its disk is ${plan.storageSize}.`}
        </li>
        <li>{retentionSentence(plan.retentionMs)}</li>
        {plan.bootsSleepingAgent && (
          <li>
            The agent is asleep now. It is started once to finish the move, and
            counts against your compute budget while it runs.
          </li>
        )}
        <li>
          It is unavailable while the copy runs, and in-flight work is
          interrupted.
        </li>
      </ul>
      <p>This cannot be undone from the UI.</p>
    </div>
  );
}

export function MigrationRefusalList({
  plan,
}: {
  plan: Pick<RuntimeMigrationPlanView, "refusal">;
}) {
  if (!plan.refusal) return null;
  return (
    <ul className="list-disc pl-5" data-testid="migration-refusal">
      {plan.refusal.reasons.map((reason) => (
        <li key={reason}>{reason}</li>
      ))}
    </ul>
  );
}
