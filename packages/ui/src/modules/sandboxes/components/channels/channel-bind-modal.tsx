export type BindMessenger = "slack" | "telegram";

export function ChannelBindModal({
  onClose,
}: {
  messengers: BindMessenger[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="rounded-lg bg-card p-6">
        <p className="text-sm text-foreground">Connect a channel</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 text-sm text-primary"
        >
          Close
        </button>
      </div>
    </div>
  );
}
