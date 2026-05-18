export function TabButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-10 px-4 text-[13px] font-semibold inline-flex items-center gap-2 border-b-2 -mb-[2px] transition-colors ${
        active
          ? "text-accent border-accent"
          : "text-text-muted border-transparent hover:text-text"
      }`}
    >
      {label}
      {count > 0 && (
        <span
          className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center ${
            active
              ? "bg-accent text-white"
              : "bg-surface-raised text-text-muted"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}
