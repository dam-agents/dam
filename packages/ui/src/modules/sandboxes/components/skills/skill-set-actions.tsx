import { Add, Save } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

/** The sandbox-level skill-set controls that sit on the counts row: reuse a
 *  saved selection here, or turn this sandbox's selection into one. */
export function SkillSetActions({
  canSave,
  previewReady,
  onAddSets,
  onSaveSet,
}: {
  /** At least one source-backed skill is on — otherwise there is no selection
   *  worth naming. */
  canSave: boolean;
  /** Every source has reported. The save dialog's list and its pre-marks are a
   *  one-shot snapshot, so opening it mid-scan would silently save a set that
   *  omits the slower source's skills. */
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
