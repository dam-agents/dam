import { Add, Save } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

export function SkillSetActions({
  canSave,
  previewReady,
  onAddSets,
  onSaveSet,
}: {
  canSave: boolean;
  previewReady: boolean;
  onAddSets: () => void;
  onSaveSet: () => void;
}) {
  return (
    <>
      <Button variant="outline" size="sm" onClick={onAddSets}>
        <Add size={16} /> Add skill sets…
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={!canSave || !previewReady}
        tooltip={
          !previewReady
            ? "Still reading your sources…"
            : canSave
              ? undefined
              : "Turn on at least one skill from a source to save a set"
        }
        onClick={onSaveSet}
      >
        <Save size={16} /> Save as skill set…
      </Button>
    </>
  );
}
