import type { SessionError } from "../../../store.js";

interface SessionErrorCardProps {
  error: SessionError;
  onBack: () => void;
  onDelete: () => void;
}

export function SessionErrorCard({ error, onBack }: SessionErrorCardProps) {
  return (
    <div className="mx-auto max-w-[760px] rounded-lg border border-destructive/30 bg-destructive/5 p-4">
      <p className="text-sm text-destructive font-medium mb-2">
        {error.message ?? "Session error"}
      </p>
      <button onClick={onBack} className="text-xs text-primary hover:underline">
        Back to sessions
      </button>
    </div>
  );
}
