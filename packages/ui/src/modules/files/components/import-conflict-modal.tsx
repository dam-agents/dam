import { useEffect } from "react";

export type ImportConflictChoice = "replace" | "merge" | "cancel";

interface Props {
  conflicts: string[];
  onChoose: (choice: ImportConflictChoice) => void;
}

export function ImportConflictModal({ conflicts, onChoose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onChoose("cancel");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onChoose]);

  const sample = conflicts.slice(0, 3).join(", ");
  const more = conflicts.length > 3 ? ` and ${conflicts.length - 3} more` : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[4px] anim-in">
      <div className="w-[480px] max-w-[calc(100vw-2rem)] rounded-xl border-2 border-border bg-surface p-5 md:p-7 flex flex-col gap-5 anim-scale-in shadow-brutal">
        <h2 className="text-[20px] font-bold text-text">Already exists</h2>
        <div className="text-[13px] text-text-secondary leading-relaxed flex flex-col gap-2">
          <p>
            {conflicts.length === 1 ? (
              <>An entry named <code className="font-mono">{conflicts[0]}</code> already exists.</>
            ) : (
              <>{conflicts.length} top-level entries already exist: <code className="font-mono">{sample}</code>{more}.</>
            )}
          </p>
          <p>
            <strong className="text-text">Replace</strong> wipes the existing entry and uses the imported one.{" "}
            <strong className="text-text">Merge</strong> keeps the existing entry and overwrites only same-path files.
          </p>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={() => onChoose("cancel")}
            className="btn-brutal h-9 rounded-lg border-2 border-border px-5 text-[13px] font-semibold text-text-secondary hover:text-text shadow-brutal-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onChoose("merge")}
            className="btn-brutal h-9 rounded-lg border-2 border-border bg-bg px-5 text-[13px] font-semibold text-text shadow-brutal-sm"
          >
            Merge
          </button>
          <button
            type="button"
            onClick={() => onChoose("replace")}
            className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-5 text-[13px] font-bold text-white shadow-brutal-accent"
          >
            Replace
          </button>
        </div>
      </div>
    </div>
  );
}
