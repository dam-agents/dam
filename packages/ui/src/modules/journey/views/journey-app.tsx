import { useStore } from "../../../store.js";
import { ConnectionsStepView } from "./connections-step-view.js";
import { ContextStepView } from "./context-step-view.js";
import { ImageStepView } from "./image-step-view.js";
import { LandingView } from "./landing-view.js";
import { SandboxStepView } from "./sandbox-step-view.js";

export function JourneyApp() {
  const view = useStore((s) => s.view);
  if (view === "new-image") return <ImageStepView />;
  if (view === "new-sandbox") return <SandboxStepView />;
  if (view === "new-connections") return <ConnectionsStepView />;
  if (view === "new-context") return <ContextStepView />;
  return <LandingView />;
}
