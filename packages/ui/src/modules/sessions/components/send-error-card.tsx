interface SendErrorCardProps {
  error: string;
  onRetry?: () => void;
}

export function SendErrorCard({ error, onRetry }: SendErrorCardProps) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
      <p className="text-sm text-destructive font-medium mb-1">{error}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-xs text-primary hover:underline"
        >
          Retry
        </button>
      )}
    </div>
  );
}
