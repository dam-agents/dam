import { useStore } from "../../../store.js";
import { useSandboxWizard } from "../../v2/hooks/use-sandbox-wizard.js";
import type { Harness } from "../../v2/lib/harnesses.js";
import { EMPTY_SNAPSHOT, saveSnapshot } from "../../v2/lib/wizard-snapshot.js";
import { HarnessPicker } from "../components/harness-picker.js";
import { WizardLayout } from "../components/wizard-layout.js";

export function ImageStepView() {
  const { reset } = useSandboxWizard();
  const setView = useStore((s) => s.setView);

  const cancel = () => {
    reset();
    setView("new-landing");
  };

  const start = (harness: Harness, image = "") => {
    saveSnapshot({
      ...EMPTY_SNAPSHOT,
      harness,
      customImage: image,
      name: "my-sandbox",
    });
    setView("new-sandbox");
  };

  return (
    <WizardLayout
      current="new-image"
      title="Pick an image"
      subtitle="Choose a pre-built agent harness or bring your own image."
      onStepClick={(view) => (view === "new-landing" ? cancel() : undefined)}
    >
      <HarnessPicker
        onPickHarness={(harness) => start(harness)}
        onPickCustom={(image) => start("custom", image)}
      />
    </WizardLayout>
  );
}
