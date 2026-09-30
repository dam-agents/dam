import type { RuntimeMigrationPlanView } from "../../../types.js";
import { retentionSentence } from "../utils/runtime-migration.js";

export function MigrationPlanSummary({
  name,
  plan,
}: {
  name: string;
  plan: RuntimeMigrationPlanView;
}) {
  return (
    <div className="flex flex-col gap-3" data-testid="migration-plan">
      <p>
        Move agent <strong className="text-foreground">"{name}"</strong> to the
        new sandbox runtime?{" "}
        {plan.bootsSleepingAgent
          ? "Its home directory — the workspace and settings — is copied over, and it starts on the new runtime."
          : "The agent stops, its home directory — the workspace and settings — is copied over, and it restarts on the new runtime."}
      </p>
      <ul className="list-disc pl-5">
        <li>
          {plan.storageResized
            ? `Its disk is resized to ${plan.storageSize} to hold its home directory.`
            : `Its disk is ${plan.storageSize}.`}
        </li>
        <li>{retentionSentence(plan.retentionMs)}</li>
        {plan.bootsSleepingAgent && (
          <li>
            The agent is asleep now. It is started once to finish the move, and
            counts against your compute budget while it runs.
          </li>
        )}
        {!plan.bootsSleepingAgent && (
          <li>
            It is unavailable while the copy runs, and in-flight work is
            interrupted.
          </li>
        )}
      </ul>
      <p>
        Until the agent has started on the new runtime, you can abort the move,
        and it goes back to where it was.
      </p>
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
